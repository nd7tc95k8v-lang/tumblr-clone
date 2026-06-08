import type { SupabaseClient } from "@supabase/supabase-js";
import { POST_IMAGES_BUCKET } from "@/lib/compose/constants";
import { fileExtensionFromFileName } from "@/lib/compose/storage-path";
import { coercePostTags } from "@/lib/tags";
import type { PostQueueImageRow, PostQueueItem, QueueStatus } from "@/types/queue";
import {
  isQueueFolderStoragePath,
  validateQueueImageReusePaths,
} from "./validate-queue-image-storage-path";

export type QueueImageSource =
  | { kind: "file"; file: File }
  | { kind: "storage_path"; storagePath: string };

/** Coerce PostgREST embed into sorted queue image rows. */
export function coercePostQueueImageRows(raw: unknown, parentQueueId?: string): PostQueueImageRow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const fallbackQueueId = parentQueueId?.trim() ?? "";
  const out: PostQueueImageRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const queue_id = String(o.queue_id ?? fallbackQueueId).trim();
    const user_id = String(o.user_id ?? "").trim();
    const storage_path = String(o.storage_path ?? "").trim();
    const position = Number(o.position ?? 0);
    const id = String(o.id ?? "").trim();
    const created_at = String(o.created_at ?? "");
    if (!id || !queue_id || !user_id || !storage_path) continue;
    out.push({ id, queue_id, user_id, storage_path, position, created_at });
  }
  out.sort((a, b) => a.position - b.position);
  return out.length > 0 ? out : null;
}

const QUEUE_IMAGE_ROW_SELECT = "id, queue_id, user_id, storage_path, position, created_at";

/** Offset used during reorder to avoid unique (queue_id, position) conflicts. */
const REORDER_POSITION_OFFSET = 1_000_000;

/** Offset used during queue item reorder to avoid unique (user_id, queue_position) conflicts. */
const REORDER_QUEUE_POSITION_OFFSET = 1_000_000;

export type UploadQueueImageFilesInput = {
  userId: string;
  queueId: string;
  files: readonly File[];
};

/** `{userId}/queue/{queueId}/{uuid}.{ext}` — satisfies post_queue_images storage_path_prefix. */
export function buildQueueImageStoragePath(userId: string, queueId: string, fileName: string): string {
  const fileExt = fileExtensionFromFileName(fileName);
  return `${userId}/queue/${queueId}/${crypto.randomUUID()}.${fileExt}`;
}

function hydrateQueueImageRow(row: Record<string, unknown>): PostQueueImageRow | null {
  const id = String(row.id ?? "").trim();
  const queue_id = String(row.queue_id ?? "").trim();
  const user_id = String(row.user_id ?? "").trim();
  const storage_path = String(row.storage_path ?? "").trim();
  const position = Number(row.position ?? 0);
  const created_at = String(row.created_at ?? "");
  if (!id || !queue_id || !user_id || !storage_path) return null;
  return { id, queue_id, user_id, storage_path, position, created_at };
}

function sortQueueImageRows(rows: PostQueueImageRow[]): PostQueueImageRow[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

async function removeQueueStoragePaths(
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

async function fetchNextQueueImagePosition(
  supabase: SupabaseClient,
  queueId: string,
): Promise<{ nextPosition: number; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("post_queue_images")
    .select("position")
    .eq("queue_id", queueId)
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

async function copyStoragePathToQueuePath(
  supabase: SupabaseClient,
  sourcePath: string,
  destPath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.storage.from(POST_IMAGES_BUCKET).copy(sourcePath, destPath);
  if (error) {
    console.error(error);
    const m = error.message?.trim() || "Could not copy saved image into queue storage.";
    return { ok: false, message: m };
  }
  return { ok: true };
}

/**
 * Link queue images from new uploads and/or reused draft/queue storage paths.
 * Draft paths are copied into `{userId}/queue/{queueId}/…` (DB requires `/queue/` prefix).
 * Rolls back only newly created queue storage objects on failure.
 */
export async function linkQueueImageSources(
  supabase: SupabaseClient,
  input: {
    userId: string;
    queueId: string;
    sources: readonly QueueImageSource[];
  },
): Promise<{ data: PostQueueImageRow[] | null; error: { message: string; code?: string } | null }> {
  const userId = input.userId?.trim() ?? "";
  const queueId = input.queueId?.trim() ?? "";
  if (!userId) {
    return { data: null, error: { message: "Missing user id" } };
  }
  if (!queueId) {
    return { data: null, error: { message: "Missing queue id" } };
  }
  if (input.sources.length === 0) {
    return { data: [], error: null };
  }

  const reusePaths = input.sources
    .filter((source): source is Extract<QueueImageSource, { kind: "storage_path" }> => source.kind === "storage_path")
    .map((source) => source.storagePath.trim());

  const pathValidation = validateQueueImageReusePaths(userId, reusePaths);
  if (!pathValidation.ok) {
    return { data: null, error: { message: pathValidation.message } };
  }

  const uploadedStoragePaths: string[] = [];
  const insertRows: Array<{
    queue_id: string;
    user_id: string;
    storage_path: string;
    position: number;
  }> = [];

  try {
    const { nextPosition, error: positionError } = await fetchNextQueueImagePosition(supabase, queueId);
    if (positionError) {
      return { data: null, error: positionError };
    }

    let position = nextPosition;

    for (const source of input.sources) {
      if (source.kind === "storage_path") {
        const sourcePath = source.storagePath.trim();
        let storage_path = sourcePath;

        if (!isQueueFolderStoragePath(userId, sourcePath)) {
          storage_path = buildQueueImageStoragePath(userId, queueId, sourcePath.split("/").pop() ?? "image.jpg");
          const copyResult = await copyStoragePathToQueuePath(supabase, sourcePath, storage_path);
          if (!copyResult.ok) {
            throw new Error(copyResult.message);
          }
          uploadedStoragePaths.push(storage_path);
        }

        insertRows.push({ queue_id: queueId, user_id: userId, storage_path, position });
        position += 1;
        continue;
      }

      const fileExt = fileExtensionFromFileName(source.file.name);
      const storage_path = buildQueueImageStoragePath(userId, queueId, source.file.name);

      const { error: uploadError } = await supabase.storage.from(POST_IMAGES_BUCKET).upload(storage_path, source.file, {
        contentType: source.file.type || `image/${fileExt}`,
        upsert: false,
      });

      if (uploadError) {
        console.error(uploadError);
        const m = uploadError.message?.trim() || "Image upload failed.";
        throw new Error(`Image upload failed: ${m}`);
      }

      uploadedStoragePaths.push(storage_path);
      insertRows.push({ queue_id: queueId, user_id: userId, storage_path, position });
      position += 1;
    }

    const { data, error: insertError } = await supabase
      .from("post_queue_images")
      .insert(insertRows)
      .select(QUEUE_IMAGE_ROW_SELECT);

    if (insertError) {
      console.error(insertError);
      await removeQueueStoragePaths(supabase, uploadedStoragePaths, "Queue image link rollback");
      const m = insertError.message?.trim() || insertError.code || "Could not save queue image records.";
      return { data: null, error: { message: `Saving queue image records failed: ${m}`, code: insertError.code } };
    }

    const rows = (data ?? [])
      .map((r) => hydrateQueueImageRow(r as Record<string, unknown>))
      .filter((r): r is PostQueueImageRow => r !== null);

    return { data: sortQueueImageRows(rows), error: null };
  } catch (err) {
    await removeQueueStoragePaths(supabase, uploadedStoragePaths, "Queue image link rollback");
    const message = err instanceof Error && err.message.trim() ? err.message.trim() : "Image upload failed.";
    return { data: null, error: { message } };
  }
}

/**
 * Upload prepared files to `post-images`, insert `post_queue_images` rows with sequential positions.
 * Rolls back uploaded storage objects if DB insert fails.
 */
export async function uploadQueueImageFiles(
  supabase: SupabaseClient,
  input: UploadQueueImageFilesInput,
): Promise<{ data: PostQueueImageRow[] | null; error: { message: string; code?: string } | null }> {
  const userId = input.userId?.trim() ?? "";
  const queueId = input.queueId?.trim() ?? "";
  if (!userId) {
    return { data: null, error: { message: "Missing user id" } };
  }
  if (!queueId) {
    return { data: null, error: { message: "Missing queue id" } };
  }
  if (input.files.length === 0) {
    return { data: [], error: null };
  }

  return linkQueueImageSources(supabase, {
    userId,
    queueId,
    sources: input.files.map((file) => ({ kind: "file", file })),
  });
}

export type DeleteQueueImageInput = {
  queueId: string;
  imageId: string;
  storagePath: string;
};

/** Delete a queue image row, then remove its storage object (logs storage failures). */
export async function deleteQueueImage(
  supabase: SupabaseClient,
  input: DeleteQueueImageInput,
): Promise<{ deleted: boolean; error: { message: string; code?: string } | null }> {
  const queueId = input.queueId?.trim() ?? "";
  const imageId = input.imageId?.trim() ?? "";
  if (!queueId) {
    return { deleted: false, error: { message: "Missing queue id" } };
  }
  if (!imageId) {
    return { deleted: false, error: { message: "Missing image id" } };
  }

  const { error } = await supabase
    .from("post_queue_images")
    .delete()
    .eq("id", imageId)
    .eq("queue_id", queueId);

  if (error) {
    return { deleted: false, error };
  }

  const path = input.storagePath?.trim() ?? "";
  if (path) {
    const { error: rmErr } = await supabase.storage.from(POST_IMAGES_BUCKET).remove([path]);
    if (rmErr) console.error("Queue image storage remove failed", rmErr);
  }

  return { deleted: true, error: null };
}

export type ReorderQueueImagesInput = {
  queueId: string;
  orderedImageIds: readonly string[];
};

/**
 * Reassign image positions to match `orderedImageIds` (0..n-1).
 * Uses a two-step offset update to avoid unique (queue_id, position) conflicts.
 */
export async function reorderQueueImages(
  supabase: SupabaseClient,
  input: ReorderQueueImagesInput,
): Promise<{ data: PostQueueImageRow[] | null; error: { message: string; code?: string } | null }> {
  const queueId = input.queueId?.trim() ?? "";
  if (!queueId) {
    return { data: null, error: { message: "Missing queue id" } };
  }

  const orderedImageIds = input.orderedImageIds.map((id) => id.trim()).filter(Boolean);
  if (orderedImageIds.length === 0) {
    return { data: [], error: null };
  }

  const { data: currentRows, error: fetchError } = await supabase
    .from("post_queue_images")
    .select("id")
    .eq("queue_id", queueId);

  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const currentIds = new Set((currentRows ?? []).map((r: { id: string }) => r.id));
  if (currentIds.size !== orderedImageIds.length) {
    return { data: null, error: { message: "Reorder list must include every queue image exactly once." } };
  }
  for (const id of orderedImageIds) {
    if (!currentIds.has(id)) {
      return { data: null, error: { message: "Reorder list contains an unknown image id." } };
    }
  }

  for (let i = 0; i < orderedImageIds.length; i++) {
    const id = orderedImageIds[i]!;
    const { error } = await supabase
      .from("post_queue_images")
      .update({ position: REORDER_POSITION_OFFSET + i })
      .eq("id", id)
      .eq("queue_id", queueId);
    if (error) {
      return { data: null, error };
    }
  }

  for (let i = 0; i < orderedImageIds.length; i++) {
    const id = orderedImageIds[i]!;
    const { error } = await supabase
      .from("post_queue_images")
      .update({ position: i })
      .eq("id", id)
      .eq("queue_id", queueId);
    if (error) {
      return { data: null, error };
    }
  }

  const { data, error } = await supabase
    .from("post_queue_images")
    .select(QUEUE_IMAGE_ROW_SELECT)
    .eq("queue_id", queueId)
    .order("position", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  const rows = (data ?? [])
    .map((r) => hydrateQueueImageRow(r as Record<string, unknown>))
    .filter((r): r is PostQueueImageRow => r !== null);

  return { data: sortQueueImageRows(rows), error: null };
}

export type DeleteQueueItemWithImagesInput = {
  queueId: string;
};

/**
 * Delete queue row (cascade image rows) and best-effort storage cleanup.
 * Storage failures are logged; queue delete success is still reported.
 */
export async function deleteQueueItemWithImages(
  supabase: SupabaseClient,
  input: DeleteQueueItemWithImagesInput,
): Promise<{
  deleted: boolean;
  error: { message: string; code?: string } | null;
  storageCleanupFailed: boolean;
}> {
  const queueId = input.queueId?.trim() ?? "";
  if (!queueId) {
    return { deleted: false, error: { message: "Missing queue id" }, storageCleanupFailed: false };
  }

  const { data: imageRows, error: fetchError } = await supabase
    .from("post_queue_images")
    .select("storage_path")
    .eq("queue_id", queueId);

  if (fetchError) {
    return { deleted: false, error: fetchError, storageCleanupFailed: false };
  }

  const storagePaths = (imageRows ?? [])
    .map((r: { storage_path?: string | null }) => r.storage_path?.trim() ?? "")
    .filter(Boolean);

  const { data: deletedRow, error: deleteError } = await supabase
    .from("post_queue")
    .delete()
    .eq("id", queueId)
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
      console.error("Queue delete storage cleanup failed", rmErr);
    }
  }

  return { deleted: true, error: null, storageCleanupFailed };
}

export type ReorderQueueItemsInput = {
  userId: string;
  orderedQueueIds: readonly string[];
};

const POST_QUEUE_REORDER_SELECT = `
  id,
  user_id,
  content,
  tags,
  is_nsfw,
  queue_position,
  scheduled_for,
  status,
  last_error,
  created_at,
  updated_at
`;

function coerceQueueStatus(raw: unknown): QueueStatus {
  if (raw === "queued" || raw === "publishing" || raw === "failed") return raw;
  return "queued";
}

function hydrateReorderedQueueRow(row: Record<string, unknown>): PostQueueItem {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    content: String(row.content ?? ""),
    tags: coercePostTags(row.tags),
    is_nsfw: Boolean(row.is_nsfw),
    queue_position: Number(row.queue_position ?? 0),
    scheduled_for: row.scheduled_for == null ? null : String(row.scheduled_for),
    status: coerceQueueStatus(row.status),
    last_error: row.last_error == null ? null : String(row.last_error),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    post_queue_images: null,
  };
}

/**
 * Reassign `queue_position` to match `orderedQueueIds` (0..n-1) for the given user.
 * Uses a two-step offset update to avoid unique (user_id, queue_position) conflicts.
 */
export async function reorderQueueItems(
  supabase: SupabaseClient,
  input: ReorderQueueItemsInput,
): Promise<{ data: PostQueueItem[] | null; error: { message: string; code?: string } | null }> {
  const userId = input.userId?.trim() ?? "";
  if (!userId) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const orderedQueueIds = input.orderedQueueIds.map((id) => id.trim()).filter(Boolean);
  if (orderedQueueIds.length === 0) {
    return { data: [], error: null };
  }

  const { data: currentRows, error: fetchError } = await supabase
    .from("post_queue")
    .select("id")
    .eq("user_id", userId);

  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const currentIds = new Set((currentRows ?? []).map((r: { id: string }) => r.id));
  if (currentIds.size !== orderedQueueIds.length) {
    return { data: null, error: { message: "Reorder list must include every queue item exactly once." } };
  }
  for (const id of orderedQueueIds) {
    if (!currentIds.has(id)) {
      return { data: null, error: { message: "Reorder list contains an unknown queue id." } };
    }
  }

  for (let i = 0; i < orderedQueueIds.length; i++) {
    const id = orderedQueueIds[i]!;
    const { error } = await supabase
      .from("post_queue")
      .update({ queue_position: REORDER_QUEUE_POSITION_OFFSET + i })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      return { data: null, error };
    }
  }

  for (let i = 0; i < orderedQueueIds.length; i++) {
    const id = orderedQueueIds[i]!;
    const { error } = await supabase
      .from("post_queue")
      .update({ queue_position: i })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      return { data: null, error };
    }
  }

  const { data, error } = await supabase
    .from("post_queue")
    .select(POST_QUEUE_REORDER_SELECT)
    .eq("user_id", userId)
    .order("queue_position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return {
    data: (data ?? []).map((r) => hydrateReorderedQueueRow(r as Record<string, unknown>)),
    error: null,
  };
}
