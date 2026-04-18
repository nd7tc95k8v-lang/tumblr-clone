"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  DEFAULT_NSFW_FEED_MODE,
  excludeNsfwPostsFromFeedQuery,
  resolveNsfwFeedModeFromProfileRow,
  type NsfwFeedMode,
} from "@/lib/nsfw-feed-preference";
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
  const [nsfwFeedMode, setNsfwFeedMode] = useState<NsfwFeedMode>(DEFAULT_NSFW_FEED_MODE);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bootstrapSeq = useRef(0);

  useEffect(() => {
    if (!supabase) return;

    const syncFeedFromSession = async () => {
      const seq = ++bootstrapSeq.current;
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (seq !== bootstrapSeq.current) return;

      const u = session?.user ?? null;
      setUser(u);

      if (!u) {
        setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
        setPosts(initialPosts);
        setError(initialLoadError);
        setLoading(false);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("nsfw_feed_mode")
        .eq("id", u.id)
        .maybeSingle();
      if (seq !== bootstrapSeq.current) return;
      if (profErr) {
        console.error(profErr);
      }

      const mode = resolveNsfwFeedModeFromProfileRow(prof);
      setNsfwFeedMode(mode);

      const { data, error: fetchError } = await fetchFeedPosts(supabase, {
        viewerUserId: u.id,
        excludeNsfwFromFeed: excludeNsfwPostsFromFeedQuery(mode),
      });
      if (seq !== bootstrapSeq.current) return;

      if (fetchError) {
        setError(fetchError.message);
        setPosts([]);
      } else {
        setError(null);
        setPosts(data ?? []);
      }
      setLoading(false);
    };

    void syncFeedFromSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncFeedFromSession();
    });

    return () => {
      bootstrapSeq.current += 1;
      subscription.unsubscribe();
    };
  }, [supabase, initialPosts, initialLoadError]);

  const refreshSignedInFeed = useCallback(async () => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const u = session?.user ?? null;
    if (!u) {
      setPosts(initialPosts);
      setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("nsfw_feed_mode").eq("id", u.id).maybeSingle();
    const mode = resolveNsfwFeedModeFromProfileRow(prof);
    setNsfwFeedMode(mode);
    const { data, error: fetchError } = await fetchFeedPosts(supabase, {
      viewerUserId: u.id,
      excludeNsfwFromFeed: excludeNsfwPostsFromFeedQuery(mode),
    });
    if (!fetchError) setPosts(data ?? []);
  }, [supabase, initialPosts]);

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
        await refreshSignedInFeed();
      });
      return succeeded;
    },
    [supabase, runProtectedAction, refreshSignedInFeed],
  );

  if (!supabase) {
    return (
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
        <p>
          Add <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_URL</code> and a publishable key to{" "}
          <code className="qrtz-code-inline">.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-text-secondary text-sm text-center max-w-4xl w-full">
        Public posts from everyone, newest first. Your home feed still shows only you and people you follow.
      </p>
      <Feed
        posts={posts}
        loading={loading}
        error={error}
        onRetry={() => {
          void (async () => {
            if (!supabase) return;
            setLoading(true);
            setError(null);
            try {
              const {
                data: { session },
              } = await supabase.auth.getSession();
              const u = session?.user ?? null;
              setUser(u);
              if (!u) {
                setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
                setPosts(initialPosts);
                setError(initialLoadError);
                return;
              }
              const { data: prof } = await supabase
                .from("profiles")
                .select("nsfw_feed_mode")
                .eq("id", u.id)
                .maybeSingle();
              const mode = resolveNsfwFeedModeFromProfileRow(prof);
              setNsfwFeedMode(mode);
              const { data, error: fetchError } = await fetchFeedPosts(supabase, {
                viewerUserId: u.id,
                excludeNsfwFromFeed: excludeNsfwPostsFromFeedQuery(mode),
              });
              if (fetchError) {
                setError(fetchError.message);
                setPosts([]);
              } else {
                setError(null);
                setPosts(data ?? []);
              }
            } finally {
              setLoading(false);
            }
          })();
        }}
        onReblog={handleReblog}
        showReblog={Boolean(user)}
        supabase={supabase}
        currentUserId={user?.id ?? null}
        onPostDeleted={() => void refreshSignedInFeed()}
        onPostUpdated={() => void refreshSignedInFeed()}
        nsfwFeedMode={nsfwFeedMode}
      />
      {!user ? (
        <p className="text-center text-meta text-text-muted">
          <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
            Sign in
          </Link>{" "}
          to reblog.
        </p>
      ) : null}
    </>
  );
}
