"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchFeedPostById } from "@/lib/supabase/fetch-feed-posts";
import type { FeedPost } from "@/types/post";
import { useReblogAction } from "./useReblogAction";
import PostCard from "./PostCard";

/** Match {@link Feed} stream shell so the permalink card matches feed layout. */
const FEED_OUTER = "mx-auto w-full max-w-3xl px-3 sm:px-6";
const FEED_STREAM =
  "rounded-2xl bg-bg-secondary/20 p-1 sm:p-1.5 dark:bg-bg-secondary/30 [&>article]:border-border/40 [&>article]:shadow-none";

type Props = {
  postId: string;
  initialPost: FeedPost;
};

export default function PostPermalinkClient({ postId, initialPost }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [post, setPost] = useState<FeedPost>(initialPost);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rebloggingId, setRebloggingId] = useState<string | null>(null);

  useEffect(() => {
    setPost(initialPost);
  }, [initialPost]);

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

  const loadPost = useCallback(async () => {
    if (!supabase) return;
    setLoadError(null);
    const { data, error } = await fetchFeedPostById(supabase, postId, user?.id ?? null);
    if (error) {
      setLoadError(error.message);
      return;
    }
    if (!data) {
      setLoadError("This post is no longer available.");
      return;
    }
    setPost(data);
  }, [supabase, postId, user?.id]);

  useEffect(() => {
    if (!supabase) return;
    void loadPost();
  }, [supabase, user?.id, loadPost]);

  const handleReblog = useReblogAction(supabase, {
    onSuccess: loadPost,
  });

  const onPostDeleted = useCallback(() => {
    router.push("/");
  }, [router]);

  if (!supabase) {
    return (
      <div className={`${FEED_OUTER} py-8`}>
        <p className="text-center text-sm text-text-secondary">Supabase is not configured.</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`${FEED_OUTER} py-8`}>
        <p className="text-center text-sm text-error" role="alert">
          {loadError}
        </p>
        <p className="mt-4 text-center text-meta text-text-muted">
          <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
            Back to home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className={`${FEED_OUTER} flex flex-col gap-2`}>
      <div className={FEED_STREAM}>
        <PostCard
          post={post}
          rebloggingId={rebloggingId}
          showReblog={Boolean(user)}
          supabase={supabase}
          currentUserId={user?.id ?? null}
          hidePermalink
          onReblog={async (p, commentary, tags) => {
            setRebloggingId(p.id);
            try {
              return await handleReblog(p, commentary, tags);
            } finally {
              setRebloggingId(null);
            }
          }}
          onPostDeleted={onPostDeleted}
          onPostUpdated={loadPost}
        />
      </div>
    </div>
  );
}
