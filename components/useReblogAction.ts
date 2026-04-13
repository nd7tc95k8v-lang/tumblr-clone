"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { reblogInsertFields } from "@/lib/reblog";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";

export type UseReblogActionOptions = {
  /** Runs after a successful insert (e.g. reload the feed). */
  onSuccess: () => void | Promise<void>;
};

/**
 * Reblog flow: auth check → guarded insert via {@link reblogInsertFields} → optional reload.
 * Returns whether the reblog row was inserted (false if unauthenticated, blocked, or errored).
 */
export function useReblogAction(
  supabase: SupabaseClient | null,
  { onSuccess }: UseReblogActionOptions,
): (original: FeedPost, commentary?: string | null) => Promise<boolean> {
  const { runProtectedAction } = useActionGuard();

  return useCallback(
    async (original: FeedPost, commentary?: string | null) => {
      if (!supabase) return false;
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        alert("You must be logged in to reblog.");
        return false;
      }

      let succeeded = false;
      await runProtectedAction(supabase, { kind: "reblog" }, async () => {
        const { error } = await supabase.from("posts").insert({
          user_id: user.id,
          ...reblogInsertFields(original, { commentary }),
        });
        if (error) {
          console.error(error);
          await alertIfLikelyRateOrGuardFailure(supabase, error, { kind: "reblog" });
          return;
        }
        succeeded = true;
        await onSuccess();
      });
      return succeeded;
    },
    [supabase, onSuccess, runProtectedAction],
  );
}
