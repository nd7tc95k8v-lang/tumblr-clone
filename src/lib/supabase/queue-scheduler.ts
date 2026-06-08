import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { PostQueueItem, QueueStatus } from "@/types/queue";

export type DueQueueUser = {
  user_id: string;
  queue_interval_minutes: number;
  queue_next_run_at: string | null;
};

function coerceQueueStatus(raw: unknown): QueueStatus {
  if (raw === "queued" || raw === "publishing" || raw === "failed") return raw;
  return "queued";
}

function hydrateQueueRow(row: Record<string, unknown>): PostQueueItem {
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

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

/** Scheduler-only atomic claim for explicit user_id. */
export async function claimQueueItemForPublishWorker(
  supabase: SupabaseClient,
  userId: string,
  queueId: string,
): Promise<{ data: PostQueueItem | null; error: { message: string; code?: string } | null }> {
  const uid = userId?.trim() ?? "";
  const id = queueId?.trim() ?? "";
  if (!uid || !id) {
    return { data: null, error: { message: "Missing queue item." } };
  }

  const { data, error } = await supabase.rpc("claim_queue_item_for_publish_worker", {
    p_user_id: uid,
    p_queue_id: id,
  });

  if (error) {
    return { data: null, error };
  }

  const row = firstRpcRow(data);
  if (!row) {
    return { data: null, error: null };
  }

  return { data: hydrateQueueRow(row), error: null };
}

/** Scheduler-only stale publishing reset for all users. */
export async function resetStaleQueuePublishingWorker(
  supabase: SupabaseClient,
  olderThanMinutes: number = 15,
): Promise<{ resetCount: number; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase.rpc("reset_stale_queue_publishing_worker", {
    p_older_than_minutes: olderThanMinutes,
  });

  if (error) {
    return { resetCount: 0, error };
  }

  const resetCount = typeof data === "number" ? data : Number(data ?? 0);
  return { resetCount: Number.isFinite(resetCount) ? resetCount : 0, error: null };
}

/** Scheduler-only: users with queue_enabled due for a tick. */
export async function selectDueQueueUsers(
  supabase: SupabaseClient,
  limit: number = 50,
): Promise<{ data: DueQueueUser[]; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase.rpc("select_due_queue_users", {
    p_limit: limit,
  });

  if (error) {
    return { data: [], error };
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const out: DueQueueUser[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const user_id = String(row.user_id ?? "").trim();
    if (!user_id) continue;
    out.push({
      user_id,
      queue_interval_minutes: Number(row.queue_interval_minutes ?? 240),
      queue_next_run_at: row.queue_next_run_at == null ? null : String(row.queue_next_run_at),
    });
  }

  return { data: out, error: null };
}

/** Scheduler-only: next claimable queue row for a user. */
export async function selectNextSchedulableQueueItem(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: PostQueueItem | null; error: { message: string; code?: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase.rpc("select_next_schedulable_queue_item", {
    p_user_id: uid,
  });

  if (error) {
    return { data: null, error };
  }

  const row = firstRpcRow(data);
  if (!row) {
    return { data: null, error: null };
  }

  return { data: hydrateQueueRow(row), error: null };
}

/** Scheduler-only: bump queue_next_run_at by queue_interval_minutes. */
export async function advanceQueueSchedulerNextRun(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ nextRunAt: string | null; error: { message: string; code?: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { nextRunAt: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase.rpc("advance_queue_scheduler_next_run", {
    p_user_id: uid,
  });

  if (error) {
    return { nextRunAt: null, error };
  }

  if (data == null) {
    return { nextRunAt: null, error: null };
  }

  return { nextRunAt: String(data), error: null };
}

/** Scheduler-only: set queue_next_run_at when enabled and unset. */
export async function initializeQueueSchedulerNextRun(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ nextRunAt: string | null; error: { message: string; code?: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { nextRunAt: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase.rpc("initialize_queue_scheduler_next_run", {
    p_user_id: uid,
  });

  if (error) {
    return { nextRunAt: null, error };
  }

  if (data == null) {
    return { nextRunAt: null, error: null };
  }

  return { nextRunAt: String(data), error: null };
}
