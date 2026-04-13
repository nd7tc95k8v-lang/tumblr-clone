import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionGuardStatus } from "./types";

function parseGuardPayload(data: unknown): ActionGuardStatus | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  return {
    authenticated: Boolean(o.authenticated),
    human_check_ok: Boolean(o.human_check_ok),
    post_rate_ok: Boolean(o.post_rate_ok),
    follow_insert_rate_ok: Boolean(o.follow_insert_rate_ok),
  };
}

export async function fetchActionGuardStatus(
  supabase: SupabaseClient,
): Promise<ActionGuardStatus | null> {
  const { data, error } = await supabase.rpc("get_action_guard_status");
  if (error) {
    console.error(error);
    return null;
  }
  return parseGuardPayload(data);
}
