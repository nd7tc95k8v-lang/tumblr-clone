"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchProfileFollowCounts } from "@/lib/supabase/follow-counts";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { QRTZ_POST_ELEMENT_ID_PREFIX } from "@/lib/post-anchor";
import { normalizeUsername } from "@/lib/username";
import type { ProfileFollowStats } from "@/types/follows";
import type { ProfilePublic } from "@/types/profile";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import EditProfileModal from "./EditProfileModal";
import PostCard from "./PostCard";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";
import { useReblogAction } from "./useReblogAction";

/** Match {@link Feed} layout so profile posts read as the same stream system (no edits to Feed.tsx). */
const FEED_SKELETON_KEYS = ["feed-sk-0", "feed-sk-1", "feed-sk-2"] as const;
const FEED_OUTER = "mx-auto w-full max-w-3xl px-3 sm:px-6";
const FEED_STREAM =
  "rounded-2xl bg-bg-secondary/20 p-1 sm:p-1.5 dark:bg-bg-secondary/30 [&>article]:border-border/40 [&>article]:shadow-none";

export type { ProfilePublic };

type Props = {
  profile: ProfilePublic;
  initialPosts: FeedPost[];
  initialFollowStats: ProfileFollowStats;
};

export default function ProfilePageClient({ profile, initialPosts, initialFollowStats }: Props) {
  const { runProtectedAction } = useActionGuard();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [localProfile, setLocalProfile] = useState<ProfilePublic>(profile);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const postsRef = useRef<FeedPost[]>(initialPosts);
  postsRef.current = posts;
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [rebloggingId, setRebloggingId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followStats, setFollowStats] = useState<ProfileFollowStats>(initialFollowStats);
  /** When false, fetch only originals (`reblog_of` null); quote reblogs are hidden too. */
  const [showReblogs, setShowReblogs] = useState(true);

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

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    const showSkeleton = postsRef.current.length === 0;
    setPostsError(null);
    if (showSkeleton) setPostsLoading(true);
    try {
      const { data, error } = await fetchFeedPosts(supabase, {
        filterUserIds: [localProfile.id],
        viewerUserId: user?.id ?? null,
        excludeReblogs: !showReblogs,
      });
      if (error) {
        console.error(error);
        setPostsError(error.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setPostsLoading(false);
    }
  }, [supabase, localProfile.id, user?.id, showReblogs]);

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
  const canFollow = Boolean(user && supabase && user.id !== localProfile.id);

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
    try {
      if (isFollowing) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", localProfile.id);
        if (error) {
          console.error(error);
          await alertIfLikelyRateOrGuardFailure(supabase, error, {
            kind: "follow",
            followMode: "delete",
          });
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
            await alertIfLikelyRateOrGuardFailure(supabase, error, {
              kind: "follow",
              followMode: "insert",
            });
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

  const feedBody = (() => {
    if (postsLoading && posts.length === 0) {
      return (
        <div
          className={`${FEED_OUTER} flex flex-col gap-2`}
          role="status"
          aria-busy="true"
          aria-label="Loading posts"
        >
          <div className={`flex flex-col gap-2 ${FEED_STREAM}`}>
            {FEED_SKELETON_KEYS.map((key) => (
              <article key={key} className="qrtz-card animate-pulse">
                <div className="flex gap-2.5 sm:gap-3">
                  <div
                    className="mt-px h-10 w-10 shrink-0 rounded-full bg-bg-secondary ring-1 ring-border/40"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-36 max-w-[55%] rounded-md bg-bg-secondary" aria-hidden />
                    <div className="h-3 w-28 max-w-[40%] rounded-md bg-bg-secondary/75" aria-hidden />
                    <div className="space-y-2 pt-0.5" aria-hidden>
                      <div className="h-3 w-full rounded-md bg-bg-secondary/90" />
                      <div className="h-3 w-[94%] rounded-md bg-bg-secondary/80" />
                      <div className="h-3 w-[68%] rounded-md bg-bg-secondary/70" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-1.5" aria-hidden>
                      <div className="h-3 w-14 rounded bg-bg-secondary/60" />
                      <div className="h-3 w-10 rounded bg-bg-secondary/55" />
                      <div className="h-3 w-16 rounded bg-bg-secondary/50" />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      );
    }

    if (postsError) {
      return (
        <div
          className={`${FEED_OUTER} flex flex-col gap-2 rounded-card border border-error/30 bg-error/10 p-4 text-sm text-text`}
        >
          <p>{postsError}</p>
          <button
            type="button"
            onClick={() => void loadPosts()}
            className="text-left font-medium text-link underline hover:text-link-hover"
          >
            Try again
          </button>
        </div>
      );
    }

    if (posts.length === 0) {
      return (
        <div className={`${FEED_OUTER} rounded-xl border border-border/60 bg-bg-secondary/25 px-5 py-8 text-center`}>
          <p className="text-sm font-medium text-text">
            {showReblogs ? "This blog hasn't posted yet" : "No originals in view"}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {showReblogs ? (
              isOwnProfile ? (
                <>
                  Nothing is rolling through here yet. When you share from home, your public posts land in this
                  stream—same cards and actions as your main feed.
                </>
              ) : (
                <>
                  <ProfileUsernameLink usernameRaw={localProfile.username} className="font-medium text-text">
                    @{localProfile.username}
                  </ProfileUsernameLink>{" "}
                  hasn't shared anything visible here. If they post, it will show up the same way it does on home—
                  newest first, one stream.
                </>
              )
            ) : (
              <>
                Reposts and quotes are hidden for now. Turn{" "}
                <span className="font-medium text-text">Show reblogs</span> back on to see everything in their
                stream.
              </>
            )}
          </p>
        </div>
      );
    }

    return (
      <div className={FEED_OUTER}>
        <div className={`flex flex-col gap-2 ${FEED_STREAM}`}>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              rebloggingId={rebloggingId}
              showReblog={showReblog}
              supabase={supabase}
              currentUserId={user?.id ?? null}
              onPostDeleted={loadPosts}
              onPostUpdated={loadPosts}
              onReblog={async (p, commentary) => {
                setRebloggingId(p.id);
                try {
                  return await handleReblog(p, commentary);
                } finally {
                  setRebloggingId(null);
                }
              }}
            />
          ))}
        </div>
      </div>
    );
  })();

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
              <p className="mt-3 text-meta text-text-muted">
                <span className="font-medium text-text-secondary">{followStats.followers}</span>{" "}
                followers
                <span className="mx-2 text-border-soft">·</span>
                <span className="font-medium text-text-secondary">{followStats.following}</span>{" "}
                following
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
