import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxNotificationRow } from "@/types/notification";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(n: number | undefined): number {
  if (n === undefined || n === null || Number.isNaN(n)) return DEFAULT_LIMIT;
  const v = Math.floor(n);
  if (v <= 0) return DEFAULT_LIMIT;
  return Math.min(v, MAX_LIMIT);
}

function coerceKind(k: string): InboxNotificationRow["kind"] | null {
  if (k === "follow" || k === "like" || k === "reblog" || k === "comment") return k;
  return null;
}

export async function fetchNotificationInboxList(
  supabase: SupabaseClient,
  limit?: number,
): Promise<{ data: InboxNotificationRow[] | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("notification_inbox_list", {
    p_limit: clampLimit(limit),
  });
  if (error) {
    return { data: null, error: { message: error.message } };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const out: InboxNotificationRow[] = [];
  for (const r of rows) {
    const kind = coerceKind(String(r.kind ?? ""));
    if (!kind) continue;
    out.push({
      kind,
      created_at: String(r.created_at ?? ""),
      actor_id: String(r.actor_id ?? ""),
      actor_username: r.actor_username != null ? String(r.actor_username) : null,
      actor_avatar: r.actor_avatar != null ? String(r.actor_avatar) : null,
      thread_root_post_id: r.thread_root_post_id != null ? String(r.thread_root_post_id) : null,
      related_post_id: r.related_post_id != null ? String(r.related_post_id) : null,
    });
  }
  return { data: out, error: null };
}

export async function fetchNotificationUnreadCount(
  supabase: SupabaseClient,
): Promise<{ count: number; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("notification_inbox_unread_count");
  if (error) {
    return { count: 0, error: { message: error.message } };
  }
  const n = typeof data === "number" ? data : Number(data);
  return { count: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0, error: null };
}

export async function fetchNotificationLastReadAt(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ lastReadAt: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("notification_inbox_read_state")
    .select("last_read_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return { lastReadAt: null, error: { message: error.message } };
  }
  const raw = data?.last_read_at;
  return { lastReadAt: typeof raw === "string" ? raw : null, error: null };
}

/**
 * Watermark: events newer than this were unread before the user opened the inbox.
 * Upsert is idempotent for the same user.
 */
export async function markNotificationInboxRead(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("notification_inbox_read_state").upsert(
    { user_id: userId, last_read_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) {
    return { error: { message: error.message } };
  }
  return { error: null };
}
