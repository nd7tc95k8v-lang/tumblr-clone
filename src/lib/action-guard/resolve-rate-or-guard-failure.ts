import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTION_GUARD_GENERIC_MESSAGE,
  FOLLOW_RATE_LIMIT_MESSAGE,
  HUMAN_VERIFICATION_NEEDED_MESSAGE,
  POSTING_TOO_QUICK_MESSAGE,
} from "./constants";
import { fetchActionGuardStatus } from "./fetch-action-guard-status";
import type { ProtectedActionSpec } from "./types";

const NOTE_COMMENT_GUARD_MESSAGE =
  "Could not add that note. If it keeps happening, wait a minute and try again.";

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
export async function resolveLikelyRateOrGuardFailureMessage(
  supabase: SupabaseClient,
  error: { message?: string; code?: string } | null,
  spec: ProtectedActionSpec,
): Promise<string> {
  if (!error) {
    return ACTION_GUARD_GENERIC_MESSAGE;
  }

  if (!isRlsLikeError(error)) {
    return error.message?.trim() ? error.message : ACTION_GUARD_GENERIC_MESSAGE;
  }

  const status = await fetchActionGuardStatus(supabase);
  if (!status) {
    return ACTION_GUARD_GENERIC_MESSAGE;
  }

  if (!status.human_check_ok) {
    return HUMAN_VERIFICATION_NEEDED_MESSAGE;
  }

  if (spec.kind === "post" || spec.kind === "reblog") {
    if (!status.post_rate_ok) {
      return POSTING_TOO_QUICK_MESSAGE;
    }
  }

  if (spec.kind === "follow" && spec.followMode === "insert") {
    if (!status.follow_insert_rate_ok) {
      return FOLLOW_RATE_LIMIT_MESSAGE;
    }
  }

  if (spec.kind === "note_comment") {
    return NOTE_COMMENT_GUARD_MESSAGE;
  }

  return ACTION_GUARD_GENERIC_MESSAGE;
}
