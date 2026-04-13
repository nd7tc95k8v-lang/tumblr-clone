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
      className="qrtz-modal-overlay"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reblog-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="qrtz-modal-panel"
      >
        <h2 id="reblog-modal-title" className="mb-2 font-heading text-lg font-semibold text-text">
          Quote
        </h2>
        <p className="mb-3 line-clamp-4 whitespace-pre-wrap text-meta text-text-muted">
          From <span className="font-medium text-text-secondary">{quotedAuthor}</span>: {preview}
        </p>
        <p className="mb-2 text-meta text-text-muted">
          If the post is mature (NSFW), your reblog stays mature too—the database enforces inheritance.
        </p>
        <label htmlFor="reblog-commentary" className="mb-1.5 block text-meta font-medium text-text-secondary">
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
          className="qrtz-field mb-3 min-h-[80px] resize-y"
        />
        {errorMessage?.trim() && onDismissError ? (
          <InlineErrorBanner message={errorMessage} onDismiss={onDismissError} className="mb-3" />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="qrtz-btn-secondary px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm(text)}
            className="qrtz-btn-primary px-4 py-2 text-sm"
          >
            {busy ? "Quoting…" : "Quote"}
          </button>
        </div>
      </div>
    </div>
  );
}
