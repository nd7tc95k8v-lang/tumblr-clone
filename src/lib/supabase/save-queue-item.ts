import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { PostQueueItem, QueueStatus } from "@/types/queue";

export type SaveQueueItemInput = {
  /** When set, updates an existing queue item owned by `userId`. When omitted, inserts a new row. */
  id?: string;
  userId: string;
  content: string;
  tags: string[];
  isNsfw: boolean;
  scheduledFor?: string | null;
  status?: QueueStatus;
  lastError?: string | null;
};

const POST_QUEUE_ROW_SELECT = `
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

function hydrateSavedQueueRow(row: Record<string, unknown>): PostQueueItem {
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

async function fetchNextQueuePosition(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ nextPosition: number; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("post_queue")
    .select("queue_position")
    .eq("user_id", userId)
    .order("queue_position", { ascending: false })
    .limit(1);

  if (error) {
    return { nextPosition: 0, error };
  }

  const maxPosition = data?.[0]?.queue_position;
  if (typeof maxPosition !== "number" || Number.isNaN(maxPosition)) {
    return { nextPosition: 0, error: null };
  }
  return { nextPosition: maxPosition + 1, error: null };
}

/** Upsert queue metadata only (no image upload in this phase). */
export async function saveQueueItem(
  supabase: SupabaseClient,
  input: SaveQueueItemInput,
): Promise<{ data: PostQueueItem | null; error: { message: string; code?: string } | null }> {
  const userId = input.userId?.trim() ?? "";
  if (!userId) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const payload: Record<string, unknown> = {
    user_id: userId,
    content: input.content,
    tags: coercePostTags(input.tags),
    is_nsfw: Boolean(input.isNsfw),
  };

  if (input.scheduledFor !== undefined) {
    payload.scheduled_for = input.scheduledFor;
  }
  if (input.status !== undefined) {
    payload.status = input.status;
  }
  if (input.lastError !== undefined) {
    payload.last_error = input.lastError;
  }

  const queueId = input.id?.trim() ?? "";

  if (queueId) {
    const { data, error } = await supabase
      .from("post_queue")
      .update(payload)
      .eq("id", queueId)
      .eq("user_id", userId)
      .select(POST_QUEUE_ROW_SELECT)
      .maybeSingle();

    if (error) {
      return { data: null, error };
    }
    if (!data) {
      return { data: null, error: { message: "Queue item not found" } };
    }
    return { data: hydrateSavedQueueRow(data as Record<string, unknown>), error: null };
  }

  const { nextPosition, error: positionError } = await fetchNextQueuePosition(supabase, userId);
  if (positionError) {
    return { data: null, error: positionError };
  }

  const { data, error } = await supabase
    .from("post_queue")
    .insert({ ...payload, queue_position: nextPosition })
    .select(POST_QUEUE_ROW_SELECT)
    .single();

  if (error) {
    return { data: null, error };
  }

  return { data: hydrateSavedQueueRow(data as Record<string, unknown>), error: null };
}
