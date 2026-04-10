"use client";

import React from "react";
import type { FeedPost } from "@/types/post";

type Props = {
  posts: FeedPost[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const Feed: React.FC<Props> = ({ posts, loading, error, onRetry }) => {
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
        <article
          key={post.id}
          className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4"
        >
          <p className="text-zinc-900 dark:text-zinc-100 mb-2 whitespace-pre-wrap">
            {post.content}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatTime(post.created_at)}</p>
        </article>
      ))}
    </div>
  );
};

export default Feed;
