"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchProfileFollowCounts } from "@/lib/supabase/follow-counts";
import {
  appendFeedPostsDedupe,
  DEFAULT_FEED_PAGE_SIZE,
  fetchFeedPosts,
  type FeedPageCursor,
} from "@/lib/supabase/fetch-feed-posts";
import { resolveLikelyRateOrGuardFailureMessage } from "@/lib/action-guard/resolve-rate-or-guard-failure";
import { QRTZ_POST_ELEMENT_ID_PREFIX } from "@/lib/post-anchor";
import {
  DEFAULT_NSFW_FEED_MODE,
  resolveNsfwFeedModeFromProfileRow,
  type NsfwFeedMode,
} from "@/lib/nsfw-feed-preference";
import { normalizeUsername } from "@/lib/username";
import type { FollowListKind, ProfileFollowStats } from "@/types/follows";
import type { ProfilePublic } from "@/types/profile";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import EditProfileModal from "./EditProfileModal";
import Feed from "./Feed";
import { InlineErrorBanner } from "./InlineErrorBanner";
import ProfileAvatar from "./ProfileAvatar";
import ProfileFollowListModal from "./ProfileFollowListModal";
import ProfileUsernameLink from "./ProfileUsernameLink";
import { useReblogAction } from "./useReblogAction";

/** Match {@link Feed} outer width for profile header alignment. */
const FEED_OUTER = "mx-auto w-full max-w-3xl px-3 sm:px-6";

const PROFILE_PAGE_SIZE = DEFAULT_FEED_PAGE_SIZE;

export type { ProfilePublic };

type Props = {
  profile: ProfilePublic;
  initialPosts: FeedPost[];
  initialHasMore?: boolean;
  initialFollowStats: ProfileFollowStats;
};

export default function ProfilePageClient({
  profile,
  initialPosts,
  initialHasMore = false,
  initialFollowStats,
}: Props) {
  const { runProtectedAction } = useActionGuard();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [localProfile, setLocalProfile] = useState<ProfilePublic>(profile);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const postsRef = useRef<FeedPost[]>(initialPosts);
  postsRef.current = posts;
  const [cursor, setCursor] = useState<FeedPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [postsLoading, setPostsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [followStats, setFollowStats] = useState<ProfileFollowStats>(initialFollowStats);
  const [followListOpen, setFollowListOpen] = useState(false);
  const [followListKind, setFollowListKind] = useState<FollowListKind>("followers");
  /** When false, fetch only originals (`reblog_of` null); quote reblogs are hidden too. */
  const [showReblogs, setShowReblogs] = useState(true);
  /** Signed-in viewer’s posting default — not `localProfile` when browsing someone else’s blog. */
  const [viewerDefaultPostsNsfw, setViewerDefaultPostsNsfw] = useState(false);
  const [viewerNsfwFeedMode, setViewerNsfwFeedMode] = useState<NsfwFeedMode>(DEFAULT_NSFW_FEED_MODE);

  useEffect(() => {
    setLocalProfile(profile);
  }, [profile]);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  useEffect(() => {
    setFollowStats(initialFollowStats);
  }, [initialFollowStats]);

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
      setViewerNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
      return;
    }
    if (user.id === localProfile.id) {
      setViewerDefaultPostsNsfw(Boolean(localProfile.default_posts_nsfw));
      setViewerNsfwFeedMode(resolveNsfwFeedModeFromProfileRow(localProfile));
      return;
    }
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("default_posts_nsfw, nsfw_feed_mode")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error(error);
        setViewerDefaultPostsNsfw(Boolean(data?.default_posts_nsfw));
        setViewerNsfwFeedMode(resolveNsfwFeedModeFromProfileRow(data));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, user, localProfile.id, localProfile.default_posts_nsfw, localProfile.nsfw_feed_mode]);

  const applyProfilePage = useCallback((result: Awaited<ReturnType<typeof fetchFeedPosts>>, replace: boolean) => {
    if (result.error) {
      setPostsError(result.error.message);
      if (replace) {
        setPosts([]);
        setHasMore(false);
        setCursor(null);
      }
      return;
    }
    setPostsError(null);
    setPosts((prev) => (replace ? (result.data ?? []) : appendFeedPostsDedupe(prev, result.data ?? [])));
    setCursor(result.nextCursor);
    setHasMore(result.hasMore);
  }, []);

  const fetchProfilePage = useCallback(
    async (opts: { cursor: FeedPageCursor | null; replace: boolean }) => {
      if (!supabase) return;
      const result = await fetchFeedPosts(supabase, {
        limit: PROFILE_PAGE_SIZE,
        cursor: opts.cursor,
        filterUserIds: [localProfile.id],
        viewerUserId: user?.id ?? null,
        excludeReblogs: !showReblogs,
      });
      applyProfilePage(result, opts.replace);
    },
    [supabase, localProfile.id, user?.id, showReblogs, applyProfilePage],
  );

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    const showSkeleton = postsRef.current.length === 0;
    setPostsError(null);
    if (showSkeleton) setPostsLoading(true);
    try {
      await fetchProfilePage({ cursor: null, replace: true });
    } finally {
      setPostsLoading(false);
    }
  }, [supabase, fetchProfilePage]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || postsLoading || !cursor) return;
    setLoadingMore(true);
    void (async () => {
      try {
        await fetchProfilePage({ cursor, replace: false });
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [hasMore, loadingMore, postsLoading, cursor, fetchProfilePage]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, user?.id, loadPosts]);

  /** If URL has `#qrtz-post-…`, scroll to that card after the stream has painted (notifications / shared links). */
  useEffect(() => {
    if (typeof window === "undefined" || postsLoading) return;
    const raw = window.location.hash?.replace(/^#/, "") ?? "";
    if (!raw.startsWith(QRTZ_POST_ELEMENT_ID_PREFIX)) return;
    const el = document.getElementById(raw);
    if (!el) return;
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [postsLoading, posts]);

  const handleReblog = useReblogAction(supabase, { onSuccess: loadPosts });

  const showReblog = Boolean(user);
  const isOwnProfile = Boolean(user && user.id === localProfile.id);

  const profileEmptyTitle = showReblogs ? "This blog hasn't posted yet" : "No originals in view";
  const profileEmptyDescription = showReblogs ? (
    isOwnProfile ? (
      <>
        Nothing is rolling through here yet. When you share from home, your public posts land in this stream—same cards
        and actions as your main feed.
      </>
    ) : (
      <>
        <ProfileUsernameLink usernameRaw={localProfile.username} className="font-medium text-text">
          @{localProfile.username}
        </ProfileUsernameLink>{" "}
        hasn&apos;t shared anything visible here. If they post, it will show up the same way it does on home—newest
        first, one stream.
      </>
    )
  ) : (
    <>
      Reposts and quotes are hidden for now. Turn{" "}
      <span className="font-medium text-text">Show reblogs</span> back on to see everything in their stream.
    </>
  );

  const canFollow = Boolean(user && supabase && user.id !== localProfile.id);

  const openFollowList = useCallback((kind: FollowListKind) => {
    setFollowListKind(kind);
    setFollowListOpen(true);
  }, []);

  const refreshFollowState = useCallback(async () => {
    if (!supabase || !user || user.id === localProfile.id) {
      setIsFollowing(null);
      return;
    }
    setIsFollowing(null);
    const { data, error } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", user.id)
      .eq("following_id", localProfile.id)
      .maybeSingle();
    if (error) {
      console.error(error);
      setIsFollowing(false);
      return;
    }
    setIsFollowing(Boolean(data));
  }, [supabase, user, localProfile.id]);

  useEffect(() => {
    void refreshFollowState();
  }, [refreshFollowState]);

  const refreshFollowCounts = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await fetchProfileFollowCounts(supabase, localProfile.id);
    if (!error) {
      setFollowStats(data);
    }
  }, [supabase, localProfile.id]);

  const handleFollowToggle = useCallback(async () => {
    if (!supabase || !user || user.id === localProfile.id || followBusy) return;
    setFollowBusy(true);
    setFollowError(null);
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", localProfile.id);
        if (error) {
          console.error(error);
          setFollowError(
            await resolveLikelyRateOrGuardFailureMessage(supabase, error, {
              kind: "follow",
              followMode: "delete",
            }),
          );
        } else {
          setIsFollowing(false);
          await refreshFollowCounts();
        }
      } else {
        await runProtectedAction(supabase, { kind: "follow", followMode: "insert" }, async () => {
          const { error } = await supabase.from("follows").insert({
            follower_id: user.id,
            following_id: localProfile.id,
          });
          if (error) {
            console.error(error);
            setFollowError(
              await resolveLikelyRateOrGuardFailureMessage(supabase, error, {
                kind: "follow",
                followMode: "insert",
              }),
            );
            return;
          }
          setIsFollowing(true);
          await refreshFollowCounts();
        });
      }
    } finally {
      setFollowBusy(false);
    }
  }, [
    supabase,
    user,
    localProfile.id,
    isFollowing,
    followBusy,
    refreshFollowCounts,
    runProtectedAction,
  ]);

  const handleProfileSaved = useCallback(
    (next: ProfilePublic) => {
      const prevSlug = normalizeUsername(localProfile.username);
      const nextSlug = normalizeUsername(next.username);
      setLocalProfile(next);
      router.refresh();
      if (prevSlug !== nextSlug) {
        router.replace(`/profile/${encodeURIComponent(nextSlug)}`);
      }
    },
    [localProfile.username, router],
  );

  const feedBody = (
    <Feed
      posts={posts}
      loading={postsLoading && posts.length === 0}
      error={postsError}
      onRetry={() => void loadPosts()}
      onReblog={handleReblog}
      showReblog={showReblog}
      supabase={supabase}
      currentUserId={user?.id ?? null}
      viewerDefaultPostsNsfw={viewerDefaultPostsNsfw}
      nsfwFeedMode={viewerNsfwFeedMode}
      onPostDeleted={loadPosts}
      onPostUpdated={loadPosts}
      emptyTitle={profileEmptyTitle}
      emptyDescription={profileEmptyDescription}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={handleLoadMore}
      onRefresh={loadPosts}
    />
  );

  return (
    <div className="flex w-full flex-col gap-6">
        <header className={`qrtz-card md:p-6 ${FEED_OUTER}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ProfileAvatar
              url={localProfile.avatar_url}
              label={
                localProfile.display_name?.trim()
                  ? localProfile.display_name.trim()
                  : `@${localProfile.username}`
              }
              size="lg"
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="font-heading text-2xl font-bold tracking-tight text-text">
                <ProfileUsernameLink usernameRaw={localProfile.username} className="font-bold text-inherit">
                  @{localProfile.username}
                </ProfileUsernameLink>
              </p>
              {localProfile.display_name?.trim() ? (
                <p className="text-lg text-text-secondary mt-1">{localProfile.display_name.trim()}</p>
              ) : null}
              {localProfile.bio?.trim() ? (
                <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-text-secondary">
                  {localProfile.bio.trim()}
                </p>
              ) : null}
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-text-muted">
                <button
                  type="button"
                  onClick={() => openFollowList("followers")}
                  aria-haspopup="dialog"
                  aria-label={`${followStats.followers} followers`}
                  className="rounded-sm transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/75 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
                >
                  <span className="font-medium text-text-secondary">{followStats.followers}</span>{" "}
                  followers
                </button>
                <span className="text-border-soft" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => openFollowList("following")}
                  aria-haspopup="dialog"
                  aria-label={`${followStats.following} following`}
                  className="rounded-sm transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/75 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
                >
                  <span className="font-medium text-text-secondary">{followStats.following}</span>{" "}
                  following
                </button>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isOwnProfile && supabase ? (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="qrtz-btn-secondary px-3 py-1.5 text-sm font-medium"
                >
                  Edit profile
                </button>
              ) : null}
              {canFollow ? (
                <button
                  type="button"
                  onClick={() => void handleFollowToggle()}
                  disabled={followBusy || isFollowing === null}
                  className={
                    isFollowing
                      ? "qrtz-btn-secondary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      : "qrtz-btn-primary px-3 py-1.5 text-sm font-medium"
                  }
                >
                  {isFollowing === null
                    ? "…"
                    : followBusy
                      ? "…"
                      : isFollowing
                        ? "Unfollow"
                        : "Follow"}
                </button>
              ) : null}
            </div>
          </div>
          {followError ? (
            <InlineErrorBanner
              message={followError}
              onDismiss={() => setFollowError(null)}
              className="mt-4"
            />
          ) : null}
        </header>

        {isOwnProfile && supabase ? (
          <EditProfileModal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            supabase={supabase}
            profile={localProfile}
            userId={localProfile.id}
            onSaved={handleProfileSaved}
          />
        ) : null}

        <ProfileFollowListModal
          open={followListOpen}
          onClose={() => setFollowListOpen(false)}
          supabase={supabase}
          profileId={localProfile.id}
          profileUsername={localProfile.username}
          kind={followListKind}
          initialCount={
            followListKind === "followers" ? followStats.followers : followStats.following
          }
          isOwnProfile={isOwnProfile}
        />

        <section className="flex w-full flex-col gap-3">
          <div className={`${FEED_OUTER} flex flex-wrap items-end justify-between gap-3`}>
            <div className="min-w-0">
              <h2 className="text-meta font-semibold uppercase tracking-wide text-text-muted">Posts</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Newest first — same stream layout and actions as home.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowReblogs((v) => !v)}
              className="shrink-0 rounded-btn border border-border bg-bg-secondary px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-bg hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/75 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
              aria-pressed={showReblogs}
            >
              {showReblogs ? "Hide reblogs" : "Show reblogs"}
            </button>
          </div>
          {feedBody}
        </section>
      </div>
  );
}
