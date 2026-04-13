import type { SupabaseClient } from "@supabase/supabase-js";

/** What the app is about to do; used for rate-limit rules on the client. Add `like` | `comment` | `message` later. */
export type ProtectedActionSpec =
  | { kind: "post" }
  | { kind: "reblog" }
  | { kind: "follow"; followMode: "insert" | "delete" };

export type ActionGuardStatus = {
  authenticated: boolean;
  human_check_ok: boolean;
  post_rate_ok: boolean;
  follow_insert_rate_ok: boolean;
};

export type RunProtectedAction = (
  supabase: SupabaseClient,
  spec: ProtectedActionSpec,
  action: () => Promise<void>,
) => Promise<void>;
