import type { SupabaseClient } from "@supabase/supabase-js";
import { POST_IMAGES_BUCKET } from "@/lib/compose/constants";
import { fileExtensionFromFileName } from "@/lib/compose/storage-path";
import type { PostDraftImageRow } from "@/types/draft";

/** Coerce PostgREST embed into sorted draft image rows. */
export function coercePostDraftImageRows(raw: unknown, parentDraftId?: string): PostDraftImageRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const fallbackDraftId = parentDraftId?.trim() ?? "";
  const out: PostDraftImageRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const draft_id = String(o.draft_id ?? fallbackDraftId).trim();
    const user_id = String(o.user_id ?? "").trim();
    const storage_path = String(o.storage_path ?? "").trim();
    const position = Number(o.position ?? 0);
    const id = String(o.id ?? "").trim();
    const created_at = String(o.created_at ?? "");
    if (!id || !draft_id || !user_id || !storage_path) continue;
    out.push({ id, draft_id, user_id, storage_path, position, created_at });
  }
  out.sort((a, b) => a.position - b.position);
  return out.length > 0 ? out : null;
}

const DRAFT_IMAGE_ROW_SELECT = "id, draft_id, user_id, storage_path, position, created_at";

/** Offset used during reorder to avoid unique (draft_id, position) conflicts. */
const REORDER_POSITION_OFFSET = 1_000_000;

export type UploadDraftImageFilesInput = {
  userId: string;
  draftId: string;
  files: readonly File[];
};

/** `{userId}/drafts/{draftId}/{uuid}.{ext}` — satisfies post_draft_images storage_path_prefix. */
export function buildDraftImageStoragePath(userId: string, draftId: string, fileName: string): string {
  const fileExt = fileExtensionFromFileName(fileName);
  return `${userId}/drafts/${draftId}/${crypto.randomUUID()}.${fileExt}`;
}

function hydrateDraftImageRow(row: Record<string, unknown>): PostDraftImageRow | null {
  const id = String(row.id ?? "").trim();
  const draft_id = String(row.draft_id ?? "").trim();
  const user_id = String(row.user_id ?? "").trim();
  const storage_path = String(row.storage_path ?? "").trim();
  const position = Number(row.position ?? 0);
  const created_at = String(row.created_at ?? "");
  if (!id || !draft_id || !user_id || !storage_path) return null;
  return { id, draft_id, user_id, storage_path, position, created_at };
}

function sortDraftImageRows(rows: PostDraftImageRow[]): PostDraftImageRow[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

async function removeDraftStoragePaths(
  supabase: SupabaseClient,
  paths: readonly string[],
  logPrefix: string,
): Promise<void> {
  for (const p of paths) {
    const path = p.trim();
    if (!path) continue;
    const { error: rmErr } = await supabase.storage.from(POST_IMAGES_BUCKET).remove([path]);
    if (rmErr) console.error(`${logPrefix}: storage remove failed`, rmErr);
  }
}

async function fetchNextDraftImagePosition(
  supabase: SupabaseClient,
  draftId: string,
): Promise<{ nextPosition: number; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("post_draft_images")
    .select("position")
    .eq("draft_id", draftId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    return { nextPosition: 0, error };
  }

  const maxPosition = data?.[0]?.position;
  if (typeof maxPosition !== "number" || Number.isNaN(maxPosition)) {
    return { nextPosition: 0, error: null };
  }
  return { nextPosition: maxPosition + 1, error: null };
}

/**
 * Upload prepared files to `post-images`, insert `post_draft_images` rows with sequential positions.
 * Rolls back uploaded storage objects if DB insert fails.
 */
export async function uploadDraftImageFiles(
  supabase: SupabaseClient,
  input: UploadDraftImageFilesInput,
): Promise<{ data: PostDraftImageRow[] | null; error: { message: string; code?: string } | null }> {
  const userId = input.userId?.trim() ?? "";
  const draftId = input.draftId?.trim() ?? "";
  if (!userId) {
    return { data: null, error: { message: "Missing user id" } };
  }
  if (!draftId) {
    return { data: null, error: { message: "Missing draft id" } };
  }
  if (input.files.length === 0) {
    return { data: [], error: null };
  }

  const { nextPosition, error: positionError } = await fetchNextDraftImagePosition(supabase, draftId);
  if (positionError) {
    return { data: null, error: positionError };
  }

  const uploadedPaths: string[] = [];
  const insertRows: Array<{
    draft_id: string;
    user_id: string;
    storage_path: string;
    position: number;
  }> = [];

  try {
    let position = nextPosition;
    for (const file of input.files) {
      const fileExt = fileExtensionFromFileName(file.name);
      const storage_path = buildDraftImageStoragePath(userId, draftId, file.name);

      const { error: uploadError } = await supabase.storage.from(POST_IMAGES_BUCKET).upload(storage_path, file, {
        contentType: file.type || `image/${fileExt}`,
        upsert: false,
      });

      if (uploadError) {
        console.error(uploadError);
        const m = uploadError.message?.trim() || "Image upload failed.";
        throw new Error(`Image upload failed: ${m}`);
      }

      uploadedPaths.push(storage_path);
      insertRows.push({ draft_id: draftId, user_id: userId, storage_path, position });
      position += 1;
    }

    const { data, error: insertError } = await supabase
      .from("post_draft_images")
      .insert(insertRows)
      .select(DRAFT_IMAGE_ROW_SELECT);

    if (insertError) {
      console.error(insertError);
      await removeDraftStoragePaths(supabase, uploadedPaths, "Draft image upload rollback");
      const m = insertError.message?.trim() || insertError.code || "Could not save draft image records.";
      return { data: null, error: { message: `Saving draft image records failed: ${m}`, code: insertError.code } };
    }

    const rows = (data ?? [])
      .map((r) => hydrateDraftImageRow(r as Record<string, unknown>))
      .filter((r): r is PostDraftImageRow => r !== null);

    return { data: sortDraftImageRows(rows), error: null };
  } catch (err) {
    await removeDraftStoragePaths(supabase, uploadedPaths, "Draft image upload rollback");
    const message = err instanceof Error && err.message.trim() ? err.message.trim() : "Image upload failed.";
    return { data: null, error: { message } };
  }
}

export type DeleteDraftImageInput = {
  draftId: string;
  imageId: string;
  storagePath: string;
};

/** Delete a draft image row, then remove its storage object (logs storage failures). */
export async function deleteDraftImage(
  supabase: SupabaseClient,
  input: DeleteDraftImageInput,
): Promise<{ deleted: boolean; error: { message: string; code?: string } | null }> {
  const draftId = input.draftId?.trim() ?? "";
  const imageId = input.imageId?.trim() ?? "";
  if (!draftId) {
    return { deleted: false, error: { message: "Missing draft id" } };
  }
  if (!imageId) {
    return { deleted: false, error: { message: "Missing image id" } };
  }

  const { error } = await supabase
    .from("post_draft_images")
    .delete()
    .eq("id", imageId)
    .eq("draft_id", draftId);

  if (error) {
    return { deleted: false, error };
  }

  const path = input.storagePath?.trim() ?? "";
  if (path) {
    const { error: rmErr } = await supabase.storage.from(POST_IMAGES_BUCKET).remove([path]);
    if (rmErr) console.error("Draft image storage remove failed", rmErr);
  }

  return { deleted: true, error: null };
}

export type ReorderDraftImagesInput = {
  draftId: string;
  orderedImageIds: readonly string[];
};

/**
 * Reassign positions to match `orderedImageIds` (0..n-1).
 * Uses a two-step offset update to avoid unique (draft_id, position) conflicts.
 */
export async function reorderDraftImages(
  supabase: SupabaseClient,
  input: ReorderDraftImagesInput,
): Promise<{ data: PostDraftImageRow[] | null; error: { message: string; code?: string } | null }> {
  const draftId = input.draftId?.trim() ?? "";
  if (!draftId) {
    return { data: null, error: { message: "Missing draft id" } };
  }

  const orderedImageIds = input.orderedImageIds.map((id) => id.trim()).filter(Boolean);
  if (orderedImageIds.length === 0) {
    return { data: [], error: null };
  }

  const { data: currentRows, error: fetchError } = await supabase
    .from("post_draft_images")
    .select("id")
    .eq("draft_id", draftId);

  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const currentIds = new Set((currentRows ?? []).map((r: { id: string }) => r.id));
  if (currentIds.size !== orderedImageIds.length) {
    return { data: null, error: { message: "Reorder list must include every draft image exactly once." } };
  }
  for (const id of orderedImageIds) {
    if (!currentIds.has(id)) {
      return { data: null, error: { message: "Reorder list contains an unknown image id." } };
    }
  }

  for (let i = 0; i < orderedImageIds.length; i++) {
    const id = orderedImageIds[i]!;
    const { error } = await supabase
      .from("post_draft_images")
      .update({ position: REORDER_POSITION_OFFSET + i })
      .eq("id", id)
      .eq("draft_id", draftId);
    if (error) {
      return { data: null, error };
    }
  }

  for (let i = 0; i < orderedImageIds.length; i++) {
    const id = orderedImageIds[i]!;
    const { error } = await supabase
      .from("post_draft_images")
      .update({ position: i })
      .eq("id", id)
      .eq("draft_id", draftId);
    if (error) {
      return { data: null, error };
    }
  }

  const { data, error } = await supabase
    .from("post_draft_images")
    .select(DRAFT_IMAGE_ROW_SELECT)
    .eq("draft_id", draftId)
    .order("position", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  const rows = (data ?? [])
    .map((r) => hydrateDraftImageRow(r as Record<string, unknown>))
    .filter((r): r is PostDraftImageRow => r !== null);

  return { data: sortDraftImageRows(rows), error: null };
}

export type DeleteDraftWithImagesInput = {
  draftId: string;
};

/**
 * Delete draft row (cascade image rows) and best-effort storage cleanup.
 * Storage failures are logged; draft delete success is still reported.
 */
export async function deleteDraftWithImages(
  supabase: SupabaseClient,
  input: DeleteDraftWithImagesInput,
): Promise<{
  deleted: boolean;
  error: { message: string; code?: string } | null;
  storageCleanupFailed: boolean;
}> {
  const draftId = input.draftId?.trim() ?? "";
  if (!draftId) {
    return { deleted: false, error: { message: "Missing draft id" }, storageCleanupFailed: false };
  }

  const { data: imageRows, error: fetchError } = await supabase
    .from("post_draft_images")
    .select("storage_path")
    .eq("draft_id", draftId);

  if (fetchError) {
    return { deleted: false, error: fetchError, storageCleanupFailed: false };
  }

  const storagePaths = (imageRows ?? [])
    .map((r: { storage_path?: string | null }) => r.storage_path?.trim() ?? "")
    .filter(Boolean);

  const { data: deletedRow, error: deleteError } = await supabase
    .from("post_drafts")
    .delete()
    .eq("id", draftId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return { deleted: false, error: deleteError, storageCleanupFailed: false };
  }

  if (!deletedRow) {
    return { deleted: false, error: null, storageCleanupFailed: false };
  }

  let storageCleanupFailed = false;
  for (const path of storagePaths) {
    const { error: rmErr } = await supabase.storage.from(POST_IMAGES_BUCKET).remove([path]);
    if (rmErr) {
      storageCleanupFailed = true;
      console.error("Draft delete storage cleanup failed", rmErr);
    }
  }

  return { deleted: true, error: null, storageCleanupFailed };
}
