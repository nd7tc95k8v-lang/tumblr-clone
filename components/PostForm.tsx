"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/image-upload-validation";
import { preparePostImageForUpload } from "@/lib/post-image-prep";
import {
  normalizePostBodyForDedup,
  recordSuccessfulUserWrittenPost,
  validateUserWrittenContent,
} from "@/lib/post-content-guard";
import { parseCommaSeparatedTags } from "@/lib/tags";
import { InlineErrorBanner } from "./InlineErrorBanner";
import { useActionGuard } from "./ActionGuardProvider";

type Props = {
  supabase: SupabaseClient;
  onPosted: () => void | Promise<void>;
  /** From `profiles.default_posts_nsfw`; DB trigger still final authority on insert. */
  defaultMarkNsfw?: boolean;
};

const ACCEPT_IMAGE_ATTR = ALLOWED_IMAGE_MIME_TYPES.join(",");
const MAX_POST_IMAGES = 10;

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

const PostForm = ({ supabase, onPosted, defaultMarkNsfw = false }: Props) => {
  const { runProtectedAction } = useActionGuard();
  const [content, setContent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Prepared attachments: each `File` is the result of {@link preparePostImageForUpload} (normalize → validate). */
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [markNsfw, setMarkNsfw] = useState(() => Boolean(defaultMarkNsfw));
  const [formError, setFormError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionBackupRef = useRef<{ start: number; end: number } | null>(null);
  const skipFocusScrollRef = useRef(false);

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
      if (submitting) return;
      e.currentTarget.form?.requestSubmit();
    },
    [submitting],
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
    setMarkNsfw(Boolean(defaultMarkNsfw));
  }, [defaultMarkNsfw]);

  const canAddCount = useMemo(() => Math.max(0, MAX_POST_IMAGES - selectedFiles.length), [selectedFiles.length]);

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
      if (firstError) setFormError(firstError);
      else setFormError(null);
    });
  }, [selectedFiles.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

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
    const written = validateUserWrittenContent(trimmedContent, { allowEmpty: false });
    if (!written.ok) {
      setFormError(written.message);
      return;
    }

    setSubmitting(true);
    try {
      await runProtectedAction(supabase, { kind: "post" }, async () => {
        const newPostId = crypto.randomUUID();
        const tags = parseCommaSeparatedTags(tagsRaw);

        const { error: insertError } = await supabase.from("posts").insert({
          id: newPostId,
          user_id: user.id,
          content: trimmedContent,
          image_url: null,
          image_storage_path: null,
          tags,
          original_post_id: newPostId,
          is_nsfw: markNsfw,
        });

        if (insertError) {
          console.error(insertError);
          const msg =
            insertError.message?.trim() ||
            insertError.code ||
            "Could not create your post.";
          setFormError(`Post draft failed: ${msg}`);
          await alertIfLikelyRateOrGuardFailure(supabase, insertError, { kind: "post" });
          return;
        }

        const uploadedPaths: string[] = [];
        try {
          for (const selectedFile of selectedFiles) {
            const rawExt = selectedFile.name.split(".").pop();
            const fileExt =
              rawExt && /^[a-z0-9]+$/i.test(rawExt) && rawExt.length <= 8
                ? rawExt.toLowerCase()
                : "jpg";
            const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
              .from("post-images")
              .upload(filePath, selectedFile, {
                contentType: selectedFile.type || `image/${fileExt}`,
                upsert: false,
              });

            if (uploadError) {
              console.error(uploadError);
              const m = uploadError.message?.trim() || "Image upload failed.";
              throw new Error(`Image upload failed: ${m}`);
            }
            uploadedPaths.push(filePath);
          }

          if (uploadedPaths.length > 0) {
            const { error: piError } = await supabase.from("post_images").insert(
              uploadedPaths.map((storage_path, position) => ({
                post_id: newPostId,
                storage_path,
                position,
              })),
            );
            if (piError) {
              console.error(piError);
              const m =
                piError.message?.trim() || piError.code || "Could not save image attachments.";
              throw new Error(`Saving image records failed: ${m}`);
            }

            const { error: updError } = await supabase
              .from("posts")
              .update({ image_storage_path: uploadedPaths[0] })
              .eq("id", newPostId);
            if (updError) {
              console.error(updError);
              const m =
                updError.message?.trim() || updError.code || "Could not link primary image.";
              throw new Error(`Linking primary image failed: ${m}`);
            }
          }
        } catch (err) {
          for (const p of uploadedPaths) {
            const { error: rmErr } = await supabase.storage.from("post-images").remove([p]);
            if (rmErr) console.error("Rollback: storage remove failed", rmErr);
          }
          const { error: delErr } = await supabase.from("posts").delete().eq("id", newPostId);
          if (delErr) console.error("Rollback: post delete failed", delErr);
          setFormError(err instanceof Error ? err.message : "Something went wrong.");
          return;
        }

        recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(trimmedContent));
        setContent("");
        setTagsRaw("");
        setMarkNsfw(Boolean(defaultMarkNsfw));
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        await onPosted();
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
      <label htmlFor="post-content" className="text-meta font-medium text-text-secondary">
        Write a post
      </label>
      <InlineErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      <div className="overflow-hidden rounded-xl border border-border-soft bg-input shadow-sm">
        <textarea
          ref={textareaRef}
          id="post-content"
          className="qrtz-field min-h-[128px] w-full resize-y rounded-none border-0 border-b border-border/45 bg-transparent px-3.5 py-3 text-base leading-relaxed text-text placeholder:text-text-muted shadow-none focus:ring-2 focus:ring-inset focus:ring-border-focus/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/55 scroll-mt-[calc(2.75rem+env(safe-area-inset-top,0px))] scroll-mb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            if (formError) setFormError(null);
          }}
          onSelect={backupSelection}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          onKeyDown={handleTextareaKeyDown}
          placeholder="What's on your mind?"
          required
        />
        <div
          role="button"
          tabIndex={0}
          aria-label={`Add images to this post, optional, up to ${MAX_POST_IMAGES} files`}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!submitting && canAddCount > 0) {
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
            if (submitting || canAddCount === 0) return;
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
            if (submitting || canAddCount === 0) return;
            backupSelection();
            fileInputRef.current?.click();
          }}
          className={`cursor-pointer border-t border-dashed border-border/55 px-3 py-3 text-center transition-colors ${
            dragActive ? "bg-surface-blue/45" : "bg-bg-secondary/25"
          } ${submitting || canAddCount === 0 ? "pointer-events-none opacity-50" : ""}`}
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
          disabled={submitting || canAddCount === 0}
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
        {selectedFiles.length > 0 ? (
          <div className="border-t border-border/40 bg-bg-secondary/20 px-2 py-2">
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
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
          disabled={submitting}
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
            disabled={submitting}
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
      <button
        type="submit"
        disabled={submitting}
        className="qrtz-btn-primary mt-0.5 px-4 py-2"
      >
        {submitting ? "Posting…" : "Post"}
      </button>
    </form>
  );
};

export default PostForm;
