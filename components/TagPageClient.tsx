"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  followNormalizedTagForUser,
  unfollowNormalizedTagForUser,
  userFollowsNormalizedTag,
} from "@/lib/supabase/followed-tags";
import {
  DEFAULT_NSFW_FEED_MODE,
  excludeNsfwPostsFromFeedQuery,
  resolveNsfwFeedModeFromProfileRow,
  type NsfwFeedMode,
} from "@/lib/nsfw-feed-preference";
import {
  appendFeedPostsDedupe,
  DEFAULT_FEED_PAGE_SIZE,
  fetchFeedPosts,
  type FeedPageCursor,
} from "@/lib/supabase/fetch-feed-posts";
import type { FeedPost } from "@/types/post";
import Feed from "./Feed";
import { useReblogAction } from "./useReblogAction";

type Props = {
  tag: string;
  initialPosts: FeedPost[];
  initialLoadError: string | null;
  initialHasMore?: boolean;
  /** Total posts with this normalized tag in `posts.tags`; null if unknown. */
  postCount: number | null;
};

const TAG_PAGE_SIZE = DEFAULT_FEED_PAGE_SIZE;

export default function TagPageClient({
  tag,
  initialPosts,
  initialLoadError,
  initialHasMore = false,
  postCount,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const postsRef = useRef<FeedPost[]>(initialPosts);
  postsRef.current = posts;
  const [cursor, setCursor] = useState<FeedPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialLoadError);
  const [tagFollowed, setTagFollowed] = useState<boolean | null>(null);
  const [tagFollowBusy, setTagFollowBusy] = useState(false);
  const [tagFollowError, setTagFollowError] = useState<string | null>(null);
  const [viewerDefaultPostsNsfw, setViewerDefaultPostsNsfw] = useState(false);
  const [nsfwFeedMode, setNsfwFeedMode] = useState<NsfwFeedMode>(DEFAULT_NSFW_FEED_MODE);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  useEffect(() => {
    setError(initialLoadError);
  }, [initialLoadError]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !user) {
      setViewerDefaultPostsNsfw(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("default_posts_nsfw")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error: profErr }) => {
        if (!cancelled) {
          if (profErr) console.error(profErr);
          setViewerDefaultPostsNsfw(Boolean(data?.default_posts_nsfw));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !user) {
      setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
      return;
    }
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("nsfw_feed_mode")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error: profErr }) => {
        if (profErr) console.error(profErr);
        if (!cancelled) {
          setNsfwFeedMode(resolveNsfwFeedModeFromProfileRow(data));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  const applyTagPage = useCallback((result: Awaited<ReturnType<typeof fetchFeedPosts>>, replace: boolean) => {
    if (result.error) {
      setError(result.error.message);
      if (replace) {
        setPosts([]);
        setHasMore(false);
        setCursor(null);
      }
      return;
    }
    setError(null);
    setPosts((prev) => (replace ? (result.data ?? []) : appendFeedPostsDedupe(prev, result.data ?? [])));
    setCursor(result.nextCursor);
    setHasMore(result.hasMore);
  }, []);

  const fetchTagPage = useCallback(
    async (opts: { cursor: FeedPageCursor | null; replace: boolean }) => {
      if (!supabase) return;
      const result = await fetchFeedPosts(supabase, {
        limit: TAG_PAGE_SIZE,
        cursor: opts.cursor,
        filterTag: tag,
        viewerUserId: user?.id ?? null,
        excludeNsfwFromFeed: excludeNsfwPostsFromFeedQuery(nsfwFeedMode),
      });
      applyTagPage(result, opts.replace);
    },
    [supabase, tag, user?.id, nsfwFeedMode, applyTagPage],
  );

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    const showSkeleton = postsRef.current.length === 0;
    setError(null);
    if (showSkeleton) setLoading(true);
    try {
      await fetchTagPage({ cursor: null, replace: true });
    } finally {
      setLoading(false);
    }
  }, [supabase, fetchTagPage]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, loadPosts]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading || !cursor) return;
    setLoadingMore(true);
    void (async () => {
      try {
        await fetchTagPage({ cursor, replace: false });
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [hasMore, loadingMore, loading, cursor, fetchTagPage]);

  const refreshTagFollowState = useCallback(async () => {
    if (!supabase || !user) {
      setTagFollowed(null);
      setTagFollowError(null);
      return;
    }
    setTagFollowed(null);
    setTagFollowError(null);
    const { follows, error: followCheckError } = await userFollowsNormalizedTag(supabase, user.id, tag);
    if (followCheckError) {
      console.error(followCheckError);
      setTagFollowed(false);
      setTagFollowError(followCheckError.message);
      return;
    }
    setTagFollowed(follows);
  }, [supabase, user, tag]);

  useEffect(() => {
    void refreshTagFollowState();
  }, [refreshTagFollowState]);

  const handleTagFollowToggle = useCallback(async () => {
    if (!supabase || !user || tagFollowBusy || tagFollowed === null) return;
    setTagFollowBusy(true);
    setTagFollowError(null);
    try {
      if (tagFollowed) {
        const { error: unfollowErr } = await unfollowNormalizedTagForUser(supabase, user.id, tag);
        if (unfollowErr) {
          console.error(unfollowErr);
          setTagFollowError(unfollowErr.message);
          return;
        }
        setTagFollowed(false);
      } else {
        const { error: followErr } = await followNormalizedTagForUser(supabase, user.id, tag);
        if (followErr) {
          console.error(followErr);
          setTagFollowError(followErr.message);
          return;
        }
        setTagFollowed(true);
      }
    } finally {
      setTagFollowBusy(false);
    }
  }, [supabase, user, tag, tagFollowBusy, tagFollowed]);

  const handleReblog = useReblogAction(supabase, {
    onSuccess: loadPosts,
  });

  if (!supabase) {
    return (
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full max-w-4xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-text-secondary text-sm text-center sm:text-left flex-1">
          Posts tagged with <span className="font-semibold text-text">#{tag}</span>
          {typeof postCount === "number" ? (
            <span className="text-text-muted">
              {" "}
              · {postCount} {postCount === 1 ? "post" : "posts"}
            </span>
          ) : null}
          .
        </p>
        <div className="flex shrink-0 flex-col items-center gap-1 sm:items-end">
          {user ? (
            <button
              type="button"
              onClick={() => void handleTagFollowToggle()}
              disabled={tagFollowBusy || tagFollowed === null}
              className={
                tagFollowed
                  ? "qrtz-btn-secondary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  : "qrtz-btn-primary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              }
            >
              {tagFollowed === null
                ? "…"
                : tagFollowBusy
                  ? "…"
                  : tagFollowed
                    ? "Unfollow tag"
                    : "Follow tag"}
            </button>
          ) : (
            <p className="text-center text-meta text-text-muted sm:text-right">
              <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
                Sign in
              </Link>{" "}
              to follow tags.
            </p>
          )}
        </div>
      </div>
      {tagFollowError ? (
        <p className="text-center text-sm text-warning sm:self-end max-w-4xl w-full" role="alert">
          {tagFollowError}
        </p>
      ) : null}
      <Feed
        posts={posts}
        loading={loading && posts.length === 0}
        error={error}
        onRetry={() => void loadPosts()}
        onReblog={handleReblog}
        showReblog={Boolean(user)}
        supabase={supabase}
        currentUserId={user?.id ?? null}
        onPostDeleted={loadPosts}
        onPostUpdated={loadPosts}
        viewerDefaultPostsNsfw={viewerDefaultPostsNsfw}
        nsfwFeedMode={nsfwFeedMode}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onRefresh={loadPosts}
      />
      {!user ? (
        <p className="text-center text-meta text-text-muted">
          <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
            Sign in
          </Link>{" "}
          to reblog.
        </p>
      ) : null}
    </>
  );
}
