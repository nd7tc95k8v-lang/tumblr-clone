import type { SupabaseClient } from "@supabase/supabase-js";
import { POST_IMAGES_BUCKET } from "./constants";
import { buildPostImageStoragePath, fileExtensionFromFileName } from "./storage-path";
import type { PublishImageFile, PublishSupabaseError, UploadPostImageFilesResult } from "./types";

export async function uploadPostImageFiles(input: {
  supabase: SupabaseClient;
  userId: string;
  files: readonly PublishImageFile[];
}): Promise<UploadPostImageFilesResult> {
  const uploadedStoragePaths: string[] = [];

  for (const selectedFile of input.files) {
    const fileExt = fileExtensionFromFileName(selectedFile.name);
    const filePath = buildPostImageStoragePath(input.userId, selectedFile.name);

    const { error: uploadError } = await input.supabase.storage.from(POST_IMAGES_BUCKET).upload(filePath, selectedFile, {
      contentType: selectedFile.type || `image/${fileExt}`,
      upsert: false,
    });

    if (uploadError) {
      console.error(uploadError);
      const m = uploadError.message?.trim() || "Image upload failed.";
      const error: PublishSupabaseError = {
        message: uploadError.message,
        code: uploadError.name,
      };
      return {
        ok: false,
        stage: "image_upload",
        message: `Image upload failed: ${m}`,
        error,
        uploadedStoragePaths,
      };
    }
    uploadedStoragePaths.push(filePath);
  }

  return { ok: true, storagePaths: uploadedStoragePaths };
}
