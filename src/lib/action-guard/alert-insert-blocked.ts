import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTION_GUARD_GENERIC_MESSAGE,
  FOLLOW_RATE_LIMIT_MESSAGE,
  HUMAN_VERIFICATION_NEEDED_MESSAGE,
  POSTING_TOO_QUICK_MESSAGE,
} from "./constants";
import { fetchActionGuardStatus } from "./fetch-action-guard-status";
import type { ProtectedActionSpec } from "./types";

function isRlsLikeError(error: { message?: string; code?: string }): boolean {
  const code = String(error.code ?? "");
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42501" ||
    msg.includes("row-level security") ||
    msg.includes("violates row-level security") ||
    msg.includes("permission denied")
  );
}

/** Map common Supabase errors after a guarded insert/delete to user-facing text. */
export async function alertIfLikelyRateOrGuardFailure(
  supabase: SupabaseClient,
  error: { message?: string; code?: string } | null,
  spec: ProtectedActionSpec,
): Promise<void> {
  if (!error) {
    alert(ACTION_GUARD_GENERIC_MESSAGE);
    return;
  }

  if (!isRlsLikeError(error)) {
    alert(error.message?.trim() ? error.message : ACTION_GUARD_GENERIC_MESSAGE);
    return;
  }

  const status = await fetchActionGuardStatus(supabase);
  if (!status) {
    alert(ACTION_GUARD_GENERIC_MESSAGE);
    return;
  }

  if (!status.human_check_ok) {
    alert(HUMAN_VERIFICATION_NEEDED_MESSAGE);
    return;
  }

  if (spec.kind === "post" || spec.kind === "reblog") {
    if (!status.post_rate_ok) {
      alert(POSTING_TOO_QUICK_MESSAGE);
      return;
    }
  }

  if (spec.kind === "follow" && spec.followMode === "insert") {
    if (!status.follow_insert_rate_ok) {
      alert(FOLLOW_RATE_LIMIT_MESSAGE);
      return;
    }
  }

  if (spec.kind === "note_comment") {
    alert("Could not add that note. If it keeps happening, wait a minute and try again.");
    return;
  }

  alert(ACTION_GUARD_GENERIC_MESSAGE);
}
