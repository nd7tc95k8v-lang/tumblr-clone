"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLikelyRateOrGuardFailureMessage } from "@/lib/action-guard/resolve-rate-or-guard-failure";
import { publishReblogPost } from "@/lib/compose";
import { buildOptimisticReblogFeedPost } from "@/lib/reblog";
import type { FeedPost, PostAuthorEmbed } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";

const MAX_POST_IMAGES = 10;

export const REBLOG_AUTH_REQUIRED_MESSAGE = "You must be logged in to reblog.";

export type ReblogActionInvokeOptions = {
  onError?: (message: string) => void;
};

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
  /** Fallback when callers omit per-invoke {@link ReblogActionInvokeOptions.onError}. */
  onError?: (message: string) => void;
};

export type ReblogActionHandler = (
  original: FeedPost,
  commentary?: string | null,
  tags?: string[],
  /** Editor reblog only; ignored when `commentary === null` (Quick). */
  editorMarksMature?: boolean,
  /** Editor reblog only; ignored when `commentary === null` (Quick). */
  images?: File[],
  invokeOpts?: ReblogActionInvokeOptions,
) => Promise<boolean>;

/**
 * Reblog flow: auth check → guarded insert via {@link reblogInsertFields} → optional image uploads → optional reload.
 * Returns whether the reblog completed (false if unauthenticated, blocked, or errored).
 */
export function useReblogAction(
  supabase: SupabaseClient | null,
  { onSuccess, onOptimisticFeedPost, getViewerAuthor, onError }: UseReblogActionOptions,
): ReblogActionHandler {
  const { runProtectedAction } = useActionGuard();

  return useCallback(
    async (
      original,
      commentary,
      tags,
      editorMarksMature,
      images,
      invokeOpts,
    ) => {
      const reportError = (message: string) => {
        const handler = invokeOpts?.onError ?? onError;
        handler?.(message);
      };

      if (!supabase) return false;
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        reportError(REBLOG_AUTH_REQUIRED_MESSAGE);
        return false;
      }

      const reblogTags = tags ?? [];
      const isQuickReblog = commentary === null;

      let succeeded = false;
      await runProtectedAction(supabase, { kind: "reblog" }, async () => {
        const newPostId = crypto.randomUUID();
        if (process.env.NODE_ENV === "development") {
          console.log("[reblog-action-entry]", {
            originalId: original.id,
            newPostId,
            isQuickReblog,
            rawImagesLength: images?.length ?? 0,
            attachImagesLength: !isQuickReblog ? (images ?? []).slice(0, MAX_POST_IMAGES).length : 0,
            commentary,
            tagsLength: reblogTags.length,
          });
        }

        const result = await publishReblogPost({
          supabase,
          userId: user.id,
          source: original,
          postId: newPostId,
          commentary,
          tags: reblogTags,
          editorMarksMature,
          imageFiles: images,
        });

        if (!result.ok) {
          if (result.stage === "post_insert") {
            reportError(await resolveLikelyRateOrGuardFailureMessage(supabase, result.error, { kind: "reblog" }));
          } else {
            reportError(result.message.trim() || "Could not attach photos to this reblog.");
          }
          return;
        }

        succeeded = true;
        const optimistic = buildOptimisticReblogFeedPost({
          newId: result.postId,
          viewerUserId: user.id,
          viewerAuthor: getViewerAuthor?.() ?? null,
          source: original,
          commentary,
          tags: reblogTags,
          editorMarksMature: commentary === null ? undefined : editorMarksMature,
          attachedImageStoragePaths: result.attachedImageStoragePaths
            ? [...result.attachedImageStoragePaths]
            : undefined,
        });
        await onOptimisticFeedPost?.(optimistic);
        await onSuccess();
      });
      return succeeded;
    },
    [supabase, onSuccess, onOptimisticFeedPost, getViewerAuthor, onError, runProtectedAction],
  );
}
