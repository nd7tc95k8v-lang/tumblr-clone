import type { SupabaseClient } from "@supabase/supabase-js";
import { POST_IMAGES_BUCKET } from "./constants";
import type { PublishImageSource, UploadAndLinkPostImagesResult } from "./types";
import { buildPostImageStoragePath } from "./storage-path";
import { uploadPostImageFiles } from "./upload-post-image-files";
import {
  isCanonicalPostImageStoragePath,
  validatePublishImageStoragePaths,
} from "./validate-publish-image-storage-path";

async function copyStoragePathToCanonicalPostPath(
  supabase: SupabaseClient,
  sourcePath: string,
  destPath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.storage.from(POST_IMAGES_BUCKET).copy(sourcePath, destPath);
  if (error) {
    console.error(error);
    const m = error.message?.trim() || "Could not copy saved image into post storage.";
    return { ok: false, message: m };
  }
  return { ok: true };
}

export async function linkPostImageSources(input: {
  supabase: SupabaseClient;
  userId: string;
  postId: string;
  sources: readonly PublishImageSource[];
}): Promise<UploadAndLinkPostImagesResult> {
  if (input.sources.length === 0) {
    return { ok: true, storagePaths: [] };
  }

  const reusePaths = input.sources
    .filter((source): source is Extract<PublishImageSource, { kind: "storage_path" }> => source.kind === "storage_path")
    .map((source) => source.storagePath.trim());

  const pathValidation = validatePublishImageStoragePaths(input.userId, reusePaths);
  if (!pathValidation.ok) {
    return {
      ok: false,
      stage: "image_upload",
      message: pathValidation.message,
      error: { message: pathValidation.message },
      uploadedStoragePaths: [],
    };
  }

  const finalPaths: string[] = [];
  const uploadedStoragePaths: string[] = [];

  for (const source of input.sources) {
    if (source.kind === "storage_path") {
      const sourcePath = source.storagePath.trim();
      let canonicalPath = sourcePath;

      if (!isCanonicalPostImageStoragePath(input.userId, sourcePath)) {
        canonicalPath = buildPostImageStoragePath(
          input.userId,
          sourcePath.split("/").pop() ?? "image.jpg",
        );
        const copyResult = await copyStoragePathToCanonicalPostPath(
          input.supabase,
          sourcePath,
          canonicalPath,
        );
        if (!copyResult.ok) {
          return {
            ok: false,
            stage: "image_upload",
            message: copyResult.message,
            error: { message: copyResult.message },
            uploadedStoragePaths,
          };
        }
        uploadedStoragePaths.push(canonicalPath);
      }

      finalPaths.push(canonicalPath);
      continue;
    }

    const uploadResult = await uploadPostImageFiles({
      supabase: input.supabase,
      userId: input.userId,
      files: [source.file],
    });

    if (!uploadResult.ok) {
      return {
        ok: false,
        stage: uploadResult.stage,
        message: uploadResult.message,
        error: uploadResult.error,
        uploadedStoragePaths: [...uploadedStoragePaths, ...uploadResult.uploadedStoragePaths],
      };
    }

    const path = uploadResult.storagePaths[0];
    finalPaths.push(path);
    uploadedStoragePaths.push(path);
  }

  const { error: piError } = await input.supabase.from("post_images").insert(
    finalPaths.map((storage_path, position) => ({
      post_id: input.postId,
      storage_path,
      position,
    })),
  );
  if (piError) {
    console.error(piError);
    const m = piError.message?.trim() || piError.code || "Could not save image attachments.";
    return {
      ok: false,
      stage: "post_images_insert",
      message: `Saving image records failed: ${m}`,
      error: { message: piError.message, code: piError.code },
      uploadedStoragePaths,
    };
  }

  const { error: updError } = await input.supabase
    .from("posts")
    .update({ image_storage_path: finalPaths[0] })
    .eq("id", input.postId);
  if (updError) {
    console.error(updError);
    const m = updError.message?.trim() || updError.code || "Could not link primary image.";
    return {
      ok: false,
      stage: "post_image_path_update",
      message: `Linking primary image failed: ${m}`,
      error: { message: updError.message, code: updError.code },
      uploadedStoragePaths,
    };
  }

  return { ok: true, storagePaths: finalPaths };
}
