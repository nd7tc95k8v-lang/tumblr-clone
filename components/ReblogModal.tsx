"use client";

import React, { useEffect, useState } from "react";
import type { FeedPost } from "@/types/post";
import { bodyFromPost, usernameFromEmbed } from "@/lib/feed-post-display";

type Props = {
  post: FeedPost | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (commentary: string) => void | Promise<void>;
};

export default function ReblogModal({ post, busy, onClose, onConfirm }: Props) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (post) setText("");
  }, [post]);

  useEffect(() => {
    if (!post) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [post, busy, onClose]);

  if (!post) return null;

  const { primary } = usernameFromEmbed(post);
  const { content: quotedPreview } = bodyFromPost(post);
  const preview =
    quotedPreview.length > 200 ? `${quotedPreview.slice(0, 200).trim()}…` : quotedPreview;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reblog-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-700 p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="reblog-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          Reblog
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 line-clamp-4 whitespace-pre-wrap">
          From <span className="font-medium text-zinc-700 dark:text-zinc-300">{primary}</span>: {preview}
        </p>
        <label htmlFor="reblog-commentary" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Commentary <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="reblog-commentary"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={4}
          placeholder="Say something about this post…"
          className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y min-h-[80px] mb-4"
        />
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="py-2 px-4 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(text)}
            className="py-2 px-4 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Posting…" : "Reblog"}
          </button>
        </div>
      </div>
    </div>
  );
}
