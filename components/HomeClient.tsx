"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { reblogInsertFields } from "@/lib/reblog";
import { profileNeedsOnboarding } from "@/lib/username";
import type { FeedPost } from "@/types/post";
import AuthForm from "./AuthForm";
import Feed from "./Feed";
import PostForm from "./PostForm";
import UsernameOnboarding from "./UsernameOnboarding";

type ProfileRow = { id: string; username: string | null };

function ClientShell() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);

  const refreshSession = useCallback(async () => {
    if (!supabase) {
      setSessionReady(true);
      return;
    }
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ?? null);
    setSessionReady(true);
  }, [supabase]);

  const loadProfile = useCallback(async () => {
    if (!supabase || !user) {
      setProfile(null);
      setProfileLoadFailed(false);
      return;
    }
    setProfileLoading(true);
    setProfileLoadFailed(false);
    try {
      let { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("id", user.id)
        .maybeSingle();
      if (error) {
        console.error(error);
        setProfile(null);
        setProfileLoadFailed(true);
        return;
      }
      if (!data) {
        const { error: insertError } = await supabase.from("profiles").insert({ id: user.id });
        if (insertError) {
          console.error(insertError);
          setProfile(null);
          setProfileLoadFailed(true);
          return;
        }
        data = { id: user.id, username: null };
      }
      setProfile(data);
    } finally {
      setProfileLoading(false);
    }
  }, [supabase, user]);

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    setPostsLoading(true);
    setPostsError(null);
    try {
      let filterUserIds: string[] | undefined;
      if (user) {
        const { data: followRows, error: followError } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", user.id);
        if (followError) {
          setPostsError(followError.message);
          return;
        }
        const followedIds = (followRows ?? []).map((r: { following_id: string }) => r.following_id);
        filterUserIds = Array.from(new Set<string>([user.id, ...followedIds]));
      }

      const { data, error } = await fetchFeedPosts(supabase, { filterUserIds });
      if (error) {
        setPostsError(error.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setPostsLoading(false);
    }
  }, [supabase, user]);

  const handleReblog = useCallback(
    async (original: FeedPost, commentary?: string | null) => {
      if (!supabase) return;
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        alert("You must be logged in to reblog.");
        return;
      }
      const { error } = await supabase.from("posts").insert({
        user_id: user.id,
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

  useEffect(() => {
    if (!supabase) return;
    void refreshSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, refreshSession]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const needsOnboarding = Boolean(user && profile && profileNeedsOnboarding(profile.username));
  const showFeed = Boolean(user && profile && !profileNeedsOnboarding(profile.username));

  useEffect(() => {
    if (!supabase || !sessionReady) return;
    if (!user) {
      setPosts([]);
      setPostsError(null);
      return;
    }
    if (needsOnboarding) {
      setPosts([]);
      return;
    }
    if (!showFeed) {
      setPosts([]);
      return;
    }
    void loadPosts();
  }, [supabase, sessionReady, user, needsOnboarding, showFeed, loadPosts]);

  if (!supabase) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-900 dark:text-amber-100 text-sm">
        <p className="font-medium mb-2">Supabase is not configured</p>
        <p>
          Add{" "}
          <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">
            NEXT_PUBLIC_SUPABASE_URL
          </code>{" "}
          and{" "}
          <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          </code>{" "}
          (or legacy{" "}
          <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>
          ) to{" "}
          <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">.env.local</code>{" "}
          in the <span className="font-medium">tumblr-clone</span> folder,{" "}
          <span className="font-medium">save the file</span>, then stop and run{" "}
          <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">npm run dev</code>{" "}
          again so Next.js picks up the variables.
        </p>
      </div>
    );
  }

  return (
    <>
      <AuthForm
        supabase={supabase}
        user={user}
        onAuthChange={refreshSession}
        publicUsername={profile?.username?.trim() || null}
        needsProfileSetup={Boolean(user && profile && profileNeedsOnboarding(profile.username))}
      />
      {!sessionReady ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : user && profileLoading ? (
        <p className="text-zinc-500 text-sm">Loading profile…</p>
      ) : user && profileLoadFailed ? (
        <p className="text-red-700 dark:text-red-300 text-sm max-w-md mx-auto">
          Could not load your profile. Check the database migration for <code className="text-xs">profiles</code>{" "}
          or try signing out and back in.
        </p>
      ) : user && needsOnboarding && profile ? (
        <UsernameOnboarding
          supabase={supabase}
          userId={user.id}
          onComplete={loadProfile}
        />
      ) : user && showFeed ? (
        <>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm text-center max-w-xl w-full">
            Posts from you and people you follow.
          </p>
          <Feed
            posts={posts}
            loading={postsLoading}
            error={postsError}
            onRetry={loadPosts}
            onReblog={handleReblog}
            showReblog
          />
          <PostForm supabase={supabase} onPosted={loadPosts} />
        </>
      ) : user ? (
        <p className="text-zinc-500 text-sm">Loading profile…</p>
      ) : (
        <div className="w-full max-w-xl flex flex-col items-center gap-4 text-center">
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            Sign in to see posts from you and people you follow, and to post. Home is your personal feed only.
          </p>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            Browse everything that&apos;s public on{" "}
            <Link href="/explore" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
              Explore
            </Link>
            .
          </p>
        </div>
      )}
    </>
  );
}

/** Avoid hydration mismatch: server vs first client paint can disagree on NEXT_PUBLIC_* inlining. */
export default function HomeClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="w-full max-w-md mx-auto space-y-4"
        aria-busy="true"
        aria-label="Loading"
      >
        <div className="h-36 rounded-lg bg-zinc-200/80 dark:bg-zinc-800/80 animate-pulse" />
        <div className="h-28 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/60 animate-pulse" />
      </div>
    );
  }

  return <ClientShell />;
}
