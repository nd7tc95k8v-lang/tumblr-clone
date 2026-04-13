import type { PostImageRow } from "@/types/post";

/**
 * Normalized image entries for display and lightbox.
 * `src` is a legacy/public URL when present; otherwise use `storagePath` with a signed URL client-side.
 */
export type NormalizedPostImage = {
  alt: string;
  src: string | null;
  storagePath: string | null;
};

export type PostImageRowLike = {
  storage_path?: string | null;
  position?: number | null;
};

export type PostWithImages = {
  image_url?: string | null;
  image_storage_path?: string | null;
  post_images?: PostImageRowLike[] | PostImageRowLike | null;
};

function sortedPostImages(rows: PostImageRowLike[] | null | undefined): PostImageRowLike[] {
  if (!rows?.length) return [];
  return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function unwrapPostImages(raw: PostWithImages["post_images"]): PostImageRowLike[] {
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Build ordered gallery descriptors: `post_images` rows first, else legacy single `image_url` / `image_storage_path`.
 */
export function normalizePostImages(post: PostWithImages, alt = "Post image"): NormalizedPostImage[] {
  const rows = sortedPostImages(unwrapPostImages(post.post_images));
  const fromRows: NormalizedPostImage[] = [];
  for (const r of rows) {
    const p = r.storage_path?.trim();
    if (!p) continue;
    fromRows.push({ alt, src: null, storagePath: p });
  }
  if (fromRows.length > 0) return fromRows;

  const legacyUrl = post.image_url?.trim() || null;
  const path = post.image_storage_path?.trim() || null;
  if (!legacyUrl && !path) return [];
  return [{ alt, src: legacyUrl, storagePath: path }];
}

/** Stable fingerprint for comparing “same media set” (quote layer vs inherited). */
export function postImagesFingerprint(post: PostWithImages): string {
  return normalizePostImages(post)
    .map((i) => i.storagePath || i.src || "")
    .join("\u001f");
}

/** Coerce Supabase/PostgREST `post_images` embed into sorted rows. */
export function coercePostImageRows(raw: unknown): PostImageRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PostImageRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id ?? "");
    const postId = String(o.post_id ?? "");
    const storage_path = String(o.storage_path ?? "").trim();
    const position = Number(o.position ?? 0);
    if (!id || !postId || !storage_path) continue;
    out.push({
      id,
      post_id: postId,
      storage_path,
      position,
      created_at: o.created_at != null ? String(o.created_at) : undefined,
    });
  }
  out.sort((a, b) => a.position - b.position);
  return out.length > 0 ? out : null;
}
