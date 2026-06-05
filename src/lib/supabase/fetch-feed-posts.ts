import type { SupabaseClient } from "@supabase/supabase-js";
import { noteOwnerPostIdForCard, patchQuotedPostChainTombstone } from "@/lib/feed-post-display";
import { isPostTombstoned } from "@/lib/post-tombstone";
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

/** Newest-first ordering for merged feed rows (`created_at desc`, then `id desc`). */
export function compareFeedPostsNewestFirst(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string },
): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (tb !== ta) return tb - ta;
  return b.id.localeCompare(a.id);
}

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
  return [...map.values()].sort(compareFeedPostsNewestFirst);
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
  deleted_at,
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
  deleted_at,
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
 *
 * ## Two ids on every `FeedPost` (intentionally different roles)
 *
 * - **`original_post_id`** here is normalized to the **thread-root / chain-structure** id (`threadRootPostId(r)`)
 *   before quote chain + `original_post` embed resolution. It answers “which chain does this row belong to?”
 * - **`card_engagement_owner_post_id`** is set per row from **`noteOwnerPostIdForCard`** — the **authored-layer /
 *   per-card engagement owner** for future Tumblr-style semantics. It can differ from `original_post_id` on
 *   plain reblog rows (collapse to leaf identity) while **`attachFeedPostEngagement` still batches on thread root**
 *   for shipped counts and `liked_by_me`.
 *
 * Do not conflate these fields: chain structure and future engagement identity diverge on purpose.
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
    post_images: coercePostImageRows(r.post_images, r.id),
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
        post_images: coercePostImageRows(row.post_images, row.id),
      });
    }
  }

  for (const [rootId, embed] of map) {
    if (!isPostTombstoned(embed)) continue;
    const chainRow = chainLookup.get(rootId);
    if (!chainRow) continue;
    chainRow.deleted_at = embed.deleted_at ?? null;
    chainRow.content = "";
    chainRow.image_url = null;
    chainRow.image_storage_path = null;
    chainRow.post_images = null;
  }

  const merged: FeedPost[] = feedRows.map((row): FeedPost => {
    const rootEmbed = map.get(row.original_post_id) ?? null;
    let quoted_post = buildQuotedPostChain(row, chainLookup);
    quoted_post = patchQuotedPostChainTombstone(quoted_post, rootEmbed);
    const mergedRow: FeedPost = {
      ...row,
      is_nsfw: Boolean(row.is_nsfw),
      tags: coercePostTags(row.tags),
      original_post: rootEmbed,
      quoted_post,
      like_count: 0,
      reblog_count: 0,
      note_comment_count: 0,
      liked_by_me: false,
      // Placeholder; authored-layer id filled immediately below (see module doc on dual identity).
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
    deleted_at: row.deleted_at ?? null,
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
    deleted_at: r.deleted_at ?? null,
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
    deleted_at: row.deleted_at ?? null,
  };
}

/** Keyset cursor for `(created_at desc, id desc)` feed pagination. */
export type FeedPageCursor = {
  created_at: string;
  id: string;
};

export const DEFAULT_FEED_PAGE_SIZE = 25;
const MAX_FEED_PAGE_SIZE = 50;

export type FetchFeedPostsResult = {
  data: FeedPost[] | null;
  error: { message: string } | null;
  nextCursor: FeedPageCursor | null;
  hasMore: boolean;
};

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
  /** When set, return at most this many rows plus pagination metadata (`limit + 1` fetched internally). */
  limit?: number;
  /** Rows strictly older than this cursor in `(created_at desc, id desc)` order. */
  cursor?: FeedPageCursor | null;
  /** Rows strictly newer than this anchor (mutually exclusive with `cursor`). For poll / prepend. */
  newerThan?: FeedPageCursor | null;
};

export function resolveFeedPageLimit(limit: number | undefined): number | undefined {
  if (limit === undefined || limit === null) return undefined;
  const n = Math.floor(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FEED_PAGE_SIZE;
  return Math.min(n, MAX_FEED_PAGE_SIZE);
}

/** Quote a value for PostgREST `.or()` filter strings (ISO timestamps need quoting). */
function postgrestFilterLiteral(value: string): string {
  if (/[,()]/.test(value) || value.includes(":")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * PostgREST `.or()` filter: rows before `cursor` when ordering by `created_at desc, id desc`.
 * Equivalent to `(created_at < ts) OR (created_at = ts AND id < id)`.
 */
export function feedKeysetBeforeCursorFilter(cursor: FeedPageCursor): string {
  const ts = postgrestFilterLiteral(cursor.created_at);
  const id = cursor.id;
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`;
}

/**
 * PostgREST `.or()` filter: rows after `cursor` when ordering by `created_at desc, id desc`
 * (i.e. strictly newer in feed order — for background poll / prepend).
 */
export function feedKeysetAfterCursorFilter(cursor: FeedPageCursor): string {
  const ts = postgrestFilterLiteral(cursor.created_at);
  const id = cursor.id;
  return `created_at.gt.${ts},and(created_at.eq.${ts},id.gt.${id})`;
}

export function sliceFeedQueryPage<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): { pageRows: T[]; hasMore: boolean; nextCursor: FeedPageCursor | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    pageRows,
    hasMore,
    nextCursor: hasMore && last ? { created_at: last.created_at, id: last.id } : null,
  };
}

/** Append feed rows without duplicate ids (stable order: existing then incoming). */
export function appendFeedPostsDedupe(existing: FeedPost[], incoming: FeedPost[]): FeedPost[] {
  const seen = new Set(existing.map((p) => p.id));
  const out = [...existing];
  for (const p of incoming) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Load feed rows, then merge chain roots as `original_post`.
 * Roots already present in the feed are reused; only missing ids are loaded in a second query.
 */
export async function fetchFeedPosts(
  supabase: SupabaseClient,
  options: FetchFeedPostsOptions = {},
): Promise<FetchFeedPostsResult> {
  const pageLimit = resolveFeedPageLimit(options.limit);

  let query = supabase
    .from("posts")
    .select(POST_FEED_BASE_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

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

  if (pageLimit !== undefined) {
    query = query.limit(pageLimit + 1);
    const newerThan = options.newerThan;
    const cursor = options.cursor;
    if (newerThan?.created_at?.trim() && newerThan.id?.trim()) {
      query = query.or(feedKeysetAfterCursorFilter(newerThan));
    } else if (cursor?.created_at?.trim() && cursor.id?.trim()) {
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
  opts?: {
    excludeNsfwFromFeed?: boolean;
    limit?: number;
    cursor?: FeedPageCursor | null;
    newerThan?: FeedPageCursor | null;
  },
): Promise<FetchFeedPostsResult> {
  if (normalizedTags.length === 0) {
    return { data: [], error: null, nextCursor: null, hasMore: false };
  }

  const pageLimit = resolveFeedPageLimit(opts?.limit);

  let query = supabase
    .from("posts")
    .select(POST_FEED_BASE_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  query = query.overlaps("tags", normalizedTags);

  if (opts?.excludeNsfwFromFeed) {
    query = query.eq("is_nsfw", false);
  }

  if (pageLimit !== undefined) {
    query = query.limit(pageLimit + 1);
    const newerThan = opts?.newerThan;
    const cursor = opts?.cursor;
    if (newerThan?.created_at?.trim() && newerThan.id?.trim()) {
      query = query.or(feedKeysetAfterCursorFilter(newerThan));
    } else if (cursor?.created_at?.trim() && cursor.id?.trim()) {
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

  const hydrated = await hydrateFeedPostsFromQueryRows(supabase, rowsToHydrate, viewerUserId ?? null);
  return {
    data: hydrated.data,
    error: hydrated.error,
    nextCursor,
    hasMore,
  };
}
