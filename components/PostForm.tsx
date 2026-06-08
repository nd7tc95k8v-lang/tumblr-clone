"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLikelyRateOrGuardFailureMessage } from "@/lib/action-guard/resolve-rate-or-guard-failure";
import { publishOriginalPost, type PublishImageSource } from "@/lib/compose";
import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/image-upload-validation";
import { preparePostImageForUpload } from "@/lib/post-image-prep";
import {
  normalizePostBodyForDedup,
  recordSuccessfulUserWrittenPost,
  validateUserWrittenContent,
} from "@/lib/post-content-guard";
import { deleteDraftImage, uploadDraftImageFiles } from "@/lib/supabase/draft-images";
import { deleteDraft } from "@/lib/supabase/delete-draft";
import { saveDraft } from "@/lib/supabase/save-draft";
import { saveQueueItem } from "@/lib/supabase/save-queue-item";
import { linkQueueImageSources, type QueueImageSource } from "@/lib/supabase/queue-images";
import { parseCommaSeparatedTags } from "@/lib/tags";
import type { PostDraft, PostDraftImageRow } from "@/types/draft";
import { InlineErrorBanner } from "./InlineErrorBanner";
import PostMediaImage from "./PostMediaImage";
import { useActionGuard } from "./ActionGuardProvider";

type Props = {
  supabase: SupabaseClient;
  onPosted: (postId: string) => void | Promise<void>;
  /** From `profiles.default_posts_nsfw`; DB trigger still final authority on insert. */
  defaultMarkNsfw?: boolean;
  /** When set, form edits an existing draft (compose?draft=). */
  initialDraft?: PostDraft | null;
};

const ACCEPT_IMAGE_ATTR = ALLOWED_IMAGE_MIME_TYPES.join(",");
const MAX_POST_IMAGES = 10;

function draftTagsToRaw(tags: string[]): string {
  return tags.filter(Boolean).join(", ");
}

function PreviewThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
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
        onClick={onRemove}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        aria-label="Remove image"
      >
        ×
      </button>
    </div>
  );
}

function DraftImageThumb({
  supabase,
  image,
  onRemove,
  removeDisabled,
}: {
  supabase: SupabaseClient;
  image: PostDraftImageRow;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className="relative aspect-square w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-border/70 bg-bg-secondary ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
      <PostMediaImage
        supabase={supabase}
        storagePath={image.storage_path}
        legacyUrl={null}
        alt=""
        className="h-full w-full object-cover"
      />
      <button
        type="button"
        disabled={removeDisabled}
        onClick={onRemove}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-40"
        aria-label="Remove saved draft image"
      >
        ×
      </button>
    </div>
  );
}

type FormSuccessState = {
  message: string;
  viewHref?: string;
  viewLabel?: string;
};

const PostForm = ({ supabase, onPosted, defaultMarkNsfw = false, initialDraft = null }: Props) => {
  const { runProtectedAction } = useActionGuard();
  const editingDraft = Boolean(initialDraft?.id);
  const [content, setContent] = useState(() => initialDraft?.content ?? "");
  const [tagsRaw, setTagsRaw] = useState(() => draftTagsToRaw(initialDraft?.tags ?? []));
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [addingToQueue, setAddingToQueue] = useState(false);
  /** Prepared attachments: each `File` is the result of {@link preparePostImageForUpload} (normalize → validate). */
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [existingDraftImages, setExistingDraftImages] = useState<PostDraftImageRow[]>(
    () => initialDraft?.post_draft_images ?? [],
  );
  const [markNsfw, setMarkNsfw] = useState(() =>
    initialDraft ? Boolean(initialDraft.is_nsfw) : Boolean(defaultMarkNsfw),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<FormSuccessState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionBackupRef = useRef<{ start: number; end: number } | null>(null);
  const skipFocusScrollRef = useRef(false);

  const formBusy = submitting || savingDraft || addingToQueue;

  const clearFormAfterSuccessfulSave = useCallback(() => {
    setContent("");
    setTagsRaw("");
    setMarkNsfw(Boolean(defaultMarkNsfw));
    setSelectedFiles([]);
    setExistingDraftImages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [defaultMarkNsfw]);

  const backupSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    selectionBackupRef.current = { start: el.selectionStart, end: el.selectionEnd };
  }, []);

  const restoreTextareaSelection = useCallback(() => {
    const el = textareaRef.current;
    const sel = selectionBackupRef.current;
    if (!el || !sel) return;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(sel.start, sel.end);
      } catch {
        /* selection out of range after edits */
      }
    });
  }, []);

  const handleTextareaFocus = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (skipFocusScrollRef.current) {
      skipFocusScrollRef.current = false;
      return;
    }
    const el = e.currentTarget;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const runScroll = () => {
      el.scrollIntoView({
        behavior: "smooth",
        block: coarse ? "center" : "nearest",
        inline: "nearest",
      });
    };
    if (coarse) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(runScroll);
      });
    } else {
      window.requestAnimationFrame(runScroll);
    }
  }, []);

  const handleTextareaBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    selectionBackupRef.current = { start: el.selectionStart, end: el.selectionEnd };
  }, []);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      if (window.matchMedia("(pointer: coarse)").matches) return;
      e.preventDefault();
      if (submitting || savingDraft || addingToQueue) return;
      e.currentTarget.form?.requestSubmit();
    },
    [submitting, savingDraft, addingToQueue],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    skipFocusScrollRef.current = true;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true });
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (editingDraft) return;
    setMarkNsfw(Boolean(defaultMarkNsfw));
  }, [defaultMarkNsfw, editingDraft]);

  const totalImageCount = existingDraftImages.length + selectedFiles.length;
  const canAddCount = useMemo(() => Math.max(0, MAX_POST_IMAGES - totalImageCount), [totalImageCount]);

  const handleRemoveExistingDraftImage = useCallback(
    async (image: PostDraftImageRow) => {
      if (formBusy) return;
      setFormError(null);
      const result = await deleteDraftImage(supabase, {
        draftId: image.draft_id,
        imageId: image.id,
        storagePath: image.storage_path,
      });
      if (result.error || !result.deleted) {
        setFormError(result.error?.message ?? "Could not remove image.");
        return;
      }
      setExistingDraftImages((prev) => prev.filter((row) => row.id !== image.id));
    },
    [supabase, formBusy],
  );

  const addValidatedFiles = useCallback(async (incoming: readonly File[]) => {
    const batch = Array.from(incoming);
    const accepted: File[] = [];
    let firstError: string | null = null;
    let room = Math.max(0, MAX_POST_IMAGES - existingDraftImages.length - selectedFiles.length);
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
      if (firstError) setFormError(firstError);
      else setFormError(null);
    });
  }, [selectedFiles.length, existingDraftImages.length]);

  const handleAddToQueue = async () => {
    setFormError(null);
    setFormSuccess(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      const detail = userError?.message?.trim();
      setFormError(
        detail ? `Sign-in check failed: ${detail}` : "You must be logged in to add to queue.",
      );
      return;
    }

    const trimmedContent = content.trim();
    const tags = parseCommaSeparatedTags(tagsRaw);
    const hasNewImages = selectedFiles.length > 0;
    const hasExistingImages = existingDraftImages.length > 0;
    const hasImages = hasNewImages || hasExistingImages;

    if (!trimmedContent && !hasImages) {
      setFormError("Add some text or images before adding to queue.");
      return;
    }

    if (!(trimmedContent === "" && hasImages)) {
      const written = validateUserWrittenContent(trimmedContent, { allowEmpty: false });
      if (!written.ok) {
        setFormError(written.message);
        return;
      }
    }

    const imageSources: QueueImageSource[] = hasImages
      ? [
          ...existingDraftImages
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((image) => ({ kind: "storage_path" as const, storagePath: image.storage_path })),
          ...selectedFiles.map((file) => ({ kind: "file" as const, file })),
        ]
      : [];

    setAddingToQueue(true);
    try {
      const { data: queueItem, error: saveError } = await saveQueueItem(supabase, {
        userId: user.id,
        content: trimmedContent,
        tags,
        isNsfw: markNsfw,
      });

      if (saveError || !queueItem) {
        setFormError(saveError?.message ?? "Could not add to queue.");
        return;
      }

      if (imageSources.length > 0) {
        const linkResult = await linkQueueImageSources(supabase, {
          userId: user.id,
          queueId: queueItem.id,
          sources: imageSources,
        });
        if (linkResult.error) {
          setFormError(
            linkResult.error.message ||
              "Added to queue, but attaching images failed. Your images are still in the form — try again or remove them from the queue item later.",
          );
          return;
        }
      }

      if (editingDraft) {
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        clearFormAfterSuccessfulSave();
      }
      setFormSuccess({
        message: "Added to queue.",
        viewHref: "/queue",
        viewLabel: "View queue",
      });
    } finally {
      setAddingToQueue(false);
    }
  };

  const handleSaveDraft = async () => {
    setFormError(null);
    setFormSuccess(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      const detail = userError?.message?.trim();
      setFormError(
        detail ? `Sign-in check failed: ${detail}` : "You must be logged in to save a draft.",
      );
      return;
    }

    const trimmedContent = content.trim();
    const tags = parseCommaSeparatedTags(tagsRaw);
    const hasNewImages = selectedFiles.length > 0;
    const hasExistingImages = existingDraftImages.length > 0;
    if (!trimmedContent && tags.length === 0 && !hasNewImages && !hasExistingImages) {
      setFormError("Add some text, tags, or images before saving a draft.");
      return;
    }

    setSavingDraft(true);
    try {
      const { data: draft, error: saveError } = await saveDraft(supabase, {
        id: initialDraft?.id,
        userId: user.id,
        content: trimmedContent,
        tags,
        isNsfw: markNsfw,
      });

      if (saveError || !draft) {
        setFormError(saveError?.message ?? "Could not save draft.");
        return;
      }

      if (selectedFiles.length > 0) {
        const uploadResult = await uploadDraftImageFiles(supabase, {
          userId: user.id,
          draftId: draft.id,
          files: selectedFiles,
        });
        if (uploadResult.error) {
          setFormError(
            uploadResult.error.message ||
              "Draft text was saved, but image upload failed. Your new images are still in the form — try saving again.",
          );
          return;
        }
        if (uploadResult.data?.length) {
          setExistingDraftImages((prev) => [...prev, ...uploadResult.data!]);
        }
      }

      if (editingDraft) {
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFormSuccess({
          message: "Draft saved.",
          viewHref: "/drafts",
          viewLabel: "View drafts",
        });
        return;
      }

      clearFormAfterSuccessfulSave();
      setFormSuccess({
        message: "Draft saved.",
        viewHref: "/drafts",
        viewLabel: "View drafts",
      });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      const detail = userError?.message?.trim();
      setFormError(
        detail
          ? `Sign-in check failed: ${detail}`
          : "You must be logged in to post.",
      );
      return;
    }

    const trimmedContent = content.trim();
    const imageSources: PublishImageSource[] = [
      ...existingDraftImages
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((image) => ({ kind: "storage_path" as const, storagePath: image.storage_path })),
      ...selectedFiles.map((file) => ({ kind: "file" as const, file })),
    ];
    const hasImages = imageSources.length > 0;
    if (!(trimmedContent === "" && hasImages)) {
      const written = validateUserWrittenContent(trimmedContent, { allowEmpty: false });
      if (!written.ok) {
        setFormError(written.message);
        return;
      }
    }

    setSubmitting(true);
    try {
      await runProtectedAction(supabase, { kind: "post" }, async () => {
        const tags = parseCommaSeparatedTags(tagsRaw);

        const result = await publishOriginalPost({
          supabase,
          userId: user.id,
          content: trimmedContent,
          tags,
          isNsfw: markNsfw,
          imageSources,
        });

        if (!result.ok) {
          if (result.stage === "post_insert") {
            setFormError(
              await resolveLikelyRateOrGuardFailureMessage(supabase, result.error, { kind: "post" }),
            );
          } else {
            setFormError(result.message);
          }
          return;
        }

        if (editingDraft && initialDraft?.id) {
          const deleteResult = await deleteDraft(supabase, initialDraft.id);
          if (deleteResult.error || !deleteResult.deleted) {
            console.error("Draft cleanup after publish failed", deleteResult.error);
          }
        }

        recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(trimmedContent));
        clearFormAfterSuccessfulSave();
        await onPosted(result.postId);
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        {editingDraft ? (
          <span className="w-fit rounded-full bg-surface-blue/35 px-2.5 py-0.5 text-meta font-medium text-text-secondary ring-1 ring-border/50">
            Editing draft
          </span>
        ) : null}
        <label htmlFor="post-content" className="text-meta font-medium text-text-secondary">
          Write a post
        </label>
      </div>
      <InlineErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      {formSuccess ? (
        <div
          role="status"
          className="flex items-start justify-between gap-2 rounded-card border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm text-text"
        >
          <div className="min-w-0 flex-1">
            <p className="leading-snug text-text-secondary">{formSuccess.message}</p>
            {formSuccess.viewHref && formSuccess.viewLabel ? (
              <Link
                href={formSuccess.viewHref}
                className="mt-1 inline-block text-meta font-medium text-link hover:text-link-hover hover:underline"
              >
                {formSuccess.viewLabel}
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setFormSuccess(null)}
            className="shrink-0 rounded px-1.5 py-0.5 text-meta font-medium text-text-muted transition-colors hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
            aria-label="Dismiss success message"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border-soft bg-input shadow-sm">
        <textarea
          ref={textareaRef}
          id="post-content"
          className="qrtz-field min-h-[128px] w-full resize-y rounded-none border-0 border-b border-border/45 bg-transparent px-3.5 py-3 text-base leading-relaxed text-text placeholder:text-text-muted shadow-none focus:ring-2 focus:ring-inset focus:ring-border-focus/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/55 scroll-mt-[calc(2.75rem+env(safe-area-inset-top,0px))] scroll-mb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            if (formError) setFormError(null);
            if (formSuccess) setFormSuccess(null);
          }}
          onSelect={backupSelection}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          onKeyDown={handleTextareaKeyDown}
          placeholder="What's on your mind?"
        />
        <div
          role="button"
          tabIndex={0}
          aria-label={`Add images to this post, optional, up to ${MAX_POST_IMAGES} files`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!formBusy && canAddCount > 0) {
                backupSelection();
                fileInputRef.current?.click();
              }
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
            if (formBusy || canAddCount === 0) return;
            backupSelection();
            addValidatedFiles(Array.from(e.dataTransfer.files ?? []));
            queueMicrotask(() => {
              restoreTextareaSelection();
            });
          }}
          onMouseDown={() => {
            backupSelection();
          }}
          onClick={() => {
            if (formBusy || canAddCount === 0) return;
            backupSelection();
            fileInputRef.current?.click();
          }}
          className={`cursor-pointer border-t border-dashed border-border/55 px-3 py-3 text-center transition-colors ${
            dragActive ? "bg-surface-blue/45" : "bg-bg-secondary/25"
          } ${formBusy || canAddCount === 0 ? "pointer-events-none opacity-50" : ""}`}
        >
          <p className="text-meta leading-snug text-text-secondary">
            Drop photos here or click to browse
            {canAddCount === 0 ? (
              <span className="mt-1 block text-warning">Maximum {MAX_POST_IMAGES} reached.</span>
            ) : null}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_IMAGE_ATTR}
          multiple
          disabled={formBusy || canAddCount === 0}
          className="sr-only"
          aria-label="Choose images"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (!files.length) return;
            addValidatedFiles(files);
            e.target.value = "";
            queueMicrotask(() => {
              restoreTextareaSelection();
            });
          }}
        />
        {(existingDraftImages.length > 0 || selectedFiles.length > 0) ? (
          <div className="border-t border-border/40 bg-bg-secondary/20 px-2 py-2">
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {existingDraftImages.map((image) => (
                <li key={image.id}>
                  <DraftImageThumb
                    supabase={supabase}
                    image={image}
                    removeDisabled={formBusy}
                    onRemove={() => void handleRemoveExistingDraftImage(image)}
                  />
                </li>
              ))}
              {selectedFiles.map((f, i) => (
                <li key={`${f.name}-${i}-${f.size}`}>
                  <PreviewThumb
                    file={f}
                    onRemove={() => {
                      setSelectedFiles((prev) => prev.filter((_, j) => j !== i));
                      setFormError(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="post-tags" className="text-meta text-text-secondary">
          Tags <span className="font-normal text-text-muted">· optional, commas</span>
        </label>
        <input
          id="post-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          disabled={formBusy}
          placeholder="e.g. photo, weekend, cats"
          className="qrtz-field py-2 text-sm"
        />
      </div>
      {defaultMarkNsfw ? (
        <div className="text-meta text-text-secondary">
          <p className="font-medium text-text">This post will be marked mature / NSFW</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-text-muted">
            Your posting default is turned on in{" "}
            <Link
              href="/settings"
              className="text-link hover:text-link-hover hover:underline transition-colors"
            >
              Settings
            </Link>
            . Reblogs inherit mature status from the parent chain, and mature status cannot be removed after posting.
          </p>
        </div>
      ) : (
        <label className="flex cursor-pointer items-start gap-2 text-meta text-text-secondary">
          <input
            type="checkbox"
            checked={markNsfw}
            onChange={(e) => setMarkNsfw(e.target.checked)}
            disabled={formBusy}
            className="qrtz-checkbox mt-0.5"
          />
          <span>
            <span className="font-medium text-text">Mark as mature / NSFW</span>
            <span className="mt-0.5 block text-[0.8125rem] leading-snug text-text-muted">
              Use this if your post contains mature content. This can't be removed after posting. Reblogs inherit this
              status.
            </span>
          </span>
        </label>
      )}
      {editingDraft ? (
        <div className="flex flex-col gap-1 text-meta leading-snug text-text-muted">
          <p>Posting publishes this draft and removes it from Drafts.</p>
          <p>Adding to queue copies this draft into Queue and keeps the draft.</p>
        </div>
      ) : null}
      <div className="mt-0.5 flex flex-col gap-2">
        <button type="submit" disabled={formBusy} className="qrtz-btn-primary w-full px-4 py-2.5">
          {submitting ? "Posting…" : "Post"}
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={formBusy}
            onClick={() => void handleSaveDraft()}
            className="qrtz-btn-secondary px-4 py-2"
          >
            {savingDraft ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={formBusy}
            onClick={() => void handleAddToQueue()}
            className="rounded-btn border border-dashed border-border/70 bg-transparent px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-border hover:bg-bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {addingToQueue ? "Adding…" : "Add to queue"}
          </button>
        </div>
      </div>
    </form>
  );
};

export default PostForm;
