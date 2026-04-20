"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  followNormalizedTagForUser,
  unfollowNormalizedTagForUser,
  userFollowsNormalizedTag,
} from "@/lib/supabase/followed-tags";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { reblogInsertFields } from "@/lib/reblog";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import Feed from "./Feed";

type Props = {
  tag: string;
  initialPosts: FeedPost[];
  initialLoadError: string | null;
  /** Total posts with this normalized tag in `posts.tags`; null if unknown. */
  postCount: number | null;
};

export default function TagPageClient({ tag, initialPosts, initialLoadError, postCount }: Props) {
  const { runProtectedAction } = useActionGuard();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialLoadError);
  const [tagFollowed, setTagFollowed] = useState<boolean | null>(null);
  const [tagFollowBusy, setTagFollowBusy] = useState(false);
  const [tagFollowError, setTagFollowError] = useState<string | null>(null);

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
        filterTag: tag,
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
  }, [supabase, tag, user?.id]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, user?.id, loadPosts]);

  const refreshTagFollowState = useCallback(async () => {
    if (!supabase || !user) {
      setTagFollowed(null);
      setTagFollowError(null);
      return;
    }
    setTagFollowed(null);
    setTagFollowError(null);
    const { follows, error: followCheckError } = await userFollowsNormalizedTag(supabase, user.id, tag);
    if (followCheckError) {
      console.error(followCheckError);
      setTagFollowed(false);
      setTagFollowError(followCheckError.message);
      return;
    }
    setTagFollowed(follows);
  }, [supabase, user, tag]);

  useEffect(() => {
    void refreshTagFollowState();
  }, [refreshTagFollowState]);

  const handleTagFollowToggle = useCallback(async () => {
    if (!supabase || !user || tagFollowBusy || tagFollowed === null) return;
    setTagFollowBusy(true);
    setTagFollowError(null);
    try {
      if (tagFollowed) {
        const { error: unfollowErr } = await unfollowNormalizedTagForUser(supabase, user.id, tag);
        if (unfollowErr) {
          console.error(unfollowErr);
          setTagFollowError(unfollowErr.message);
          return;
        }
        setTagFollowed(false);
      } else {
        const { error: followErr } = await followNormalizedTagForUser(supabase, user.id, tag);
        if (followErr) {
          console.error(followErr);
          setTagFollowError(followErr.message);
          return;
        }
        setTagFollowed(true);
      }
    } finally {
      setTagFollowBusy(false);
    }
  }, [supabase, user, tag, tagFollowBusy, tagFollowed]);

  const handleReblog = useCallback(
    async (original: FeedPost, commentary?: string | null, tags?: string[]) => {
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
          ...reblogInsertFields(original, { commentary, tags: tags ?? [] }),
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
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full max-w-4xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-text-secondary text-sm text-center sm:text-left flex-1">
          Posts tagged with <span className="font-semibold text-text">#{tag}</span>
          {typeof postCount === "number" ? (
            <span className="text-text-muted">
              {" "}
              · {postCount} {postCount === 1 ? "post" : "posts"}
            </span>
          ) : null}
          .
        </p>
        <div className="flex shrink-0 flex-col items-center gap-1 sm:items-end">
          {user ? (
            <button
              type="button"
              onClick={() => void handleTagFollowToggle()}
              disabled={tagFollowBusy || tagFollowed === null}
              className={
                tagFollowed
                  ? "qrtz-btn-secondary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  : "qrtz-btn-primary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              }
            >
              {tagFollowed === null
                ? "…"
                : tagFollowBusy
                  ? "…"
                  : tagFollowed
                    ? "Unfollow tag"
                    : "Follow tag"}
            </button>
          ) : (
            <p className="text-center text-meta text-text-muted sm:text-right">
              <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
                Sign in
              </Link>{" "}
              to follow tags.
            </p>
          )}
        </div>
      </div>
      {tagFollowError ? (
        <p className="text-center text-sm text-warning sm:self-end max-w-4xl w-full" role="alert">
          {tagFollowError}
        </p>
      ) : null}
      <Feed
        posts={posts}
        loading={loading}
        error={error}
        onRetry={loadPosts}
        onReblog={handleReblog}
        showReblog={Boolean(user)}
        supabase={supabase}
        currentUserId={user?.id ?? null}
        onPostDeleted={loadPosts}
        onPostUpdated={loadPosts}
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
