"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { FeedPost } from "@/types/post";
import AuthForm from "./AuthForm";
import Feed from "./Feed";
import PostForm from "./PostForm";

function ClientShell() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    if (!supabase) {
      setSessionReady(true);
      return;
    }
    const { data } = await supabase.auth.getSession();
    setUser(data.session?.user ?? null);
    setSessionReady(true);
  }, [supabase]);

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    setPostsLoading(true);
    setPostsError(null);
    const { data, error } = await supabase
      .from("posts")
      .select("id, content, created_at, user_id")
      .order("created_at", { ascending: false });
    setPostsLoading(false);
    if (error) {
      setPostsError(error.message);
      return;
    }
    setPosts((data as FeedPost[]) ?? []);
  }, [supabase]);

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
    if (!user) {
      setPosts([]);
      return;
    }
    void loadPosts();
  }, [user, loadPosts]);

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
      <AuthForm supabase={supabase} user={user} onAuthChange={refreshSession} />
      {!sessionReady ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : user ? (
        <>
          <Feed posts={posts} loading={postsLoading} error={postsError} onRetry={loadPosts} />
          <PostForm supabase={supabase} userId={user.id} onPosted={loadPosts} />
        </>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400 text-sm text-center max-w-md">
          Sign in to post and see the feed.
        </p>
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
