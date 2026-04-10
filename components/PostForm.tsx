"use client";

import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Props = {
  supabase: SupabaseClient;
  userId: string;
  onPosted: () => void | Promise<void>;
};

const PostForm = ({ supabase, userId, onPosted }: Props) => {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const trimmed = content.trim();
    const { error: insertError } = await supabase.from("posts").insert({
      content: trimmed,
      user_id: userId,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setContent("");
    await onPosted();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 w-full max-w-md mx-auto p-6 bg-zinc-100 dark:bg-zinc-900 rounded-lg shadow-md"
    >
      <label htmlFor="post-content" className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
        Write a post
      </label>
      <textarea
        id="post-content"
        className="w-full min-h-[100px] p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What's on your mind?"
        required
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="py-2 px-4 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50"
      >
        {submitting ? "Posting…" : "Post"}
      </button>
    </form>
  );
};

export default PostForm;
