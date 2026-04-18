import { createServiceRoleServerClient } from "@/lib/supabase/server-service-role";

/** Public Explore surface: last-7d discovery + last-7d momentum (see `admin_top_tag_engagement`). */
const TRENDING_WINDOW = "7 days";
const TRENDING_LIMIT = 12;

export type TrendingTag = {
  tag: string;
  engagement_score: number;
};

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
 * Server-only: calls `admin_top_tag_engagement` (service_role). Safe read-only.
 * Returns top tags for the last 7 days (posts + engagement), capped for display.
 */
export async function fetchTrendingTags(): Promise<{
  data: TrendingTag[] | null;
  error: { message: string } | null;
}> {
  const supabase = createServiceRoleServerClient();
  if (!supabase) {
    return { data: null, error: { message: "Service role not configured." } };
  }

  const { data, error } = await supabase.rpc("admin_top_tag_engagement", {
    limit_count: TRENDING_LIMIT,
    time_window: TRENDING_WINDOW,
    engagement_window: TRENDING_WINDOW,
  });

  if (error) {
    return { data: null, error: { message: error.message } };
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const mapped: TrendingTag[] = rows.map((r) => ({
    tag: typeof r.tag === "string" ? r.tag : String(r.tag ?? ""),
    engagement_score: num(r.engagement_score),
  }));

  return { data: mapped, error: null };
}
