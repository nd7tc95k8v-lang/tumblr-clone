export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** Shared cap for post images and profile avatars (client-side guard). */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

const MIME_HINT =
  "Please choose a JPEG, PNG, WebP, or GIF image (maximum size 5 MB).";

export function validateImageFile(file: File): { ok: true } | { ok: false; error: string } {
  if (!file.type) {
    return { ok: false, error: `We could not read this file's type. ${MIME_HINT}` };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as AllowedImageMime)) {
    return { ok: false, error: MIME_HINT };
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be 5 MB or smaller." };
  }
  return { ok: true };
}
