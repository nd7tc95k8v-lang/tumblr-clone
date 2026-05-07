"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FeedPost } from "@/types/post";
import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/image-upload-validation";
import { preparePostImageForUpload } from "@/lib/post-image-prep";
import { bodyFromPost, quotedPostAuthorDisplay } from "@/lib/feed-post-display";
import { parseCommaSeparatedTags } from "@/lib/tags";
import { InlineErrorBanner } from "./InlineErrorBanner";

const MAX_POST_IMAGES = 10;

function PreviewThumb({
  file,
  onRemove,
  removeDisabled,
}: {
  file: File;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="relative aspect-square w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-border/70 bg-bg-secondary ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-bg-secondary" aria-hidden />
      )}
      <button
        type="button"
        disabled={removeDisabled}
        onClick={onRemove}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-40"
        aria-label="Remove image"
      >
        ×
      </button>
    </div>
  );
}

export type ReblogModalConfirmPayload = {
  commentary: string;
  tags: string[];
  /** When the source post is SFW: user chose mature for this authored layer (checkbox). Omitted when parent is NSFW. */
  isNsfw?: boolean;
  /** Prepared image files (see {@link preparePostImageForUpload}); optional. */
  images: File[];
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPT_IMAGE_ATTR = ALLOWED_IMAGE_MIME_TYPES.join(",");

  const addValidatedFiles = useCallback(async (incoming: readonly File[]) => {
    const batch = Array.from(incoming);
    const accepted: File[] = [];
    let firstError: string | null = null;
    let room = Math.max(0, MAX_POST_IMAGES - selectedFiles.length);
    for (const f of batch) {
      if (room <= 0) break;
      const prepared = await preparePostImageForUpload(f);
      if (!prepared.ok) {
        if (!firstError) firstError = prepared.error;
        continue;
      }
      accepted.push(prepared.file);
      room -= 1;
    }
    setSelectedFiles((prev) => {
      const next = [...prev];
      for (const file of accepted) {
        if (next.length >= MAX_POST_IMAGES) break;
        next.push(file);
      }
      return next;
    });
    queueMicrotask(() => {
      if (firstError) setFilesError(firstError);
      else setFilesError(null);
    });
  }, [selectedFiles.length]);

  useEffect(() => {
    if (post) {
      setText("");
      setTagsRaw("");
      setSelectedFiles([]);
      setFilesError(null);
      setDragActive(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  const canAddCount = Math.max(0, MAX_POST_IMAGES - selectedFiles.length);

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
          Add optional commentary, tags, or photos — or reblog as-is.
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
              “Mark new posts mature by default” (Settings) applies only when you create a new original post. Reblogs of
              safe posts stay safe unless you mark them mature here; one-tap quick reblogs never use that setting.
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
        <div className="mb-3">
          <p className="mb-1.5 text-meta font-medium text-text-secondary">
            Photos <span className="font-normal text-text-muted">(optional, up to {MAX_POST_IMAGES})</span>
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_IMAGE_ATTR}
            multiple
            className="sr-only"
            aria-label="Add images to this reblog"
            disabled={busy || canAddCount === 0}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              void addValidatedFiles(files.slice(0, Math.max(0, canAddCount)));
            }}
          />
          <div
            role="button"
            tabIndex={0}
            aria-label={`Add images to this reblog, up to ${MAX_POST_IMAGES} files`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!busy && canAddCount > 0) fileInputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              if (busy || canAddCount === 0) return;
              void addValidatedFiles(Array.from(e.dataTransfer.files ?? []).slice(0, canAddCount));
            }}
            onClick={() => {
              if (busy || canAddCount === 0) return;
              setFilesError(null);
              fileInputRef.current?.click();
            }}
            className={`cursor-pointer rounded-lg border border-dashed px-3 py-2 text-center text-meta transition-colors ${
              dragActive ? "border-accent-aqua/50 bg-surface-blue/35" : "border-border/55 bg-bg-secondary/30"
            } ${busy || canAddCount === 0 ? "pointer-events-none opacity-50" : ""}`}
          >
            {canAddCount === 0 ? (
              <span className="text-text-muted">Maximum {MAX_POST_IMAGES} images.</span>
            ) : (
              <span className="text-text-secondary">Drop images here or click to add</span>
            )}
          </div>
          {selectedFiles.length > 0 ? (
            <ul className="mt-2 flex list-none flex-wrap gap-1.5 p-0">
              {selectedFiles.map((f, i) => (
                <li key={`${f.name}-${i}-${f.size}`} className="contents">
                  <PreviewThumb
                    file={f}
                    removeDisabled={busy}
                    onRemove={() => {
                      setSelectedFiles((prev) => prev.filter((_, j) => j !== i));
                      setFilesError(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {filesError?.trim() ? (
            <InlineErrorBanner
              message={filesError}
              onDismiss={() => setFilesError(null)}
              className="mt-2"
            />
          ) : null}
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
                images: selectedFiles,
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
