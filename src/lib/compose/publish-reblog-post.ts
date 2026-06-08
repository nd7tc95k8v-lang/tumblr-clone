import type { SupabaseClient } from "@supabase/supabase-js";
import { reblogInsertFields } from "@/lib/reblog";
import type { FeedPost } from "@/types/post";
import { attachReblogEditorImages } from "./attach-reblog-editor-images";
import { MAX_POST_IMAGES } from "./constants";
import { rollbackPublishedPost } from "./rollback-published-post";
import type { PublishImageFile, PublishReblogResult } from "./types";

export type PublishReblogPostInput = {
  supabase: SupabaseClient;
  userId: string;
  source: FeedPost;
  postId?: string;
  /** null = quick reblog; string = editor reblog (including ""). */
  commentary: string | null | undefined;
  tags?: string[];
  /** Ignored when commentary === null (quick). */
  editorMarksMature?: boolean;
  imageFiles?: readonly PublishImageFile[];
};

export async function publishReblogPost(input: PublishReblogPostInput): Promise<PublishReblogResult> {
  const postId = input.postId ?? crypto.randomUUID();
  const isQuickReblog = input.commentary === null;
  const attachFiles = isQuickReblog ? [] : (input.imageFiles ?? []).slice(0, MAX_POST_IMAGES);

  const { error } = await input.supabase.from("posts").insert({
    id: postId,
    user_id: input.userId,
    ...reblogInsertFields(input.source, {
      commentary: input.commentary,
      tags: input.tags,
      editorMarksMature: isQuickReblog ? undefined : input.editorMarksMature,
    }),
  });

  if (error) {
    console.error(error);
    return {
      ok: false,
      stage: "post_insert",
      error: { message: error.message, code: error.code },
      message: error.message?.trim() || "Could not create reblog.",
      postId,
      uploadedStoragePaths: [],
    };
  }

  if (attachFiles.length === 0) {
    return { ok: true, postId };
  }

  const attachResult = await attachReblogEditorImages({
    supabase: input.supabase,
    userId: input.userId,
    postId,
    files: attachFiles,
  });

  if (!attachResult.ok) {
    const uploadedStoragePaths =
      "uploadedStoragePaths" in attachResult ? attachResult.uploadedStoragePaths : [];
    await rollbackPublishedPost({
      supabase: input.supabase,
      postId,
      uploadedStoragePaths,
      logPrefix: "Reblog images rollback",
    });
    return {
      ok: false,
      stage: attachResult.stage,
      error: attachResult.error,
      message: attachResult.message,
      postId,
      uploadedStoragePaths,
    };
  }

  return { ok: true, postId, attachedImageStoragePaths: attachResult.storagePaths };
}
