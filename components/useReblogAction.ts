"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { buildOptimisticReblogFeedPost, reblogInsertFields } from "@/lib/reblog";
import type { FeedPost, PostAuthorEmbed } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";

export type UseReblogActionOptions = {
  /** Runs after a successful insert (e.g. reload the feed). */
  onSuccess: () => void | Promise<void>;
  /**
   * Called after insert with a client-built {@link FeedPost} (same id as the row when using a client UUID).
   * Use for optimistic feed updates; optional so other pages can ignore.
   */
  onOptimisticFeedPost?: (post: FeedPost) => void | Promise<void>;
  /** Current user’s author embed for the optimistic row header. */
  getViewerAuthor?: () => PostAuthorEmbed | null;
};

/**
 * Reblog flow: auth check → guarded insert via {@link reblogInsertFields} → optional reload.
 * Returns whether the reblog row was inserted (false if unauthenticated, blocked, or errored).
 */
export function useReblogAction(
  supabase: SupabaseClient | null,
  { onSuccess, onOptimisticFeedPost, getViewerAuthor }: UseReblogActionOptions,
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
        const newPostId = crypto.randomUUID();
        const { error } = await supabase.from("posts").insert({
          id: newPostId,
          user_id: user.id,
          ...reblogInsertFields(original, { commentary }),
        });
        if (error) {
          console.error(error);
          await alertIfLikelyRateOrGuardFailure(supabase, error, { kind: "reblog" });
          return;
        }
        succeeded = true;
        const optimistic = buildOptimisticReblogFeedPost({
          newId: newPostId,
          viewerUserId: user.id,
          viewerAuthor: getViewerAuthor?.() ?? null,
          source: original,
          commentary,
        });
        await onOptimisticFeedPost?.(optimistic);
        await onSuccess();
      });
      return succeeded;
    },
    [supabase, onSuccess, onOptimisticFeedPost, getViewerAuthor, runProtectedAction],
  );
}
