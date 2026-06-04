import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annotatePostsForHomeFollowingFeed,
  filterHomeFollowingFeedByAllowedAuthors,
} from "@/lib/home-following-feed";
import type { FeedPost } from "@/types/post";
import {
  DEFAULT_FEED_PAGE_SIZE,
  fetchFeedPosts,
  fetchFeedPostsForFollowedTagsOverlap,
  mergeFollowingFeedSources,
  resolveFeedPageLimit,
  sliceFeedQueryPage,
  type FeedPageCursor,
  type FetchFeedPostsResult,
} from "@/lib/supabase/fetch-feed-posts";

/** Per-source batch size while iteratively filling a Home page (filter may drop reblogs). */
const HOME_MERGE_BATCH_SIZE = DEFAULT_FEED_PAGE_SIZE + 1;

/** Safety cap on merge iterations per page request. */
const MAX_HOME_MERGE_ITERATIONS = 10;

/** Background poll: max newer-than-top posts to consider per tick. */
export const HOME_FEED_POLL_NEWER_LIMIT = 20;

export type FetchHomeFollowingFeedPageOptions = {
  viewerUserId: string;
  /** Accounts the viewer follows (excluding self). */
  followedUserIds: string[];
  followedTags: string[];
  excludeNsfwFromFeed: boolean;
  limit?: number;
  /** Global keyset cursor on merged `(created_at desc, id desc)` timeline. */
  cursor?: FeedPageCursor | null;
};

export type FetchHomeFollowingFeedNewerThanOptions = Omit<
  FetchHomeFollowingFeedPageOptions,
  "limit" | "cursor"
> & {
  newerThan: FeedPageCursor;
  limit?: number;
};

export type FetchHomeFollowingFeedPageResult = FetchFeedPostsResult;

function processHomeFollowingFeedRows(
  userPosts: FeedPost[],
  tagPosts: FeedPost[],
  followedTags: string[],
  viewerUserId: string,
  followedUserIds: string[],
): FeedPost[] {
  const merged = mergeFollowingFeedSources(userPosts, tagPosts);
  const annotated = annotatePostsForHomeFollowingFeed(merged, followedTags);
  return filterHomeFollowingFeedByAllowedAuthors(annotated, viewerUserId, followedUserIds);
}

type SourceFetchState = {
  cursor: FeedPageCursor | null;
  hasMore: boolean;
  posts: FeedPost[];
};

/**
 * Iteratively fetch from followed-user and followed-tag sources with aligned keyset cursors,
 * merge + annotate + filter until `pageLimit + 1` visible rows or both sources are exhausted.
 */
async function fetchHomeFollowingFeedPageInternal(
  supabase: SupabaseClient,
  options: FetchHomeFollowingFeedPageOptions & { newerThan?: FeedPageCursor | null },
): Promise<FetchHomeFollowingFeedPageResult> {
  const pageLimit = resolveFeedPageLimit(options.limit) ?? DEFAULT_FEED_PAGE_SIZE;
  const globalCursor = options.cursor ?? null;
  const newerThan = options.newerThan ?? null;
  const followedTags = options.followedTags;
  const hasTags = followedTags.length > 0;
  const filterUserIds = Array.from(new Set<string>([options.viewerUserId, ...options.followedUserIds]));

  const userState: SourceFetchState = {
    cursor: globalCursor,
    hasMore: true,
    posts: [],
  };
  const tagState: SourceFetchState = {
    cursor: globalCursor,
    hasMore: hasTags,
    posts: [],
  };

  let filteredTimeline: FeedPost[] = [];
  let iterations = 0;

  while (iterations < MAX_HOME_MERGE_ITERATIONS) {
    iterations += 1;

    if (userState.hasMore) {
      const userRes = await fetchFeedPosts(supabase, {
        filterUserIds,
        viewerUserId: options.viewerUserId,
        excludeNsfwFromFeed: options.excludeNsfwFromFeed,
        limit: HOME_MERGE_BATCH_SIZE,
        cursor: userState.posts.length > 0 || !newerThan ? userState.cursor : null,
        newerThan: userState.posts.length === 0 && newerThan ? newerThan : undefined,
      });
      if (userRes.error) {
        return { data: null, error: userRes.error, nextCursor: null, hasMore: false };
      }
      userState.posts.push(...(userRes.data ?? []));
      userState.hasMore = userRes.hasMore;
      userState.cursor = userRes.nextCursor;
    }

    if (tagState.hasMore && hasTags) {
      const tagRes = await fetchFeedPostsForFollowedTagsOverlap(
        supabase,
        followedTags,
        options.viewerUserId,
        {
          excludeNsfwFromFeed: options.excludeNsfwFromFeed,
          limit: HOME_MERGE_BATCH_SIZE,
          cursor: tagState.posts.length > 0 || !newerThan ? tagState.cursor : null,
          newerThan: tagState.posts.length === 0 && newerThan ? newerThan : undefined,
        },
      );
      if (tagRes.error) {
        return { data: null, error: tagRes.error, nextCursor: null, hasMore: false };
      }
      tagState.posts.push(...(tagRes.data ?? []));
      tagState.hasMore = tagRes.hasMore;
      tagState.cursor = tagRes.nextCursor;
    }

    filteredTimeline = processHomeFollowingFeedRows(
      userState.posts,
      tagState.posts,
      followedTags,
      options.viewerUserId,
      options.followedUserIds,
    );

    const targetCount = newerThan ? pageLimit : pageLimit + 1;
    if (filteredTimeline.length >= targetCount) break;
    if (!userState.hasMore && (!hasTags || !tagState.hasMore)) break;
  }

  if (newerThan) {
    return {
      data: filteredTimeline.slice(0, pageLimit),
      error: null,
      nextCursor: null,
      hasMore: filteredTimeline.length > pageLimit,
    };
  }

  const sliced = sliceFeedQueryPage(filteredTimeline, pageLimit);
  const sourcesMayHaveMore = userState.hasMore || (hasTags && tagState.hasMore);
  const hasMore =
    sliced.hasMore ||
    (sourcesMayHaveMore && filteredTimeline.length >= pageLimit);
  const lastVisible = sliced.pageRows[sliced.pageRows.length - 1];
  const nextCursor =
    sliced.nextCursor ??
    (hasMore && lastVisible ? { created_at: lastVisible.created_at, id: lastVisible.id } : null);

  return {
    data: sliced.pageRows,
    error: null,
    nextCursor,
    hasMore,
  };
}

/** Paginated Home following feed (followed users + followed-tag overlap, annotated + filtered). */
export async function fetchHomeFollowingFeedPage(
  supabase: SupabaseClient,
  options: FetchHomeFollowingFeedPageOptions,
): Promise<FetchHomeFollowingFeedPageResult> {
  return fetchHomeFollowingFeedPageInternal(supabase, options);
}

/**
 * Posts newer than `newerThan` on the merged Home timeline (for background poll / prepend).
 * Capped by `limit` (default {@link HOME_FEED_POLL_NEWER_LIMIT}).
 */
export async function fetchHomeFollowingFeedNewerThan(
  supabase: SupabaseClient,
  options: FetchHomeFollowingFeedNewerThanOptions,
): Promise<FetchHomeFollowingFeedPageResult> {
  return fetchHomeFollowingFeedPageInternal(supabase, {
    ...options,
    limit: options.limit ?? HOME_FEED_POLL_NEWER_LIMIT,
    cursor: null,
    newerThan: options.newerThan,
  });
}
