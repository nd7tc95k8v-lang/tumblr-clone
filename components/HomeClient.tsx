"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  fetchFeedPosts,
  fetchFeedPostsForFollowedTagsOverlap,
  mergeFollowingFeedSources,
} from "@/lib/supabase/fetch-feed-posts";
import { annotatePostsForHomeFollowingFeed } from "@/lib/home-following-feed";
import { fetchFollowedTagStringsForUser } from "@/lib/supabase/followed-tags";
import { profileNeedsOnboarding } from "@/lib/username";
import type { FeedPost, PostAuthorEmbed } from "@/types/post";
import AuthForm from "./AuthForm";
import Feed from "./Feed";
import UsernameOnboarding from "./UsernameOnboarding";
import { useReblogAction } from "./useReblogAction";
/** Must match `ComposeClient` — sessionStorage handoff for optimistic feed merge after compose. */
const PENDING_FEED_POST_STORAGE_KEY = "qrtz:pendingFeedPost";

type ProfileRow = { id: string; username: string | null; default_posts_nsfw?: boolean };

function dedupePostsById(posts: FeedPost[]): FeedPost[] {
  const seen = new Set<string>();
  const out: FeedPost[] = [];
  for (const p of posts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function prependWithoutDuplicate(newPost: FeedPost, existing: FeedPost[]): FeedPost[] {
  const rest = existing.filter((p) => p.id !== newPost.id);
  return [newPost, ...rest];
}

/** Newest-first snapshot vs current feed: items above the first shared id are newer than the visible top. */
function computePostsNewerThanTop(fetched: FeedPost[], current: FeedPost[]): FeedPost[] {
  const ids = new Set(current.map((p) => p.id));
  const topId = current[0]?.id;
  const out: FeedPost[] = [];
  for (const p of fetched) {
    if (topId && p.id === topId) break;
    if (!ids.has(p.id)) out.push(p);
  }
  return out;
}

function mergePendingDedupe(incoming: FeedPost[], prev: FeedPost[]): FeedPost[] {
  const seen = new Set<string>();
  const out: FeedPost[] = [];
  for (const p of incoming) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  for (const p of prev) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

const BACKGROUND_FEED_POLL_MS = 25_000;
const SCROLL_TOP_THRESHOLD_PX = 12;

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
  const [pendingNewPosts, setPendingNewPosts] = useState<FeedPost[]>([]);

  const postsRef = useRef<FeedPost[]>([]);
  postsRef.current = posts;

  const pendingScrollAdjustRef = useRef(false);
  const docHeightBeforePendingRef = useRef<number | null>(null);

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
      const { data: profileRow, error } = await supabase
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
      let data = profileRow;
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
      let followedTagStrings: string[] = [];
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

        const { tags, error: tagsError } = await fetchFollowedTagStringsForUser(supabase, user.id);
        if (tagsError) {
          setPostsError(tagsError.message);
          return;
        }
        followedTagStrings = tags;
      } else {
        if (!user) setFollowingOthersCount(null);
      }

      if (user && homeFeedTab === "following") {
        const { data: userFeed, error: userFeedError } = await fetchFeedPosts(supabase, {
          filterUserIds,
          viewerUserId: user.id,
        });
        if (userFeedError) {
          setPostsError(userFeedError.message);
          return;
        }
        let merged = userFeed ?? [];
        if (followedTagStrings.length > 0) {
          const { data: tagFeed, error: tagFeedError } = await fetchFeedPostsForFollowedTagsOverlap(
            supabase,
            followedTagStrings,
            user.id,
          );
          if (tagFeedError) {
            setPostsError(tagFeedError.message);
            return;
          }
          merged = mergeFollowingFeedSources(merged, tagFeed ?? []);
        }
        setPosts(annotatePostsForHomeFollowingFeed(merged, followedTagStrings));
      } else {
        const { data, error } = await fetchFeedPosts(supabase, {
          filterUserIds: undefined,
          viewerUserId: user?.id ?? null,
        });
        if (error) {
          setPostsError(error.message);
          return;
        }
        setPosts(dedupePostsById(data ?? []));
      }
      setPendingNewPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [supabase, user, homeFeedTab]);

  /** Same query as `loadPosts`, for background polling only — does not touch loading UI or replace the feed. */
  const fetchFeedPostsSnapshot = useCallback(async (): Promise<{ posts: FeedPost[]; error: string | null }> => {
    if (!supabase) return { posts: [], error: null };
    try {
      let filterUserIds: string[] | undefined;
      let followedTagStrings: string[] = [];
      if (user && homeFeedTab === "following") {
        const { data: followRows, error: followError } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", user.id);
        if (followError) {
          return { posts: [], error: followError.message };
        }
        const followedIds = (followRows ?? []).map((r: { following_id: string }) => r.following_id);
        filterUserIds = Array.from(new Set<string>([user.id, ...followedIds]));

        const { tags, error: tagsError } = await fetchFollowedTagStringsForUser(supabase, user.id);
        if (tagsError) {
          return { posts: [], error: tagsError.message };
        }
        followedTagStrings = tags;
      }

      if (user && homeFeedTab === "following") {
        const { data: userFeed, error: userFeedError } = await fetchFeedPosts(supabase, {
          filterUserIds,
          viewerUserId: user.id,
        });
        if (userFeedError) {
          return { posts: [], error: userFeedError.message };
        }
        let merged = userFeed ?? [];
        if (followedTagStrings.length > 0) {
          const { data: tagFeed, error: tagFeedError } = await fetchFeedPostsForFollowedTagsOverlap(
            supabase,
            followedTagStrings,
            user.id,
          );
          if (tagFeedError) {
            return { posts: [], error: tagFeedError.message };
          }
          merged = mergeFollowingFeedSources(merged, tagFeed ?? []);
        }
        return { posts: annotatePostsForHomeFollowingFeed(merged, followedTagStrings), error: null };
      }

      const { data, error } = await fetchFeedPosts(supabase, {
        filterUserIds: undefined,
        viewerUserId: user?.id ?? null,
      });
      if (error) {
        return { posts: [], error: error.message };
      }
      return { posts: dedupePostsById(data ?? []), error: null };
    } catch (e) {
      return { posts: [], error: e instanceof Error ? e.message : "Unknown error" };
    }
  }, [supabase, user, homeFeedTab]);

  const prependPostWithScrollPreserve = useCallback((post: FeedPost) => {
    docHeightBeforePendingRef.current = document.documentElement.scrollHeight;
    pendingScrollAdjustRef.current = true;
    setPosts((prev) => prependWithoutDuplicate(post, prev));
  }, []);

  const prependManyWithScrollPreserve = useCallback((incoming: FeedPost[]) => {
    if (incoming.length === 0) return;
    docHeightBeforePendingRef.current = document.documentElement.scrollHeight;
    pendingScrollAdjustRef.current = true;
    setPosts((prev) => {
      let next = prev;
      for (let i = incoming.length - 1; i >= 0; i--) {
        next = prependWithoutDuplicate(incoming[i]!, next);
      }
      return next;
    });
  }, []);

  const getViewerAuthor = useCallback((): PostAuthorEmbed | null => {
    if (!profile) return null;
    return { username: profile.username, avatar_url: null };
  }, [profile]);

  const handleReblog = useReblogAction(supabase, {
    onOptimisticFeedPost: prependPostWithScrollPreserve,
    getViewerAuthor,
    onSuccess: loadPosts,
  });

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

  useEffect(() => {
    setPendingNewPosts([]);
  }, [homeFeedTab]);

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

    try {
      const raw = sessionStorage.getItem(PENDING_FEED_POST_STORAGE_KEY);
      if (raw) {
        sessionStorage.removeItem(PENDING_FEED_POST_STORAGE_KEY);
        const pending = JSON.parse(raw) as FeedPost;
        if (pending && typeof pending.id === "string" && pending.id.length > 0) {
          prependPostWithScrollPreserve(pending);
        }
      }
    } catch {
      try {
        sessionStorage.removeItem(PENDING_FEED_POST_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }

    void loadPosts();
  }, [supabase, sessionReady, user, needsOnboarding, showFeed, loadPosts, prependPostWithScrollPreserve]);

  const runBackgroundFeedPoll = useCallback(async () => {
    if (!showFeed || needsOnboarding || postsLoading) return;
    const { posts: snapshot, error } = await fetchFeedPostsSnapshot();
    if (error) return;
    const current = postsRef.current;
    const newAtTop = computePostsNewerThanTop(snapshot, current);
    if (newAtTop.length === 0) return;

    const nearTop = window.scrollY <= SCROLL_TOP_THRESHOLD_PX;
    if (nearTop) {
      prependManyWithScrollPreserve(newAtTop);
      setPendingNewPosts((prev) => prev.filter((p) => !newAtTop.some((n) => n.id === p.id)));
    } else {
      setPendingNewPosts((prev) => mergePendingDedupe(newAtTop, prev));
    }
  }, [
    showFeed,
    needsOnboarding,
    postsLoading,
    fetchFeedPostsSnapshot,
    prependManyWithScrollPreserve,
  ]);

  useEffect(() => {
    if (!showFeed || needsOnboarding) return;
    const id = window.setInterval(() => {
      void runBackgroundFeedPoll();
    }, BACKGROUND_FEED_POLL_MS);
    return () => window.clearInterval(id);
  }, [showFeed, needsOnboarding, homeFeedTab, runBackgroundFeedPoll]);

  useLayoutEffect(() => {
    if (!pendingScrollAdjustRef.current) return;
    pendingScrollAdjustRef.current = false;
    const before = docHeightBeforePendingRef.current;
    docHeightBeforePendingRef.current = null;
    if (before == null) return;
    const delta = document.documentElement.scrollHeight - before;
    if (delta > 0 && window.scrollY > 0) {
      window.scrollBy(0, delta);
    }
  }, [posts]);

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
                ? "Posts from people and tags you follow."
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
          {pendingNewPosts.length > 0 ? (
            <div className="flex w-full max-w-4xl justify-center">
              <button
                type="button"
                onClick={() => {
                  setPendingNewPosts((pending) => {
                    if (pending.length === 0) return pending;
                    const batch = pending;
                    queueMicrotask(() => prependManyWithScrollPreserve(batch));
                    return [];
                  });
                }}
                className="rounded-full border border-accent-aqua/40 bg-bg-secondary px-4 py-1.5 text-sm font-medium text-text shadow-sm transition-colors hover:border-accent-aqua/60 hover:bg-surface-blue"
              >
                New posts ({pendingNewPosts.length})
              </button>
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
            onPostDeleted={loadPosts}
            onPostUpdated={loadPosts}
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
