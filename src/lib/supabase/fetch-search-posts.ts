import type { SupabaseClient } from "@supabase/supabase-js";
import { derivePostSearchText, getTwoTokenPostSearchTokens } from "@/lib/search/search-query";
import { normalizeTagSegment } from "@/lib/tags";
import type { FeedPost } from "@/types/post";
import {
  compareFeedPostsNewestFirst,
  DEFAULT_FEED_PAGE_SIZE,
  feedKeysetBeforeCursorFilter,
  hydrateFeedPostsFromQueryRows,
  POST_FEED_BASE_SELECT,
  resolveFeedPageLimit,
  sliceFeedQueryPage,
  type FeedPageCursor,
  type FeedQueryRow,
} from "@/lib/supabase/fetch-feed-posts";
import { escapeIlikePattern } from "@/lib/supabase/escape-ilike-pattern";
import { resolveStrongUsernameForTagSearchHint } from "@/lib/supabase/fetch-search-users";

export type { FeedPageCursor };

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

/** How selected tags combine: overlap (any) vs superset (all). */
export type SearchTagMatchMode = "any" | "all";

/** URL `tagMode` / client string → mode; missing or invalid → `"any"`. */
export function parseSearchTagMatchMode(value: string | null | undefined): SearchTagMatchMode {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "all") return "all";
  return "any";
}

export type FetchSearchPostsOptions = {
  /** Raw substring match on `posts.content` (case-insensitive). */
  contentSubstring?: string | null;
  /** Stored normalized tags; combined per {@link tagMatchMode} (default any = overlap). */
  tagsAny?: string[];
  /** Default `any`: `tags && selected`; `all`: post tags must include every selected tag. */
  tagMatchMode?: SearchTagMatchMode;
  viewerUserId?: string | null;
  /** When set, restrict hits to this author's posts (combined with text/tags filters when present). */
  authorUserId?: string | null;
  /** When true, omit `is_nsfw` rows (viewer feed preference `hide`). */
  excludeNsfwFromFeed?: boolean;
  /** When set, return at most this many rows plus pagination metadata (`limit + 1` fetched internally). */
  limit?: number;
  /** Rows strictly older than this cursor in `(created_at desc, id desc)` order. */
  cursor?: FeedPageCursor | null;
};

export type FetchSearchPostsResult = {
  data: FeedPost[] | null;
  error: { message: string } | null;
  nextCursor: FeedPageCursor | null;
  hasMore: boolean;
};

/**
 * Search posts by optional text (`ILIKE` on content) and/or tags (overlap or contains).
 * When both are set, filters are combined with AND.
 * Reuses the same merge + engagement hydration as the main feed.
 */
export async function fetchSearchPosts(
  supabase: SupabaseClient,
  options: FetchSearchPostsOptions = {},
): Promise<FetchSearchPostsResult> {
  const text = options.contentSubstring?.trim() ?? "";
  const tags = normalizeSearchTagList(options.tagsAny ?? []);
  const tagMatchMode = options.tagMatchMode ?? "any";
  const pageLimit = resolveFeedPageLimit(options.limit);

  if (text.length === 0 && tags.length === 0) {
    return { data: [], error: null, nextCursor: null, hasMore: false };
  }

  let query = supabase
    .from("posts")
    .select(POST_FEED_BASE_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  const authorId = options.authorUserId?.trim() ?? "";
  if (authorId.length > 0) {
    query = query.eq("user_id", authorId);
  }

  if (text.length > 0) {
    query = query.ilike("content", `%${escapeIlikePattern(text)}%`);
  }
  if (tags.length > 0) {
    query =
      tagMatchMode === "all" ? query.contains("tags", tags) : query.overlaps("tags", tags);
  }

  if (options.excludeNsfwFromFeed) {
    query = query.eq("is_nsfw", false);
  }

  if (pageLimit !== undefined) {
    query = query.limit(pageLimit + 1);
    const cursor = options.cursor;
    if (cursor?.created_at?.trim() && cursor.id?.trim()) {
      query = query.or(feedKeysetBeforeCursorFilter(cursor));
    }
  }

  const { data: rows, error } = await query;
  if (error) {
    return { data: null, error, nextCursor: null, hasMore: false };
  }

  const rawRows = (rows ?? []) as FeedQueryRow[];
  let rowsToHydrate = rawRows;
  let nextCursor: FeedPageCursor | null = null;
  let hasMore = false;

  if (pageLimit !== undefined) {
    const sliced = sliceFeedQueryPage(rawRows, pageLimit);
    rowsToHydrate = sliced.pageRows;
    nextCursor = sliced.nextCursor;
    hasMore = sliced.hasMore;
  }

  const hydrated = await hydrateFeedPostsFromQueryRows(
    supabase,
    rowsToHydrate,
    options.viewerUserId ?? null,
  );
  return {
    data: hydrated.data,
    error: hydrated.error,
    nextCursor,
    hasMore,
  };
}

export type FetchSearchPostsWithTwoTokenFallbackOptions = {
  /** Raw URL `q` (trimmed by caller); used for {@link derivePostSearchText} and optional retry. */
  rawQ: string;
  tagsAny?: string[];
  tagMatchMode?: SearchTagMatchMode;
  viewerUserId?: string | null;
  excludeNsfwFromFeed?: boolean;
  limit?: number;
  cursor?: FeedPageCursor | null;
  /**
   * Page 2+: pass the substring resolved on page 1 (includes two-token fallback when used).
   * Omit on page 1.
   */
  effectiveContentSubstring?: string | null;
};

export type FetchSearchPostsWithTwoTokenFallbackResult = FetchSearchPostsResult & {
  /** Content substring to reuse for load-more (after two-token fallback on page 1). */
  effectiveContentSubstring: string | null;
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
  return [...map.values()].sort(compareFeedPostsNewestFirst);
}

function searchPostsBaseOpts(
  options: FetchSearchPostsWithTwoTokenFallbackOptions,
  contentSubstring: string | null,
): FetchSearchPostsOptions {
  return {
    contentSubstring,
    tagsAny: options.tagsAny,
    tagMatchMode: options.tagMatchMode ?? "any",
    viewerUserId: options.viewerUserId ?? null,
    excludeNsfwFromFeed: options.excludeNsfwFromFeed,
    limit: options.limit,
    cursor: options.cursor ?? null,
  };
}

function isSearchLoadMore(cursor: FeedPageCursor | null | undefined): boolean {
  return Boolean(cursor?.created_at?.trim() && cursor.id?.trim());
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
): Promise<FetchSearchPostsWithTwoTokenFallbackResult> {
  const pageLimit = resolveFeedPageLimit(options.limit);
  const cursor = options.cursor ?? null;
  const tagMatchMode = options.tagMatchMode ?? "any";

  if (isSearchLoadMore(cursor)) {
    const text =
      options.effectiveContentSubstring !== undefined
        ? options.effectiveContentSubstring
        : derivePostSearchText(options.rawQ);
    const substring = text && text.trim().length > 0 ? text : null;
    const result = await fetchSearchPosts(supabase, searchPostsBaseOpts(options, substring));
    return { ...result, effectiveContentSubstring: substring };
  }

  const postSearchText = derivePostSearchText(options.rawQ);
  let effectiveContentSubstring: string | null = postSearchText.length > 0 ? postSearchText : null;

  const firstOpts = searchPostsBaseOpts(options, effectiveContentSubstring);
  const first = await fetchSearchPosts(supabase, firstOpts);
  if (first.error) {
    return { ...first, effectiveContentSubstring };
  }

  let combined: FeedPost[] = first.data ?? [];
  let hasMore = first.hasMore;
  let nextCursor = first.nextCursor;

  if (combined.length === 0) {
    const twins = getTwoTokenPostSearchTokens(options.rawQ);
    if (twins) {
      const [t1, t2] = twins;
      const second = await fetchSearchPosts(supabase, searchPostsBaseOpts(options, t1));
      if (second.error) {
        return { ...second, effectiveContentSubstring: t1 };
      }
      if ((second.data?.length ?? 0) > 0) {
        combined = second.data ?? [];
        hasMore = second.hasMore;
        nextCursor = second.nextCursor;
        effectiveContentSubstring = t1;
      } else {
        const third = await fetchSearchPosts(supabase, searchPostsBaseOpts(options, t2));
        if (third.error) {
          return { ...third, effectiveContentSubstring: t2 };
        }
        combined = third.data ?? [];
        hasMore = third.hasMore;
        nextCursor = third.nextCursor;
        effectiveContentSubstring = t2;
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
        tagMatchMode,
        viewerUserId: options.viewerUserId ?? null,
        authorUserId: resolved.id,
        excludeNsfwFromFeed: options.excludeNsfwFromFeed,
        limit: pageLimit ?? DEFAULT_FEED_PAGE_SIZE,
        cursor: null,
      });
      if (!scoped.error && (scoped.data?.length ?? 0) > 0) {
        const merged = mergeSearchPostsNewestFirstUnique(combined, scoped.data ?? []);
        if (pageLimit !== undefined) {
          const sliced = sliceFeedQueryPage(merged, pageLimit);
          const mergedHasMore = sliced.hasMore || hasMore || scoped.hasMore;
          const lastVisible = sliced.pageRows[sliced.pageRows.length - 1];
          const mergedNextCursor =
            sliced.nextCursor ??
            (mergedHasMore && lastVisible
              ? { created_at: lastVisible.created_at, id: lastVisible.id }
              : null);
          return {
            data: sliced.pageRows,
            error: null,
            nextCursor: mergedNextCursor,
            hasMore: mergedHasMore,
            effectiveContentSubstring,
          };
        }
        combined = merged;
      }
    }
  }

  return {
    data: combined,
    error: null,
    nextCursor,
    hasMore,
    effectiveContentSubstring,
  };
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
