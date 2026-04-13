"use client";

import React, { useRef, useState } from "react";
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
};

const ACCEPT_IMAGE_ATTR = ALLOWED_IMAGE_MIME_TYPES.join(",");

const PostForm = ({ supabase, onPosted }: Props) => {
  const { runProtectedAction } = useActionGuard();
  const [content, setContent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        let imageUrl: string | null = null;

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

          const { data: publicUrlData } = supabase.storage
            .from("post-images")
            .getPublicUrl(filePath);

          imageUrl = publicUrlData.publicUrl;
        }

        const tags = parseCommaSeparatedTags(tagsRaw);
        const newPostId = crypto.randomUUID();

        const { error: insertError } = await supabase.from("posts").insert({
          id: newPostId,
          user_id: user.id,
          content: trimmedContent,
          image_url: imageUrl,
          tags,
          original_post_id: newPostId,
        });

        if (insertError) {
          console.error(insertError);
          await alertIfLikelyRateOrGuardFailure(supabase, insertError, { kind: "post" });
          return;
        }

        recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(trimmedContent));
        setContent("");
        setTagsRaw("");
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
      className="flex flex-col gap-4 w-full max-w-md mx-auto p-6 bg-bg-secondary rounded-lg shadow-md border border-border"
    >
      <label htmlFor="post-content" className="text-lg font-semibold text-text">
        Write a post
      </label>
      <InlineErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      <textarea
        id="post-content"
        className="w-full min-h-[100px] p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          if (formError) setFormError(null);
        }}
        placeholder="What's on your mind?"
        required
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="post-tags" className="text-sm font-medium text-text-secondary">
          Tags <span className="font-normal text-text-muted">(optional, comma-separated)</span>
        </label>
        <input
          id="post-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          disabled={submitting}
          placeholder="e.g. photo, weekend, cats"
          className="w-full p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="post-image"
          className="text-sm font-medium text-text-secondary"
        >
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
          className="text-sm text-text-secondary file:mr-3 file:rounded file:border-0 file:bg-bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text hover:file:bg-border-soft"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="py-2 px-4 bg-primary text-white font-semibold rounded hover:bg-primary-hover active:bg-primary-pressed transition-colors disabled:opacity-50"
      >
        {submitting ? "Posting…" : "Post"}
      </button>
    </form>
  );
};

export default PostForm;
