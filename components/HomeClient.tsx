"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { profileNeedsOnboarding } from "@/lib/username";
import type { FeedPost } from "@/types/post";
import AuthForm from "./AuthForm";
import Feed from "./Feed";
import UsernameOnboarding from "./UsernameOnboarding";
import { useReblogAction } from "./useReblogAction";

type ProfileRow = { id: string; username: string | null; default_posts_nsfw?: boolean };

type HomeFeedTab = "following" | "explore";

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
  /** Count of accounts this user follows (excluding self). Used for empty-follow hint. */
  const [followingOthersCount, setFollowingOthersCount] = useState<number | null>(null);
  const [homeFeedTab, setHomeFeedTab] = useState<HomeFeedTab>("following");

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
        .select("id, username, default_posts_nsfw")
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
        data = { id: user.id, username: null, default_posts_nsfw: false };
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
      if (user && homeFeedTab === "following") {
        const { data: followRows, error: followError } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", user.id);
        if (followError) {
          setFollowingOthersCount(null);
          setPostsError(followError.message);
          return;
        }
        const followedIds = (followRows ?? []).map((r: { following_id: string }) => r.following_id);
        setFollowingOthersCount(followedIds.length);
        filterUserIds = Array.from(new Set<string>([user.id, ...followedIds]));
      } else {
        if (!user) setFollowingOthersCount(null);
      }

      const { data, error } = await fetchFeedPosts(supabase, {
        filterUserIds: user && homeFeedTab === "following" ? filterUserIds : undefined,
        viewerUserId: user?.id ?? null,
      });
      if (error) {
        setPostsError(error.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setPostsLoading(false);
    }
  }, [supabase, user, homeFeedTab]);

  const handleReblog = useReblogAction(supabase, { onSuccess: loadPosts });

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
      setFollowingOthersCount(null);
      return;
    }
    if (needsOnboarding) {
      setPosts([]);
      setFollowingOthersCount(null);
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
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
        <p>
          Add <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (or legacy{" "}
          <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) to{" "}
          <code className="qrtz-code-inline">.env.local</code> in this app&apos;s project folder,{" "}
          <span className="font-medium">save the file</span>, then stop and run{" "}
          <code className="qrtz-code-inline">npm run dev</code> again so Next.js picks up the variables.
        </p>
      </div>
    );
  }

  return (
    <>
      {!sessionReady ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : user && profileLoading ? (
        <p className="text-text-muted text-sm">Loading profile…</p>
      ) : user && profileLoadFailed ? (
        <p className="mx-auto max-w-md text-sm text-error">
          Could not load your profile. Check the database migration for{" "}
          <code className="qrtz-code-inline">profiles</code> or try signing out and back in.
        </p>
      ) : user && needsOnboarding && profile ? (
        <UsernameOnboarding
          supabase={supabase}
          userId={user.id}
          onComplete={loadProfile}
        />
      ) : user && showFeed ? (
        <>
          <div className="flex w-full max-w-4xl flex-col items-stretch gap-3">
            <div
              className="flex rounded-card border border-border bg-bg-secondary p-0.5"
              role="tablist"
              aria-label="Home feed"
            >
              <button
                type="button"
                role="tab"
                aria-selected={homeFeedTab === "following"}
                id="home-tab-following"
                className={`flex-1 rounded-btn px-3 py-2 text-sm font-medium transition-colors ${
                  homeFeedTab === "following"
                    ? "qrtz-tab-selected text-text"
                    : "text-text-muted hover:text-text"
                }`}
                onClick={() => setHomeFeedTab("following")}
              >
                Following
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={homeFeedTab === "explore"}
                id="home-tab-explore"
                className={`flex-1 rounded-btn px-3 py-2 text-sm font-medium transition-colors ${
                  homeFeedTab === "explore"
                    ? "qrtz-tab-selected text-text"
                    : "text-text-muted hover:text-text"
                }`}
                onClick={() => setHomeFeedTab("explore")}
              >
                Explore
              </button>
            </div>
            <p className="text-text-secondary text-sm text-center">
              {homeFeedTab === "following"
                ? "Posts from you and people you follow."
                : "Public posts from everyone, newest first — same as the Explore page."}
            </p>
          </div>
          {homeFeedTab === "following" && followingOthersCount === 0 ? (
            <div className="w-full max-w-4xl rounded-card border border-accent-aqua/35 bg-surface-blue px-4 py-3 text-sm text-text">
              <p className="font-medium text-text mb-1">Find people to follow</p>
              <p className="text-text-secondary mb-2">
                You&apos;re not following anyone yet. Use the{" "}
                <button
                  type="button"
                  onClick={() => setHomeFeedTab("explore")}
                  className="text-link font-medium hover:text-link-hover hover:underline transition-colors"
                >
                  Explore
                </button>{" "}
                tab above (or the full{" "}
                <Link href="/explore" className="text-link font-medium hover:text-link-hover hover:underline transition-colors">
                  Explore
                </Link>{" "}
                page), then follow people you like.
              </p>
            </div>
          ) : null}
          <Feed
            posts={posts}
            loading={postsLoading}
            error={postsError}
            onRetry={loadPosts}
            onReblog={handleReblog}
            showReblog
            supabase={supabase}
            currentUserId={user?.id ?? null}
          />
        </>
      ) : user ? (
        <p className="text-text-muted text-sm">Loading profile…</p>
      ) : (
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <AuthForm supabase={supabase} onAuthChange={refreshSession} />
          <div className="flex w-full flex-col items-center gap-4 text-center">
            <p className="text-text-secondary text-sm">
              Sign in to see posts from you and people you follow, and to post. Home is your personal feed only.
            </p>
            <p className="text-text-muted text-sm">
              Browse everything that&apos;s public on{" "}
              <Link href="/explore" className="text-link font-medium hover:text-link-hover hover:underline transition-colors">
                Explore
              </Link>
              .
            </p>
          </div>
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
        <div className="h-36 rounded-card bg-bg-secondary animate-pulse" />
        <div className="h-28 rounded-card bg-bg-secondary/80 animate-pulse" />
      </div>
    );
  }

  return <ClientShell />;
}
