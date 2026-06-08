import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { PostQueueItem, QueueStatus } from "@/types/queue";
import { coercePostQueueImageRows } from "./queue-images";

const POST_QUEUE_SELECT = `
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
  updated_at,
  post_queue_images ( id, queue_id, user_id, storage_path, position, created_at )
`;

type QueueQueryRow = {
  id: string;
  user_id: string;
  content: string;
  tags?: unknown;
  is_nsfw?: boolean | null;
  queue_position: number;
  scheduled_for?: string | null;
  status?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
  post_queue_images?: unknown;
};

function coerceQueueStatus(raw: unknown): QueueStatus {
  if (raw === "queued" || raw === "publishing" || raw === "failed") return raw;
  return "queued";
}

function hydrateQueueRow(row: QueueQueryRow): PostQueueItem {
  return {
    id: row.id,
    user_id: row.user_id,
    content: row.content,
    tags: coercePostTags(row.tags),
    is_nsfw: Boolean(row.is_nsfw),
    queue_position: Number(row.queue_position ?? 0),
    scheduled_for: row.scheduled_for ?? null,
    status: coerceQueueStatus(row.status),
    last_error: row.last_error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    post_queue_images: coercePostQueueImageRows(row.post_queue_images, row.id),
  };
}

/** Ordered by `queue_position` asc, then `created_at` asc; includes images ordered by `position`. */
export async function fetchQueueItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: PostQueueItem[] | null; error: { message: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase
    .from("post_queue")
    .select(POST_QUEUE_SELECT)
    .eq("user_id", uid)
    .order("queue_position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return { data: (data ?? []).map((row) => hydrateQueueRow(row as QueueQueryRow)), error: null };
}

export async function fetchQueueItemById(
  supabase: SupabaseClient,
  queueId: string,
  userId: string,
): Promise<{ data: PostQueueItem | null; error: { message: string } | null }> {
  const id = queueId?.trim() ?? "";
  const uid = userId?.trim() ?? "";
  if (!id) {
    return { data: null, error: { message: "Missing queue id" } };
  }
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase
    .from("post_queue")
    .select(POST_QUEUE_SELECT)
    .eq("id", id)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }
  if (!data) {
    return { data: null, error: null };
  }

  return { data: hydrateQueueRow(data as QueueQueryRow), error: null };
}
