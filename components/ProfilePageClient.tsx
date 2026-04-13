"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchProfileFollowCounts } from "@/lib/supabase/follow-counts";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { reblogInsertFields } from "@/lib/reblog";
import { normalizeUsername } from "@/lib/username";
import type { ProfileFollowStats } from "@/types/follows";
import type { ProfilePublic } from "@/types/profile";
import type { FeedPost } from "@/types/post";
import EditProfileModal from "./EditProfileModal";
import PostCard from "./PostCard";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";

export type { ProfilePublic };

type Props = {
  profile: ProfilePublic;
  initialPosts: FeedPost[];
  initialFollowStats: ProfileFollowStats;
};

export default function ProfilePageClient({ profile, initialPosts, initialFollowStats }: Props) {
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
    });
    if (error) {
      console.error(error);
      return;
    }
    setPosts(data ?? []);
  }, [supabase, localProfile.id]);

  const handleReblog = useCallback(
    async (original: FeedPost, commentary?: string | null) => {
      if (!supabase) return;
      const {
        data: { user: u },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !u) {
        alert("You must be logged in to reblog.");
        return;
      }
      const { error } = await supabase.from("posts").insert({
        user_id: u.id,
        ...reblogInsertFields(original, { commentary }),
      });
      if (error) {
        console.error(error);
        alert("Reblog failed.");
        return;
      }
      await loadPosts();
    },
    [supabase, loadPosts],
  );

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
          alert("Could not unfollow.");
          return;
        }
        setIsFollowing(false);
        await refreshFollowCounts();
      } else {
        const { error } = await supabase.from("follows").insert({
          follower_id: user.id,
          following_id: localProfile.id,
        });
        if (error) {
          console.error(error);
          alert("Could not follow.");
          return;
        }
        setIsFollowing(true);
        await refreshFollowCounts();
      }
    } finally {
      setFollowBusy(false);
    }
  }, [supabase, user, localProfile.id, isFollowing, followBusy, refreshFollowCounts]);

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
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <header className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6">
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
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                <ProfileUsernameLink usernameRaw={localProfile.username} className="font-bold text-inherit">
                  @{localProfile.username}
                </ProfileUsernameLink>
              </p>
              {localProfile.display_name?.trim() ? (
                <p className="text-lg text-zinc-700 dark:text-zinc-200 mt-1">{localProfile.display_name.trim()}</p>
              ) : null}
              {localProfile.bio?.trim() ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-3 whitespace-pre-wrap">
                  {localProfile.bio.trim()}
                </p>
              ) : null}
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{followStats.followers}</span>{" "}
                followers
                <span className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{followStats.following}</span>{" "}
                following
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isOwnProfile && supabase ? (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="py-1.5 px-3 text-sm font-medium rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/80"
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
                      ? "py-1.5 px-3 text-sm font-medium rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 disabled:opacity-50"
                      : "py-1.5 px-3 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Posts
          </h2>
          {posts.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm text-center py-8 bg-white dark:bg-zinc-800 rounded-lg shadow">
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
                  onReblog={async (p, commentary) => {
                    setRebloggingId(p.id);
                    try {
                      await handleReblog(p, commentary);
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
