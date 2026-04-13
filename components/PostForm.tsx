"use client";

import React, { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCommaSeparatedTags } from "@/lib/tags";

type Props = {
  supabase: SupabaseClient;
  onPosted: () => void | Promise<void>;
};

const PostForm = ({ supabase, onPosted }: Props) => {
  const [content, setContent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      alert("You must be logged in to post.");
      return;
    }

    setSubmitting(true);
    try {
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
          alert("Image upload failed.");
          return;
        }

        const { data: publicUrlData } = supabase.storage
          .from("post-images")
          .getPublicUrl(filePath);

        imageUrl = publicUrlData.publicUrl;
      }

      const tags = parseCommaSeparatedTags(tagsRaw);

      const { error: insertError } = await supabase.from("posts").insert({
        user_id: user.id,
        content,
        image_url: imageUrl,
        tags,
      });

      if (insertError) {
        console.error(insertError);
        alert("Post failed.");
        return;
      }

      setContent("");
      setTagsRaw("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onPosted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 w-full max-w-md mx-auto p-6 bg-zinc-100 dark:bg-zinc-900 rounded-lg shadow-md"
    >
      <label htmlFor="post-content" className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
        Write a post
      </label>
      <textarea
        id="post-content"
        className="w-full min-h-[100px] p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What's on your mind?"
        required
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="post-tags" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Tags <span className="font-normal text-zinc-500">(optional, comma-separated)</span>
        </label>
        <input
          id="post-tags"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          disabled={submitting}
          placeholder="e.g. photo, weekend, cats"
          className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="post-image"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Image (optional)
        </label>
        <input
          ref={fileInputRef}
          id="post-image"
          type="file"
          accept="image/*"
          disabled={submitting}
          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          className="text-sm text-zinc-700 dark:text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-300 dark:file:bg-zinc-700 dark:file:text-zinc-100 dark:hover:file:bg-zinc-600"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="py-2 px-4 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50"
      >
        {submitting ? "Posting…" : "Post"}
      </button>
    </form>
  );
};

export default PostForm;
