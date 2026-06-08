import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { PostQueueItem, QueueStatus } from "@/types/queue";

export const QUEUE_CLAIM_UNAVAILABLE_MESSAGE =
  "This queue item is already publishing or no longer available.";

export const QUEUE_PUBLISH_TIMEOUT_MESSAGE = "Publish timed out. Please retry.";

function coerceQueueStatus(raw: unknown): QueueStatus {
  if (raw === "queued" || raw === "publishing" || raw === "failed") return raw;
  return "queued";
}

function hydrateClaimedQueueRow(row: Record<string, unknown>): PostQueueItem {
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

/** Atomically claim a queue row for publish (queued/failed → publishing). */
export async function claimQueueItemForPublish(
  supabase: SupabaseClient,
  queueId: string,
): Promise<{ data: PostQueueItem | null; error: { message: string; code?: string } | null }> {
  const id = queueId?.trim() ?? "";
  if (!id) {
    return { data: null, error: { message: "Missing queue id" } };
  }

  const { data, error } = await supabase.rpc("claim_queue_item_for_publish", {
    p_queue_id: id,
  });

  if (error) {
    return { data: null, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { data: null, error: null };
  }

  return { data: hydrateClaimedQueueRow(row as Record<string, unknown>), error: null };
}

/** Mark stale publishing rows failed for the authenticated user. */
export async function resetStaleQueuePublishing(
  supabase: SupabaseClient,
  olderThanMinutes: number = 15,
): Promise<{ resetCount: number; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase.rpc("reset_stale_queue_publishing", {
    p_older_than_minutes: olderThanMinutes,
  });

  if (error) {
    return { resetCount: 0, error };
  }

  const resetCount = typeof data === "number" ? data : Number(data ?? 0);
  return { resetCount: Number.isFinite(resetCount) ? resetCount : 0, error: null };
}
