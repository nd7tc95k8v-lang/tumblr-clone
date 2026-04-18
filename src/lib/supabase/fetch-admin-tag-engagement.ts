import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminTagEngagementRow = {
  tag: string;
  post_count: number;
  total_likes: number;
  total_reblogs: number;
  engagement_score: number;
};

/** Query value for `?window=` — maps to Postgres `interval` strings for the RPC. */
export type AdminTagEngagementWindow = "all" | "24h" | "7d" | "30d";

const WINDOW_TO_INTERVAL: Record<Exclude<AdminTagEngagementWindow, "all">, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export function adminTagWindowToInterval(window: AdminTagEngagementWindow): string | null {
  if (window === "all") return null;
  return WINDOW_TO_INTERVAL[window];
}

export function parseAdminTagWindowParam(
  raw: string | null | undefined,
): { ok: true; value: AdminTagEngagementWindow } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: "all" };
  }
  if (raw === "24h" || raw === "7d" || raw === "30d") {
    return { ok: true, value: raw };
  }
  return { ok: false, error: "Invalid window. Use 24h, 7d, or 30d." };
}

/** Same allowed tokens as `window` — used for `?engagement_window=`. */
export function parseAdminTagEngagementWindowParam(
  raw: string | null | undefined,
): { ok: true; value: AdminTagEngagementWindow } | { ok: false; error: string } {
  const r = parseAdminTagWindowParam(raw);
  if (!r.ok) {
    return { ok: false, error: "Invalid engagement_window. Use 24h, 7d, or 30d." };
  }
  return r;
}

function num(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Read-only admin RPC: top tags by engagement (thread-root likes/reblogs, see migrations).
 * - `timeWindowInterval`: only posts in `expanded` with `created_at` in window (discovery); null = all time.
 * - `engagementWindowInterval`: when set, only likes/reblogs in that window count (momentum); null = lifetime.
 * Caller must use a Supabase client authorized to execute the function (e.g. service_role).
 */
export async function fetchAdminTopTagEngagement(
  supabase: SupabaseClient,
  limitCount: number = 50,
  timeWindowInterval: string | null = null,
  engagementWindowInterval: string | null = null,
): Promise<{ data: AdminTagEngagementRow[] | null; error: { message: string } | null }> {
  const capped = Math.min(500, Math.max(1, Math.floor(limitCount) || 50));
  const { data, error } = await supabase.rpc("admin_top_tag_engagement", {
    limit_count: capped,
    time_window: timeWindowInterval,
    engagement_window: engagementWindowInterval,
  });
  if (error) {
    return { data: null, error: { message: error.message } };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const mapped: AdminTagEngagementRow[] = rows.map((r) => ({
    tag: typeof r.tag === "string" ? r.tag : String(r.tag ?? ""),
    post_count: num(r.post_count),
    total_likes: num(r.total_likes),
    total_reblogs: num(r.total_reblogs),
    engagement_score: num(r.engagement_score),
  }));
  return { data: mapped, error: null };
}
