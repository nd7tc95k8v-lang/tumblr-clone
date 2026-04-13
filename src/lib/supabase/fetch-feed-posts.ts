import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { EmbeddedPostWithAuthor, FeedPost } from "@/types/post";

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

type FeedRow = Omit<FeedPost, "original_post">;

export type FetchFeedPostsOptions = {
  /** If set, only posts whose user_id is in this list. */
  filterUserIds?: string[];
  /** If set, only posts whose `tags` array contains this normalized tag. */
  filterTag?: string;
};

/**
 * Load feed rows, then load unique `original_post_id` targets and merge as `original_post`.
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

  const feedRows = rows as FeedRow[];
  const originalIds = [...new Set(feedRows.map((r) => r.original_post_id))];

  const { data: originals, error: origError } = await supabase
    .from("posts")
    .select(POST_ORIGINAL_SELECT)
    .in("id", originalIds);

  if (origError) {
    return { data: null, error: origError };
  }

  const map = new Map<string, EmbeddedPostWithAuthor>(
    (originals ?? []).map((o) => {
      const row = o as EmbeddedPostWithAuthor;
      return [row.id, { ...row, tags: coercePostTags(row.tags) }];
    }),
  );

  const merged: FeedPost[] = feedRows.map((row) => ({
    ...row,
    tags: coercePostTags(row.tags),
    original_post: map.get(row.original_post_id) ?? null,
  }));

  return { data: merged, error: null };
}
