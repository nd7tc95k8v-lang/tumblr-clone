import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTagSegment } from "@/lib/tags";
import type { FeedPost } from "@/types/post";
import {
  POST_FEED_BASE_SELECT,
  hydrateFeedPostsFromQueryRows,
  type FeedQueryRow,
} from "@/lib/supabase/fetch-feed-posts";

/** Escape `%`, `_`, and `\` for use inside a PostgreSQL `ILIKE` pattern (default escape is `\`). */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function normalizeSearchTagList(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const n = normalizeTagSegment(t);
    if (!n.length) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export type FetchSearchPostsOptions = {
  /** Raw substring match on `posts.content` (case-insensitive). */
  contentSubstring?: string | null;
  /** Stored normalized tags; posts matching **any** of these (array overlap) are included. */
  tagsAny?: string[];
  viewerUserId?: string | null;
};

/**
 * Search posts by optional text (`ILIKE` on content) and/or tags (`tags && selected`).
 * When both are set, filters are combined with AND.
 * Reuses the same merge + engagement hydration as the main feed.
 */
export async function fetchSearchPosts(
  supabase: SupabaseClient,
  options: FetchSearchPostsOptions = {},
): Promise<{ data: FeedPost[] | null; error: { message: string } | null }> {
  const text = options.contentSubstring?.trim() ?? "";
  const tags = normalizeSearchTagList(options.tagsAny ?? []);

  if (text.length === 0 && tags.length === 0) {
    return { data: [], error: null };
  }

  let query = supabase.from("posts").select(POST_FEED_BASE_SELECT).order("created_at", { ascending: false });

  if (text.length > 0) {
    query = query.ilike("content", `%${escapeIlikePattern(text)}%`);
  }
  if (tags.length > 0) {
    query = query.overlaps("tags", tags);
  }

  const { data: rows, error } = await query;
  if (error) {
    return { data: null, error };
  }

  return hydrateFeedPostsFromQueryRows(supabase, rows as FeedQueryRow[], options.viewerUserId ?? null);
}

/** Count posts whose `tags` array contains the normalized tag (same semantics as the tag page filter). */
export async function countPostsWithTag(
  supabase: SupabaseClient,
  normalizedTag: string,
): Promise<{ count: number | null; error: { message: string } | null }> {
  const tag = normalizeTagSegment(normalizedTag);
  if (!tag.length) {
    return { count: 0, error: null };
  }

  const { count, error } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .contains("tags", [tag]);

  if (error) {
    return { count: null, error };
  }
  return { count: count ?? 0, error: null };
}
