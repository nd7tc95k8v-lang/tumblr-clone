"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchProfileFollowCounts } from "@/lib/supabase/follow-counts";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
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
    const { data, error } = await fetchFeedPosts(supabase, {
      filterUserIds: [localProfile.id],
      viewerUserId: user?.id ?? null,
      excludeReblogs: !showReblogs,
    });
    if (error) {
      console.error(error);
      return;
    }
    setPosts(data ?? []);
  }, [supabase, localProfile.id, user?.id, showReblogs]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, user?.id, loadPosts]);

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

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <header className="qrtz-card md:p-6">
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

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-meta font-semibold uppercase tracking-wide text-text-muted">Posts</h2>
            <button
              type="button"
              onClick={() => setShowReblogs((v) => !v)}
              className="rounded-lg border border-border px-2.5 py-1.5 text-meta font-medium text-text-muted transition-colors hover:bg-bg-secondary hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/75 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
              aria-pressed={showReblogs}
            >
              {showReblogs ? "Hide reblogs" : "Show reblogs"}
            </button>
          </div>
          {posts.length === 0 ? (
            <p className="qrtz-card py-8 text-center text-sm text-text-muted">
              {showReblogs ? "No posts yet." : "No original posts yet. Show reblogs to see reposts and quotes."}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  rebloggingId={rebloggingId}
                  showReblog={showReblog}
                  supabase={supabase}
                  currentUserId={user?.id ?? null}
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
          )}
        </section>
      </div>
    </main>
  );
}
