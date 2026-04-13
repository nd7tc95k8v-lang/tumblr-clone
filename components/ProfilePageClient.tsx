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
    });
    if (error) {
      console.error(error);
      return;
    }
    setPosts(data ?? []);
  }, [supabase, localProfile.id, user?.id]);

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
        <header className="bg-surface rounded-lg shadow-sm border border-border p-6">
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
              <p className="text-2xl font-bold text-text">
                <ProfileUsernameLink usernameRaw={localProfile.username} className="font-bold text-inherit">
                  @{localProfile.username}
                </ProfileUsernameLink>
              </p>
              {localProfile.display_name?.trim() ? (
                <p className="text-lg text-text-secondary mt-1">{localProfile.display_name.trim()}</p>
              ) : null}
              {localProfile.bio?.trim() ? (
                <p className="text-sm text-text-secondary mt-3 whitespace-pre-wrap">
                  {localProfile.bio.trim()}
                </p>
              ) : null}
              <p className="text-sm text-text-muted mt-3">
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
                  className="py-1.5 px-3 text-sm font-medium rounded-md border border-border text-text hover:bg-bg-secondary transition-colors"
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
                      ? "py-1.5 px-3 text-sm font-medium rounded-md border border-border text-text hover:bg-bg-secondary disabled:opacity-50 transition-colors"
                      : "py-1.5 px-3 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
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
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">
            Posts
          </h2>
          {posts.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-8 bg-surface rounded-lg shadow-sm border border-border">
              No posts yet.
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
