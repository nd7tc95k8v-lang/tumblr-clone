"use client";

import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedPost } from "@/types/post";
import PostCard from "./PostCard";

type Props = {
  posts: FeedPost[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onReblog: (post: FeedPost, commentary?: string | null) => boolean | Promise<boolean>;
  showReblog?: boolean;
  supabase: SupabaseClient | null;
  currentUserId: string | null;
};

const Feed: React.FC<Props> = ({
  posts,
  loading,
  error,
  onRetry,
  onReblog,
  showReblog = true,
  supabase,
  currentUserId,
}) => {
  const [rebloggingId, setRebloggingId] = useState<string | null>(null);
  if (loading && posts.length === 0) {
    return <p className="text-text-muted text-sm w-full max-w-xl mx-auto">Loading posts…</p>;
  }

  if (error) {
    return (
      <div className="w-full max-w-xl mx-auto p-4 rounded-card border border-error/30 bg-error/10 text-text text-sm flex flex-col gap-2">
        <p>{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-left underline font-medium text-link hover:text-link-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <p className="text-text-muted text-sm w-full max-w-xl mx-auto text-center">
        No posts yet. Be the first to post.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-xl mx-auto">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          rebloggingId={rebloggingId}
          showReblog={showReblog}
          supabase={supabase}
          currentUserId={currentUserId}
          onReblog={async (p, commentary) => {
            setRebloggingId(p.id);
            try {
              return await onReblog(p, commentary);
            } finally {
              setRebloggingId(null);
            }
          }}
        />
      ))}
    </div>
  );
};

export default Feed;
