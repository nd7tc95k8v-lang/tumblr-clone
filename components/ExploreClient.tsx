"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
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
  initialPosts: FeedPost[];
  initialLoadError: string | null;
  initialHasMore?: boolean;
};

const EXPLORE_PAGE_SIZE = DEFAULT_FEED_PAGE_SIZE;

export default function ExploreClient({ initialPosts, initialLoadError, initialHasMore = false }: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [nsfwFeedMode, setNsfwFeedMode] = useState<NsfwFeedMode>(DEFAULT_NSFW_FEED_MODE);
  const [viewerDefaultPostsNsfw, setViewerDefaultPostsNsfw] = useState(false);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const [cursor, setCursor] = useState<FeedPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialLoadError);

  const bootstrapSeq = useRef(0);
  const nsfwFeedModeRef = useRef(nsfwFeedMode);
  nsfwFeedModeRef.current = nsfwFeedMode;
  const userRef = useRef(user);
  userRef.current = user;

  const applyExplorePage = useCallback(
    (result: Awaited<ReturnType<typeof fetchFeedPosts>>, replace: boolean) => {
      if (result.error) {
        setError(result.error.message);
        if (replace) setPosts([]);
        setHasMore(false);
        setCursor(null);
        return;
      }
      setError(null);
      setPosts((prev) => (replace ? (result.data ?? []) : appendFeedPostsDedupe(prev, result.data ?? [])));
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    },
    [],
  );

  const fetchExplorePage = useCallback(
    async (opts: { cursor: FeedPageCursor | null; replace: boolean }) => {
      if (!supabase) return;
      const u = userRef.current;
      const mode = nsfwFeedModeRef.current;
      const result = await fetchFeedPosts(supabase, {
        limit: EXPLORE_PAGE_SIZE,
        cursor: opts.cursor,
        viewerUserId: u?.id ?? null,
        excludeNsfwFromFeed: Boolean(u) && excludeNsfwPostsFromFeedQuery(mode),
      });
      applyExplorePage(result, opts.replace);
    },
    [supabase, applyExplorePage],
  );

  useEffect(() => {
    if (!supabase) return;

    const syncFeedFromSession = async () => {
      const seq = ++bootstrapSeq.current;
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (seq !== bootstrapSeq.current) return;

      const u = session?.user ?? null;
      setUser(u);

      if (!u) {
        setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
        setViewerDefaultPostsNsfw(false);
        setPosts(initialPosts);
        setError(initialLoadError);
        setHasMore(initialHasMore);
        const last = initialPosts[initialPosts.length - 1];
        setCursor(
          initialHasMore && last
            ? { created_at: last.created_at, id: last.id }
            : null,
        );
        setLoading(false);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("nsfw_feed_mode, default_posts_nsfw")
        .eq("id", u.id)
        .maybeSingle();
      if (seq !== bootstrapSeq.current) return;
      if (profErr) {
        console.error(profErr);
      }

      const mode = resolveNsfwFeedModeFromProfileRow(prof);
      setNsfwFeedMode(mode);
      setViewerDefaultPostsNsfw(Boolean(prof?.default_posts_nsfw));
      nsfwFeedModeRef.current = mode;
      userRef.current = u;

      const result = await fetchFeedPosts(supabase, {
        limit: EXPLORE_PAGE_SIZE,
        cursor: null,
        viewerUserId: u.id,
        excludeNsfwFromFeed: excludeNsfwPostsFromFeedQuery(mode),
      });
      if (seq !== bootstrapSeq.current) return;

      applyExplorePage(result, true);
      setLoading(false);
    };

    void syncFeedFromSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncFeedFromSession();
    });

    return () => {
      bootstrapSeq.current += 1;
      subscription.unsubscribe();
    };
  }, [supabase, initialPosts, initialLoadError, initialHasMore, applyExplorePage]);

  const refreshSignedInFeed = useCallback(async () => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const u = session?.user ?? null;
    if (!u) {
      setPosts(initialPosts);
      setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
      setViewerDefaultPostsNsfw(false);
      setHasMore(initialHasMore);
      const last = initialPosts[initialPosts.length - 1];
      setCursor(
        initialHasMore && last ? { created_at: last.created_at, id: last.id } : null,
      );
      return;
    }
    const { data: prof } = await supabase
      .from("profiles")
      .select("nsfw_feed_mode, default_posts_nsfw")
      .eq("id", u.id)
      .maybeSingle();
    const mode = resolveNsfwFeedModeFromProfileRow(prof);
    setNsfwFeedMode(mode);
    setViewerDefaultPostsNsfw(Boolean(prof?.default_posts_nsfw));
    nsfwFeedModeRef.current = mode;
    userRef.current = u;
    await fetchExplorePage({ cursor: null, replace: true });
  }, [supabase, initialPosts, initialHasMore, fetchExplorePage]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading || !cursor) return;
    setLoadingMore(true);
    void (async () => {
      try {
        await fetchExplorePage({ cursor, replace: false });
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [hasMore, loadingMore, loading, cursor, fetchExplorePage]);

  const handleReblog = useReblogAction(supabase, {
    onSuccess: refreshSignedInFeed,
  });

  if (!supabase) {
    return (
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
        <p>
          Add <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_URL</code> and a publishable key to{" "}
          <code className="qrtz-code-inline">.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-text-secondary text-sm text-center max-w-4xl w-full">
        Public posts from everyone, newest first. Your home feed still shows only you and people you follow.
      </p>
      <Feed
        posts={posts}
        loading={loading}
        error={error}
        onRetry={() => {
          void (async () => {
            if (!supabase) return;
            setLoading(true);
            setError(null);
            try {
              await refreshSignedInFeed();
            } finally {
              setLoading(false);
            }
          })();
        }}
        onReblog={handleReblog}
        showReblog={Boolean(user)}
        supabase={supabase}
        currentUserId={user?.id ?? null}
        onPostDeleted={() => void refreshSignedInFeed()}
        onPostUpdated={() => void refreshSignedInFeed()}
        nsfwFeedMode={nsfwFeedMode}
        viewerDefaultPostsNsfw={viewerDefaultPostsNsfw}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onRefresh={refreshSignedInFeed}
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
