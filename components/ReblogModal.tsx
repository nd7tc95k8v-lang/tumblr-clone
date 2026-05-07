"use client";

import React, { useEffect, useState } from "react";
import type { FeedPost } from "@/types/post";
import { bodyFromPost, quotedPostAuthorDisplay } from "@/lib/feed-post-display";
import { parseCommaSeparatedTags } from "@/lib/tags";
import { InlineErrorBanner } from "./InlineErrorBanner";

export type ReblogModalConfirmPayload = {
  commentary: string;
  tags: string[];
  /** When the source post is SFW: user chose mature for this authored layer (checkbox). Omitted when parent is NSFW. */
  isNsfw?: boolean;
};

type Props = {
  post: FeedPost | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (payload: ReblogModalConfirmPayload) => void | Promise<void>;
  errorMessage?: string | null;
  onDismissError?: () => void;
  /** For default checked state when source is not NSFW. */
  viewerDefaultPostsNsfw?: boolean;
};

export default function ReblogModal({
  post,
  busy,
  onClose,
  onConfirm,
  errorMessage = null,
  onDismissError,
  viewerDefaultPostsNsfw = false,
}: Props) {
  const [text, setText] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [markMature, setMarkMature] = useState(false);

  useEffect(() => {
    if (post) {
      setText("");
      setTagsRaw("");
      const sourceIsMature = post.is_nsfw === true;
      setMarkMature(!sourceIsMature && viewerDefaultPostsNsfw);
    }
  }, [post, viewerDefaultPostsNsfw]);

  useEffect(() => {
    if (!post) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [post, busy, onClose]);

  if (!post) return null;

  const sourceIsMature = post.is_nsfw === true;
  const quotedAuthor = quotedPostAuthorDisplay(post);
  const { content: quotedPreview } = bodyFromPost(post);
  const preview =
    quotedPreview.length > 200 ? `${quotedPreview.slice(0, 200).trim()}…` : quotedPreview;

  const dismissErrorIfNeeded = () => {
    if (errorMessage && onDismissError) onDismissError();
  };

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
        className="qrtz-modal-panel max-h-[85vh] overflow-y-auto"
      >
        <h2 id="reblog-modal-title" className="mb-1 font-heading text-lg font-semibold text-text">
          Reblog
        </h2>
        <p className="mb-2 text-meta leading-snug text-text-secondary">
          Add optional commentary and tags — or reblog as-is.
        </p>
        <p className="mb-3 line-clamp-4 whitespace-pre-wrap text-meta text-text-muted">
          From <span className="font-medium text-text-secondary">{quotedAuthor}</span>: {preview}
        </p>
        {sourceIsMature ? (
          <p className="mb-3 text-meta text-text-secondary leading-snug">
            This reblog will stay marked mature because the original post is mature.
          </p>
        ) : (
          <>
            <p className="mb-2 text-meta text-text-muted leading-snug">
              From here, “Mark new posts mature by default” (Settings) applies to reblogs of safe posts unless you clear
              the checkbox. Quick reblogs of safe posts don’t use that default.
            </p>
          <label className="mb-3 flex cursor-pointer items-start gap-2 text-meta text-text-secondary">
            <input
              type="checkbox"
              checked={markMature}
              onChange={(e) => {
                setMarkMature(e.target.checked);
                dismissErrorIfNeeded();
              }}
              disabled={busy}
              className="qrtz-checkbox mt-0.5"
            />
            <span>
              <span className="font-medium text-text">Mark this reblog as mature</span>
              <span className="mt-0.5 block text-[0.8125rem] leading-snug text-text-muted">
                Use if your commentary or resharing adds mature content. Once this reblog is mature, it can&apos;t be
                removed after posting (same as original posts).
              </span>
            </span>
          </label>
          </>
        )}
        <label htmlFor="reblog-commentary" className="mb-1.5 block text-meta font-medium text-text-secondary">
          Commentary <span className="font-normal text-text-muted">(optional)</span>
        </label>
        <textarea
          id="reblog-commentary"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            dismissErrorIfNeeded();
          }}
          disabled={busy}
          rows={3}
          placeholder="Say something about this post…"
          className="qrtz-field mb-3 min-h-[72px] resize-y"
        />
        <div className="mb-3 flex flex-col gap-1">
          <label htmlFor="reblog-tags" className="text-meta font-medium text-text-secondary">
            Tags <span className="font-normal text-text-muted">· optional, commas</span>
          </label>
          <input
            id="reblog-tags"
            type="text"
            value={tagsRaw}
            onChange={(e) => {
              setTagsRaw(e.target.value);
              dismissErrorIfNeeded();
            }}
            disabled={busy}
            placeholder="e.g. photo, weekend, cats"
            className="qrtz-field py-2 text-sm"
          />
        </div>
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
            onClick={() =>
              void onConfirm({
                commentary: text,
                tags: parseCommaSeparatedTags(tagsRaw),
                ...(sourceIsMature ? {} : { isNsfw: markMature }),
              })
            }
            className="qrtz-btn-primary px-4 py-2 text-sm"
          >
            {busy ? "Reblogging…" : "Reblog"}
          </button>
        </div>
      </div>
    </div>
  );
}
