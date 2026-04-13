"use client";

import React, { useEffect, useState } from "react";
import type { FeedPost } from "@/types/post";
import { bodyFromPost, quotedPostAuthorDisplay } from "@/lib/feed-post-display";
import { InlineErrorBanner } from "./InlineErrorBanner";

type Props = {
  post: FeedPost | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (commentary: string) => void | Promise<void>;
  errorMessage?: string | null;
  onDismissError?: () => void;
};

export default function ReblogModal({
  post,
  busy,
  onClose,
  onConfirm,
  errorMessage = null,
  onDismissError,
}: Props) {
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

  const quotedAuthor = quotedPostAuthorDisplay(post);
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
        className="w-full max-w-md rounded-lg bg-surface-elevated shadow-xl border border-border p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="reblog-modal-title" className="text-lg font-semibold text-text mb-2">
          Quote
        </h2>
        <p className="text-xs text-text-muted mb-3 line-clamp-4 whitespace-pre-wrap">
          From <span className="font-medium text-text-secondary">{quotedAuthor}</span>: {preview}
        </p>
        <label htmlFor="reblog-commentary" className="block text-sm font-medium text-text-secondary mb-1">
          Commentary <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <textarea
          id="reblog-commentary"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (errorMessage && onDismissError) onDismissError();
          }}
          disabled={busy}
          rows={4}
          placeholder="Say something about this post…"
          className="w-full p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus resize-y min-h-[80px] mb-3"
        />
        {errorMessage?.trim() && onDismissError ? (
          <InlineErrorBanner message={errorMessage} onDismiss={onDismissError} className="mb-3" />
        ) : null}
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="py-2 px-4 rounded border border-border bg-surface text-text text-sm font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(text)}
            className="py-2 px-4 rounded bg-primary text-white text-sm font-semibold hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50 transition-colors"
          >
            {busy ? "Quoting…" : "Quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
