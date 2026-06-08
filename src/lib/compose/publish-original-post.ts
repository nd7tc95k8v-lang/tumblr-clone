import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOriginalPostInsertRow } from "./build-original-post-insert";
import { rollbackPublishedPost } from "./rollback-published-post";
import type { PublishImageSource, PublishOriginalResult } from "./types";
import { linkPostImageSources } from "./link-post-image-sources";

export type PublishOriginalPostInput = {
  supabase: SupabaseClient;
  userId: string;
  postId?: string;
  /** Already trimmed by caller. */
  content: string;
  /** Already parsed/normalized by caller. */
  tags: string[];
  isNsfw: boolean;
  /** Existing storage paths first, then new file uploads. */
  imageSources: readonly PublishImageSource[];
};

export async function publishOriginalPost(input: PublishOriginalPostInput): Promise<PublishOriginalResult> {
  const postId = input.postId ?? crypto.randomUUID();

  const { error: insertError } = await input.supabase
    .from("posts")
    .insert(
      buildOriginalPostInsertRow({
        postId,
        userId: input.userId,
        content: input.content,
        tags: input.tags,
        isNsfw: input.isNsfw,
      }),
    );

  if (insertError) {
    console.error(insertError);
    return {
      ok: false,
      stage: "post_insert",
      error: { message: insertError.message, code: insertError.code },
      message: insertError.message?.trim() || "Could not create post.",
      postId,
      uploadedStoragePaths: [],
    };
  }

  if (input.imageSources.length === 0) {
    return { ok: true, postId, uploadedStoragePaths: [] };
  }

  const linkResult = await linkPostImageSources({
    supabase: input.supabase,
    userId: input.userId,
    postId,
    sources: input.imageSources,
  });

  if (!linkResult.ok) {
    await rollbackPublishedPost({
      supabase: input.supabase,
      postId,
      uploadedStoragePaths: linkResult.uploadedStoragePaths,
    });
    return {
      ok: false,
      stage: linkResult.stage,
      error: linkResult.error,
      message: linkResult.message,
      postId,
      uploadedStoragePaths: linkResult.uploadedStoragePaths,
    };
  }

  return { ok: true, postId, uploadedStoragePaths: linkResult.storagePaths };
}
