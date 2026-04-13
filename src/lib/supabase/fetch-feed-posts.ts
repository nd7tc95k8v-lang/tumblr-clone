import type { SupabaseClient } from "@supabase/supabase-js";
import { threadRootPostId } from "@/lib/post-thread-root";
import {
  buildQuotedPostChain,
  fetchReblogParentClosure,
  type ChainPostRow,
} from "@/lib/quote-chain";
import { coercePostTags } from "@/lib/tags";
import type { EmbeddedPostWithAuthor, FeedPost } from "@/types/post";
import { attachFeedPostEngagement } from "@/lib/supabase/feed-engagement";

/** Feed list: post row + author only (no posts→posts embed). */
export const POST_FEED_BASE_SELECT = `
  id,
  content,
  created_at,
  user_id,
  image_url,
  reblog_of,
  reblog_commentary,
  original_post_id,
  tags,
  author:profiles!posts_user_id_fkey ( username, avatar_url )
`;

/** Second query: chain-root rows + author. */
export const POST_ORIGINAL_SELECT = `
  id,
  content,
  image_url,
  user_id,
  tags,
  author:profiles!posts_user_id_fkey ( username, avatar_url )
`;

type FeedRow = Omit<
  FeedPost,
  "original_post" | "quoted_post" | "like_count" | "reblog_count" | "liked_by_me"
>;

/** Raw row from PostgREST (`original_post_id` may be null on legacy rows). */
type FeedQueryRow = Omit<FeedRow, "original_post_id"> & { original_post_id?: string | null };

function feedRowToEmbeddedOriginal(row: FeedRow): EmbeddedPostWithAuthor {
  return {
    id: row.id,
    content: row.content,
    image_url: row.image_url,
    user_id: row.user_id,
    tags: coercePostTags(row.tags),
    author: row.author,
  };
}

function feedRowToChainRow(r: FeedRow): ChainPostRow {
  return {
    id: r.id,
    content: r.content,
    created_at: r.created_at,
    user_id: r.user_id,
    image_url: r.image_url,
    reblog_of: r.reblog_of,
    reblog_commentary: r.reblog_commentary,
    original_post_id: r.original_post_id,
    tags: coercePostTags(r.tags),
    author: r.author,
  };
}

function chainRowToEmbedded(row: ChainPostRow): EmbeddedPostWithAuthor {
  return {
    id: row.id,
    content: row.content,
    image_url: row.image_url,
    user_id: row.user_id,
    tags: row.tags,
    author: row.author,
  };
}

export type FetchFeedPostsOptions = {
  /** If set, only posts whose user_id is in this list. */
  filterUserIds?: string[];
  /** If set, only posts whose `tags` array contains this normalized tag. */
  filterTag?: string;
  /** When set, populates `liked_by_me` for those posts (requires the user’s JWT on `supabase`). */
  viewerUserId?: string | null;
};

/**
 * Load feed rows, then merge chain roots as `original_post`.
 * Roots already present in the feed are reused; only missing ids are loaded in a second query.
 */
export async function fetchFeedPosts(
  supabase: SupabaseClient,
  options: FetchFeedPostsOptions = {},
): Promise<{ data: FeedPost[] | null; error: { message: string } | null }> {
  let query = supabase.from("posts").select(POST_FEED_BASE_SELECT).order("created_at", { ascending: false });

  if (options.filterUserIds && options.filterUserIds.length > 0) {
    query = query.in("user_id", options.filterUserIds);
  }

  const tagFilter = options.filterTag?.trim();
  if (tagFilter) {
    query = query.contains("tags", [tagFilter]);
  }

  const { data: rows, error } = await query;
  if (error) {
    return { data: null, error };
  }
  if (!rows?.length) {
    return { data: [], error: null };
  }

  const feedRows: FeedRow[] = (rows as FeedQueryRow[]).map((r) => ({
    ...r,
    original_post_id: threadRootPostId(r),
  }));
  const feedById = new Map<string, FeedRow>(feedRows.map((r) => [r.id, r]));

  const { byId: chainLookup } = await fetchReblogParentClosure(
    supabase,
    new Map(feedRows.map((r) => [r.id, feedRowToChainRow(r)])),
    feedRows,
  );

  const originalIds = [
    ...new Set(
      feedRows
        .map((r) => r.original_post_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  ];

  const map = new Map<string, EmbeddedPostWithAuthor>();
  for (const rootId of originalIds) {
    const local = feedById.get(rootId);
    if (local) {
      map.set(rootId, feedRowToEmbeddedOriginal(local));
    }
  }

  const missingOriginalIds = originalIds.filter((id) => !map.has(id));

  const stillMissingRoots: string[] = [];
  for (const id of missingOriginalIds) {
    const row = chainLookup.get(id);
    if (row) {
      map.set(id, chainRowToEmbedded(row));
    } else {
      stillMissingRoots.push(id);
    }
  }

  if (stillMissingRoots.length > 0) {
    const { data: originals, error: origError } = await supabase
      .from("posts")
      .select(POST_ORIGINAL_SELECT)
      .in("id", stillMissingRoots);

    if (origError) {
      return { data: null, error: origError };
    }

    for (const o of originals ?? []) {
      const row = o as EmbeddedPostWithAuthor;
      map.set(row.id, { ...row, tags: coercePostTags(row.tags) });
    }
  }

  const merged: FeedPost[] = feedRows.map((row) => ({
    ...row,
    tags: coercePostTags(row.tags),
    original_post: map.get(row.original_post_id) ?? null,
    quoted_post: buildQuotedPostChain(row, chainLookup),
    like_count: 0,
    reblog_count: 0,
    liked_by_me: false,
  }));

  // Root-scoped like/reblog hydration (see `attachFeedPostEngagement` + 015_post_likes.sql RPCs).
  const enriched = await attachFeedPostEngagement(supabase, merged, options.viewerUserId ?? null);
  return { data: enriched, error: null };
}
