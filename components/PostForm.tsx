"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { ALLOWED_IMAGE_MIME_TYPES, validateImageFile } from "@/lib/image-upload-validation";
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
    <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-bg-secondary">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-bg-secondary" aria-hidden />
      )}
      <button
        type="button"
        onClick={onRemove}
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [markNsfw, setMarkNsfw] = useState(() => Boolean(defaultMarkNsfw));
  const [formError, setFormError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMarkNsfw(Boolean(defaultMarkNsfw));
  }, [defaultMarkNsfw]);

  const canAddCount = useMemo(() => Math.max(0, MAX_POST_IMAGES - selectedFiles.length), [selectedFiles.length]);

  const addValidatedFiles = useCallback((incoming: Iterable<File>) => {
    setSelectedFiles((prev) => {
      const next = [...prev];
      let firstError: string | null = null;
      for (const f of Array.from(incoming)) {
        if (next.length >= MAX_POST_IMAGES) break;
        const img = validateImageFile(f);
        if (!img.ok) {
          if (!firstError) firstError = img.error;
          continue;
        }
        next.push(f);
      }
      queueMicrotask(() => {
        if (firstError) setFormError(firstError);
        else setFormError(null);
      });
      return next;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setFormError("You must be logged in to post.");
      return;
    }

    const trimmedContent = content.trim();
    const written = validateUserWrittenContent(trimmedContent, { allowEmpty: false });
    if (!written.ok) {
      setFormError(written.message);
      return;
    }

    for (const f of selectedFiles) {
      const img = validateImageFile(f);
      if (!img.ok) {
        setFormError(img.error);
        return;
      }
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
              throw new Error(uploadError.message?.trim() || "Image upload failed.");
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
              throw new Error(piError.message?.trim() || "Could not save image attachments.");
            }

            const { error: updError } = await supabase
              .from("posts")
              .update({ image_storage_path: uploadedPaths[0] })
              .eq("id", newPostId);
            if (updError) {
              console.error(updError);
              throw new Error(updError.message?.trim() || "Could not link primary image.");
            }
          }
        } catch (err) {
          for (const p of uploadedPaths) {
            await supabase.storage.from("post-images").remove([p]);
          }
          await supabase.from("posts").delete().eq("id", newPostId);
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
      className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-5"
    >
      <label htmlFor="post-content" className="font-heading text-lg font-semibold text-text">
        Write a post
      </label>
      <InlineErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      <textarea
        id="post-content"
        className="qrtz-field min-h-[100px]"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          if (formError) setFormError(null);
        }}
        placeholder="What's on your mind?"
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="post-tags" className="text-meta font-medium text-text-secondary">
          Tags <span className="font-normal text-text-muted">(optional, comma-separated)</span>
        </label>
        <input
          id="post-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          disabled={submitting}
          placeholder="e.g. photo, weekend, cats"
          className="qrtz-field"
        />
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={markNsfw}
          onChange={(e) => setMarkNsfw(e.target.checked)}
          disabled={submitting}
          className="qrtz-checkbox"
        />
        <span>
          <span className="font-medium text-text">Mark as mature / NSFW</span>
          <span className="mt-1 block text-meta text-text-muted">
            Matches your profile default when you open the composer; the database still decides the final flag.
            Cannot be removed after posting. Reblogs inherit mature status from the parent chain—you can’t strip it.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-meta font-medium text-text-secondary">
          Images <span className="font-normal text-text-muted">(optional, up to {MAX_POST_IMAGES})</span>
        </span>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!submitting && canAddCount > 0) fileInputRef.current?.click();
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
            addValidatedFiles(e.dataTransfer.files);
          }}
          onClick={() => !submitting && canAddCount > 0 && fileInputRef.current?.click()}
          className={`cursor-pointer rounded-card border-2 border-dashed px-3 py-6 text-center transition-colors ${
            dragActive ? "border-accent-aqua/60 bg-surface-blue/40" : "border-border bg-bg-secondary/50"
          } ${submitting || canAddCount === 0 ? "pointer-events-none opacity-50" : ""}`}
        >
          <p className="text-sm text-text-secondary">
            Drag and drop images here, or click to choose
            {canAddCount === 0 ? <span className="mt-1 block text-meta text-warning">Maximum reached.</span> : null}
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
            const list = e.target.files;
            if (!list?.length) return;
            addValidatedFiles(list);
            e.target.value = "";
          }}
        />
        {selectedFiles.length > 0 ? (
          <ul className="flex flex-wrap gap-2 p-0 list-none">
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
        ) : null}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="qrtz-btn-primary px-4 py-2"
      >
        {submitting ? "Posting…" : "Post"}
      </button>
    </form>
  );
};

export default PostForm;
