"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { reblogInsertFields } from "@/lib/reblog";
import type { FeedPost } from "@/types/post";
import Feed from "./Feed";

type Props = {
  tag: string;
  initialPosts: FeedPost[];
  initialLoadError: string | null;
};

export default function TagPageClient({ tag, initialPosts, initialLoadError }: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialLoadError);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  useEffect(() => {
    setError(initialLoadError);
  }, [initialLoadError]);

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
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await fetchFeedPosts(supabase, { filterTag: tag });
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [supabase, tag]);

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
      const { error: insertError } = await supabase.from("posts").insert({
        user_id: u.id,
        ...reblogInsertFields(original, { commentary }),
      });
      if (insertError) {
        console.error(insertError);
        alert("Reblog failed.");
        return;
      }
      await loadPosts();
    },
    [supabase, loadPosts],
  );

  if (!supabase) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-900 dark:text-amber-100 text-sm">
        <p className="font-medium mb-2">Supabase is not configured</p>
      </div>
    );
  }

  return (
    <>
      <p className="text-zinc-600 dark:text-zinc-400 text-sm text-center max-w-xl w-full">
        Posts tagged with <span className="font-semibold text-zinc-800 dark:text-zinc-200">#{tag}</span>.
      </p>
      <Feed
        posts={posts}
        loading={loading}
        error={error}
        onRetry={loadPosts}
        onReblog={handleReblog}
        showReblog={Boolean(user)}
      />
      {!user ? (
        <p className="text-zinc-500 dark:text-zinc-400 text-xs text-center">
          <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">
            Sign in
          </Link>{" "}
          to reblog.
        </p>
      ) : null}
    </>
  );
}
