import type { SupabaseClient } from "@supabase/supabase-js";
import { noteOwnerPostIdForCard } from "@/lib/feed-post-display";
import { coercePostImageRows } from "@/lib/post-images";
import { threadRootPostId } from "@/lib/post-thread-root";
import {
  buildQuotedPostChain,
  fetchReblogParentClosure,
  type ChainPostRow,
} from "@/lib/quote-chain";
import { coercePostTags } from "@/lib/tags";
import type { EmbeddedPostWithAuthor, FeedPost } from "@/types/post";
import { attachFeedPostEngagement } from "@/lib/supabase/feed-engagement";

/** Merge “following” sources: followed-user posts + tag-matched posts, deduped by `id`, newest first. */
export function mergeFollowingFeedSources(fromFollowedUsers: FeedPost[], fromFollowedTags: FeedPost[]): FeedPost[] {
  const map = new Map<string, FeedPost>();
  for (const p of fromFollowedUsers) {
    map.set(p.id, p);
  }
  for (const p of fromFollowedTags) {
    if (!map.has(p.id)) {
      map.set(p.id, p);
    }
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** Feed list: post row + author only (no posts→posts embed). */
export const POST_FEED_BASE_SELECT = `
  id,
  content,
  created_at,
  user_id,
  image_url,
  image_storage_path,
  reblog_of,
  reblog_commentary,
  original_post_id,
  is_nsfw,
  nsfw_source,
  tags,
  post_images ( id, post_id, storage_path, position, created_at ),
  author:profiles!posts_user_id_fkey ( username, avatar_url )
`;

/** Second query: chain-root rows + author. */
export const POST_ORIGINAL_SELECT = `
  id,
  content,
  image_url,
  image_storage_path,
  user_id,
  is_nsfw,
  tags,
  post_images ( id, post_id, storage_path, position, created_at ),
  author:profiles!posts_user_id_fkey ( username, avatar_url )
`;

type FeedRow = Omit<
  FeedPost,
  "original_post" | "quoted_post" | "like_count" | "reblog_count" | "note_comment_count" | "liked_by_me"
>;

/** Raw row from PostgREST (`original_post_id` may be null on legacy rows). */
export type FeedQueryRow = Omit<FeedRow, "original_post_id" | "is_nsfw" | "post_images"> & {
  original_post_id?: string | null;
  is_nsfw?: boolean | null;
  nsfw_source?: string | null;
  post_images?: unknown;
};

/**
 * Shared merge/hydration path for feed-shaped post rows (chain roots, quotes, engagement).
 * Used by `fetchFeedPosts` and `fetchSearchPosts`.
 * Sets `FeedPost.card_engagement_owner_post_id` from `noteOwnerPostIdForCard` (reserved; not used by likes/Notes yet).
 */
export async function hydrateFeedPostsFromQueryRows(
  supabase: SupabaseClient,
  rows: FeedQueryRow[] | null | undefined,
  viewerUserId: string | null | undefined,
): Promise<{ data: FeedPost[] | null; error: { message: string } | null }> {
  if (!rows?.length) {
    return { data: [], error: null };
  }

  const feedRows: FeedRow[] = rows.map((r) => ({
    ...r,
    original_post_id: threadRootPostId(r),
    is_nsfw: Boolean(r.is_nsfw),
    post_images: coercePostImageRows(r.post_images),
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
      const row = o as EmbeddedPostWithAuthor & { post_images?: unknown };
      map.set(row.id, {
        ...row,
        tags: coercePostTags(row.tags),
        post_images: coercePostImageRows(row.post_images),
      });
    }
  }

  const merged: FeedPost[] = feedRows.map((row): FeedPost => {
    const quoted_post = buildQuotedPostChain(row, chainLookup);
    const mergedRow: FeedPost = {
      ...row,
      is_nsfw: Boolean(row.is_nsfw),
      tags: coercePostTags(row.tags),
      original_post: map.get(row.original_post_id) ?? null,
      quoted_post,
      like_count: 0,
      reblog_count: 0,
      note_comment_count: 0,
      liked_by_me: false,
      card_engagement_owner_post_id: "",
    };
    mergedRow.card_engagement_owner_post_id = noteOwnerPostIdForCard(mergedRow);
    return mergedRow;
  });

  const enriched = await attachFeedPostEngagement(supabase, merged, viewerUserId ?? null);
  return { data: enriched, error: null };
}

function feedRowToEmbeddedOriginal(row: FeedRow): EmbeddedPostWithAuthor {
  return {
    id: row.id,
    content: row.content,
    image_url: row.image_url,
    image_storage_path: row.image_storage_path,
    post_images: row.post_images ?? null,
    user_id: row.user_id,
    tags: coercePostTags(row.tags),
    author: row.author,
    is_nsfw: row.is_nsfw,
  };
}

function feedRowToChainRow(r: FeedRow): ChainPostRow {
  return {
    id: r.id,
    content: r.content,
    created_at: r.created_at,
    user_id: r.user_id,
    image_url: r.image_url,
    image_storage_path: r.image_storage_path,
    post_images: r.post_images ?? null,
    reblog_of: r.reblog_of,
    reblog_commentary: r.reblog_commentary,
    original_post_id: r.original_post_id,
    is_nsfw: r.is_nsfw,
    tags: coercePostTags(r.tags),
    author: r.author,
  };
}

function chainRowToEmbedded(row: ChainPostRow): EmbeddedPostWithAuthor {
  return {
    id: row.id,
    content: row.content,
    image_url: row.image_url,
    image_storage_path: row.image_storage_path,
    post_images: row.post_images ?? null,
    user_id: row.user_id,
    tags: row.tags,
    author: row.author,
    is_nsfw: row.is_nsfw,
  };
}

export type FetchFeedPostsOptions = {
  /**
   * **Following-style feed:** restrict to posts whose `user_id` is in this list (e.g. viewer + accounts they follow).
   * **Explore-style feed:** omit this field — all posts, newest first (existing chronological order).
   */
  filterUserIds?: string[];
  /** If set, only posts whose `tags` array contains this normalized tag. */
  filterTag?: string;
  /** When set, populates `liked_by_me` for those posts (requires the user’s JWT on `supabase`). */
  viewerUserId?: string | null;
  /**
   * Profile “hide reblogs”: keep only original rows (`reblog_of` IS NULL). Quote reblogs are still reblogs and are excluded.
   */
  excludeReblogs?: boolean;
  /**
   * When true, omit rows with `posts.is_nsfw` at query time (viewer preference `hide`).
   * Opt-in only (home / explore / search); omit on profile and tag surfaces.
   */
  excludeNsfwFromFeed?: boolean;
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

  if (options.excludeReblogs) {
    query = query.is("reblog_of", null);
  }

  const tagFilter = options.filterTag?.trim();
  if (tagFilter) {
    query = query.contains("tags", [tagFilter]);
  }

  if (options.excludeNsfwFromFeed) {
    query = query.eq("is_nsfw", false);
  }

  const { data: rows, error } = await query;
  if (error) {
    return { data: null, error };
  }

  return hydrateFeedPostsFromQueryRows(supabase, rows as FeedQueryRow[], options.viewerUserId ?? null);
}

/**
 * Load one post by primary key and hydrate it through the same path as feed rows
 * (`quoted_post`, `original_post`, engagement). Returns `data: null` when the row is missing
 * or not visible under RLS (treat like “not found” for UX).
 */
export async function fetchFeedPostById(
  supabase: SupabaseClient,
  postId: string,
  viewerUserId: string | null | undefined,
): Promise<{ data: FeedPost | null; error: { message: string } | null }> {
  const id = postId?.trim() ?? "";
  if (!id) {
    return { data: null, error: { message: "Missing post id" } };
  }

  const { data: row, error } = await supabase
    .from("posts")
    .select(POST_FEED_BASE_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }
  if (!row) {
    return { data: null, error: null };
  }

  const { data, error: hydrateError } = await hydrateFeedPostsFromQueryRows(
    supabase,
    [row as FeedQueryRow],
    viewerUserId ?? null,
  );
  if (hydrateError) {
    return { data: null, error: hydrateError };
  }
  const first = data?.[0] ?? null;
  return { data: first, error: null };
}

/**
 * Posts whose `tags` array overlaps any of the given normalized tag strings (same as search tag filter).
 * Does not apply `filterUserIds` — callers merge with the followed-user feed in app code.
 */
export async function fetchFeedPostsForFollowedTagsOverlap(
  supabase: SupabaseClient,
  normalizedTags: string[],
  viewerUserId: string | null,
  opts?: { excludeNsfwFromFeed?: boolean },
): Promise<{ data: FeedPost[] | null; error: { message: string } | null }> {
  if (normalizedTags.length === 0) {
    return { data: [], error: null };
  }

  let query = supabase.from("posts").select(POST_FEED_BASE_SELECT).order("created_at", { ascending: false });
  query = query.overlaps("tags", normalizedTags);

  if (opts?.excludeNsfwFromFeed) {
    query = query.eq("is_nsfw", false);
  }

  const { data: rows, error } = await query;
  if (error) {
    return { data: null, error };
  }

  return hydrateFeedPostsFromQueryRows(supabase, rows as FeedQueryRow[], viewerUserId ?? null);
}
