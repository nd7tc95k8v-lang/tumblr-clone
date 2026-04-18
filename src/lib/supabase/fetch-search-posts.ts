import type { SupabaseClient } from "@supabase/supabase-js";
import { derivePostSearchText, getTwoTokenPostSearchTokens } from "@/lib/search/search-query";
import { normalizeTagSegment } from "@/lib/tags";
import type { FeedPost } from "@/types/post";
import {
  POST_FEED_BASE_SELECT,
  hydrateFeedPostsFromQueryRows,
  type FeedQueryRow,
} from "@/lib/supabase/fetch-feed-posts";
import { escapeIlikePattern } from "@/lib/supabase/escape-ilike-pattern";
import { resolveStrongUsernameForTagSearchHint } from "@/lib/supabase/fetch-search-users";

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
  /** When set, restrict hits to this author's posts (combined with text/tags filters when present). */
  authorUserId?: string | null;
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

  const authorId = options.authorUserId?.trim() ?? "";
  if (authorId.length > 0) {
    query = query.eq("user_id", authorId);
  }

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

export type FetchSearchPostsWithTwoTokenFallbackOptions = {
  /** Raw URL `q` (trimmed by caller); used for {@link derivePostSearchText} and optional retry. */
  rawQ: string;
  tagsAny?: string[];
  viewerUserId?: string | null;
};

/** Dedupe by post id, then newest-first (same ordering intent as the main post search query). */
export function mergeSearchPostsNewestFirstUnique(primary: FeedPost[], extra: FeedPost[]): FeedPost[] {
  const map = new Map<string, FeedPost>();
  for (const p of primary) {
    map.set(p.id, p);
  }
  for (const p of extra) {
    if (!map.has(p.id)) {
      map.set(p.id, p);
    }
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * `/search` post fetch: derives post text and runs {@link fetchSearchPosts}. For exactly two tokens
 * with no `@mention`, if the full derived text returns no rows, retries once per token (token 1, then token 2).
 * When tags are selected and `rawQ` yields a single strong username match, merges in one extra author-scoped
 * tag query (see {@link resolveStrongUsernameForTagSearchHint}) without changing the primary text/tag logic.
 */
export async function fetchSearchPostsWithTwoTokenFallback(
  supabase: SupabaseClient,
  options: FetchSearchPostsWithTwoTokenFallbackOptions,
): Promise<{ data: FeedPost[] | null; error: { message: string } | null }> {
  const postSearchText = derivePostSearchText(options.rawQ);
  const firstOpts: FetchSearchPostsOptions = {
    contentSubstring: postSearchText.length > 0 ? postSearchText : null,
    tagsAny: options.tagsAny,
    viewerUserId: options.viewerUserId ?? null,
  };

  const first = await fetchSearchPosts(supabase, firstOpts);
  if (first.error) return first;

  let combined: FeedPost[] = first.data ?? [];

  if (combined.length === 0) {
    const twins = getTwoTokenPostSearchTokens(options.rawQ);
    if (twins) {
      const [t1, t2] = twins;
      const second = await fetchSearchPosts(supabase, {
        ...firstOpts,
        contentSubstring: t1,
      });
      if (second.error) return second;
      if ((second.data?.length ?? 0) > 0) {
        combined = second.data ?? [];
      } else {
        const third = await fetchSearchPosts(supabase, {
          ...firstOpts,
          contentSubstring: t2,
        });
        if (third.error) return third;
        combined = third.data ?? [];
      }
    }
  }

  const tags = normalizeSearchTagList(options.tagsAny ?? []);
  const rawTrim = options.rawQ.trim();
  if (tags.length > 0 && rawTrim.length > 0) {
    const resolved = await resolveStrongUsernameForTagSearchHint(supabase, options.rawQ);
    if (resolved) {
      const scoped = await fetchSearchPosts(supabase, {
        contentSubstring: null,
        tagsAny: options.tagsAny,
        viewerUserId: options.viewerUserId ?? null,
        authorUserId: resolved.id,
      });
      if (!scoped.error && (scoped.data?.length ?? 0) > 0) {
        combined = mergeSearchPostsNewestFirstUnique(combined, scoped.data ?? []);
      }
    }
  }

  return { data: combined, error: null };
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
