export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** Target size for typical smartphone photos; larger files are allowed up to {@link MAX_IMAGE_UPLOAD_BYTES_HARD}. */
export const MAX_IMAGE_UPLOAD_BYTES_SOFT = 12 * 1024 * 1024;

/** Absolute maximum file size (client-side guard). Files over this are rejected. */
export const MAX_IMAGE_UPLOAD_BYTES_HARD = 20 * 1024 * 1024;

/** @deprecated Use {@link MAX_IMAGE_UPLOAD_BYTES_HARD} — kept for any legacy imports. */
export const MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_BYTES_HARD;

function formatSizeMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
}

const MIME_HINT =
  "Please choose a JPEG, PNG, WebP, or GIF image (about 12 MB per photo is typical; the maximum is 20 MB).";

/** Shown when MIME or filename indicates Apple HEIC/HEIF (not supported in-app yet). */
export const HEIC_HEIF_UNSUPPORTED_MESSAGE =
  "This iPhone photo format (HEIC/HEIF) isn’t supported yet. Export it as JPEG, PNG, or WebP, then try again.";

const HEIC_HEIF_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

/** True if the file looks like HEIC/HEIF via MIME and/or filename (fallback when type is missing or wrong). */
export function isHeicOrHeifFile(file: File): boolean {
  const t = file.type.trim().toLowerCase();
  if (t && HEIC_HEIF_MIME_TYPES.has(t)) return true;
  const n = file.name.toLowerCase();
  return n.endsWith(".heic") || n.endsWith(".heif");
}

export function validateImageFile(file: File): { ok: true } | { ok: false; error: string } {
  if (isHeicOrHeifFile(file)) {
    return { ok: false, error: HEIC_HEIF_UNSUPPORTED_MESSAGE };
  }
  if (!file.type) {
    return { ok: false, error: `We could not read this file's type. ${MIME_HINT}` };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as AllowedImageMime)) {
    return { ok: false, error: MIME_HINT };
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES_HARD) {
    return {
      ok: false,
      error: `This photo is too large (${formatSizeMb(file.size)} MB). The maximum is 20 MB. Try a smaller image, or use your phone’s editor to reduce size before uploading.`,
    };
  }
  return { ok: true };
}
