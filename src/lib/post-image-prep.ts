import { normalizeImageFile } from "@/lib/image-normalize";
import { validateImageFile } from "@/lib/image-upload-validation";

/**
 * Downscale supported raster types when needed, then apply shared upload validation.
 * Order is always: {@link normalizeImageFile} → {@link validateImageFile}.
 *
 * HEIC/HEIF and other unsupported types are rejected in {@link validateImageFile} with
 * specific messaging where applicable (`image-upload-validation`).
 *
 * Call this **once** when the user selects or drops files; keep the returned `File` in
 * component state and pass it to storage on submit/save without calling this again.
 */
export async function preparePostImageForUpload(
  file: File,
): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  const normalized = await normalizeImageFile(file);
  const v = validateImageFile(normalized);
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, file: normalized };
}
