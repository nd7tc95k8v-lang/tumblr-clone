import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal Supabase/PostgREST error surface for callers. */
export type PublishSupabaseError = {
  message?: string;
  code?: string;
};

export type PublishFailureStage =
  | "post_insert"
  | "reblog_image_clear"
  | "image_upload"
  | "post_images_insert"
  | "post_image_path_update";

export type PublishContext = {
  supabase: SupabaseClient;
  userId: string;
  postId: string;
};

export type PublishImageFile = File;

export type PublishImageSource =
  | { kind: "file"; file: File }
  | { kind: "storage_path"; storagePath: string };

export type ImageUploadFailure = {
  ok: false;
  stage: "image_upload";
  message: string;
  error: PublishSupabaseError;
  uploadedStoragePaths: string[];
};

export type ImageLinkFailure = {
  ok: false;
  stage: "post_images_insert" | "post_image_path_update";
  message: string;
  error: PublishSupabaseError;
  uploadedStoragePaths: string[];
};

export type UploadPostImageFilesResult =
  | { ok: true; storagePaths: string[] }
  | ImageUploadFailure;

export type UploadAndLinkPostImagesResult =
  | { ok: true; storagePaths: string[] }
  | ImageUploadFailure
  | ImageLinkFailure;

export type ClearReblogCopiedImagesResult =
  | { ok: true }
  | {
      ok: false;
      stage: "reblog_image_clear";
      message: string;
      error: PublishSupabaseError;
    };

export type AttachReblogEditorImagesResult = UploadAndLinkPostImagesResult | Exclude<ClearReblogCopiedImagesResult, { ok: true }>;

export type PublishPostInsertFailure = {
  ok: false;
  stage: "post_insert";
  error: PublishSupabaseError;
  message: string;
  postId: string;
  uploadedStoragePaths: readonly string[];
};

export type PublishOriginalFailure =
  | PublishPostInsertFailure
  | (ImageUploadFailure & { postId: string })
  | (ImageLinkFailure & { postId: string });

export type PublishOriginalSuccess = {
  ok: true;
  postId: string;
  uploadedStoragePaths: readonly string[];
};

export type PublishOriginalResult = PublishOriginalSuccess | PublishOriginalFailure;

export type PublishReblogFailure =
  | PublishPostInsertFailure
  | (ImageUploadFailure & { postId: string; uploadedStoragePaths: readonly string[] })
  | (ImageLinkFailure & { postId: string; uploadedStoragePaths: readonly string[] })
  | (Exclude<ClearReblogCopiedImagesResult, { ok: true }> & {
      postId: string;
      uploadedStoragePaths: readonly string[];
    });

export type PublishReblogSuccess = {
  ok: true;
  postId: string;
  attachedImageStoragePaths?: readonly string[];
};

export type PublishReblogResult = PublishReblogSuccess | PublishReblogFailure;
