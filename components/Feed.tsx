"use client";

import React, { useState } from "react";
import type { FeedPost } from "@/types/post";
import PostCard from "./PostCard";

type Props = {
  posts: FeedPost[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onReblog: (post: FeedPost, commentary?: string | null) => void | Promise<void>;
  showReblog?: boolean;
};

const Feed: React.FC<Props> = ({ posts, loading, error, onRetry, onReblog, showReblog = true }) => {
  const [rebloggingId, setRebloggingId] = useState<string | null>(null);
  if (loading && posts.length === 0) {
    return <p className="text-zinc-500 text-sm w-full max-w-xl mx-auto">Loading posts…</p>;
  }

  if (error) {
    return (
      <div className="w-full max-w-xl mx-auto p-4 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-sm flex flex-col gap-2">
        <p>{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="text-left underline font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <p className="text-zinc-500 dark:text-zinc-400 text-sm w-full max-w-xl mx-auto text-center">
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
          onReblog={async (p, commentary) => {
            setRebloggingId(p.id);
            try {
              await onReblog(p, commentary);
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
