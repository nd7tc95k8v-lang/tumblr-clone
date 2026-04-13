"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { reblogInsertFields } from "@/lib/reblog";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import Feed from "./Feed";

type Props = {
  initialPosts: FeedPost[];
  initialLoadError: string | null;
};

export default function ExploreClient({ initialPosts, initialLoadError }: Props) {
  const { runProtectedAction } = useActionGuard();
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
      const { data, error: fetchError } = await fetchFeedPosts(supabase, {
        viewerUserId: user?.id ?? null,
      });
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [supabase, user?.id]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, user?.id, loadPosts]);

  const handleReblog = useCallback(
    async (original: FeedPost, commentary?: string | null) => {
      if (!supabase) return false;
      const {
        data: { user: u },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !u) {
        alert("You must be logged in to reblog.");
        return false;
      }
      let succeeded = false;
      await runProtectedAction(supabase, { kind: "reblog" }, async () => {
        const { error: insertError } = await supabase.from("posts").insert({
          user_id: u.id,
          ...reblogInsertFields(original, { commentary }),
        });
        if (insertError) {
          console.error(insertError);
          await alertIfLikelyRateOrGuardFailure(supabase, insertError, { kind: "reblog" });
          return;
        }
        succeeded = true;
        await loadPosts();
      });
      return succeeded;
    },
    [supabase, loadPosts, runProtectedAction],
  );

  if (!supabase) {
    return (
      <div className="w-full max-w-md mx-auto p-6 rounded-lg border border-warning/40 bg-warning/10 text-text text-sm">
        <p className="font-medium mb-2">Supabase is not configured</p>
        <p>
          Add{" "}
          <code className="text-xs bg-bg-secondary px-1 rounded border border-border">NEXT_PUBLIC_SUPABASE_URL</code> and
          a publishable key to{" "}
          <code className="text-xs bg-bg-secondary px-1 rounded border border-border">.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-text-secondary text-sm text-center max-w-xl w-full">
        Public posts from everyone, newest first. Your home feed still shows only you and people you follow.
      </p>
      <Feed
        posts={posts}
        loading={loading}
        error={error}
        onRetry={loadPosts}
        onReblog={handleReblog}
        showReblog={Boolean(user)}
        supabase={supabase}
        currentUserId={user?.id ?? null}
      />
      {!user ? (
        <p className="text-text-muted text-xs text-center">
          <Link href="/" className="text-primary hover:text-primary-hover hover:underline transition-colors">
            Sign in
          </Link>{" "}
          to reblog.
        </p>
      ) : null}
    </>
  );
}
