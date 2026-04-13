"use client";

import React, { useEffect, useRef, useState } from "react";
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

const PostForm = ({ supabase, onPosted, defaultMarkNsfw = false }: Props) => {
  const { runProtectedAction } = useActionGuard();
  const [content, setContent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [markNsfw, setMarkNsfw] = useState(() => Boolean(defaultMarkNsfw));
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMarkNsfw(Boolean(defaultMarkNsfw));
  }, [defaultMarkNsfw]);

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

    if (selectedFile) {
      const img = validateImageFile(selectedFile);
      if (!img.ok) {
        setFormError(img.error);
        return;
      }
    }

    setSubmitting(true);
    try {
      await runProtectedAction(supabase, { kind: "post" }, async () => {
        let imageStoragePath: string | null = null;

        if (selectedFile) {
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
            setFormError(uploadError.message?.trim() || "Image upload failed.");
            return;
          }

          imageStoragePath = filePath;
        }

        const tags = parseCommaSeparatedTags(tagsRaw);
        const newPostId = crypto.randomUUID();

        const { error: insertError } = await supabase.from("posts").insert({
          id: newPostId,
          user_id: user.id,
          content: trimmedContent,
          image_url: null,
          image_storage_path: imageStoragePath,
          tags,
          original_post_id: newPostId,
          is_nsfw: markNsfw,
        });

        if (insertError) {
          console.error(insertError);
          await alertIfLikelyRateOrGuardFailure(supabase, insertError, { kind: "post" });
          return;
        }

        recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(trimmedContent));
        setContent("");
        setTagsRaw("");
        setMarkNsfw(Boolean(defaultMarkNsfw));
        setSelectedFile(null);
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="post-image" className="text-meta font-medium text-text-secondary">
          Image (optional)
        </label>
        <input
          ref={fileInputRef}
          id="post-image"
          type="file"
          accept={ACCEPT_IMAGE_ATTR}
          disabled={submitting}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (!f) {
              setSelectedFile(null);
              return;
            }
            const img = validateImageFile(f);
            if (!img.ok) {
              setFormError(img.error);
              e.target.value = "";
              setSelectedFile(null);
              return;
            }
            setFormError(null);
            setSelectedFile(f);
          }}
          className="text-meta text-text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-bg-secondary file:px-3 file:py-2 file:font-medium file:text-text hover:file:bg-border-soft"
        />
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
