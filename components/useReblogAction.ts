"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLikelyRateOrGuardFailureMessage } from "@/lib/action-guard/resolve-rate-or-guard-failure";
import { buildOptimisticReblogFeedPost, reblogInsertFields } from "@/lib/reblog";
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
      const attachImages = !isQuickReblog ? (images ?? []).slice(0, MAX_POST_IMAGES) : [];

      let succeeded = false;
      await runProtectedAction(supabase, { kind: "reblog" }, async () => {
        let attachedImageStoragePaths: string[] | undefined;
        const newPostId = crypto.randomUUID();
        if (process.env.NODE_ENV === "development") {
          console.log("[reblog-action-entry]", {
            originalId: original.id,
            newPostId,
            isQuickReblog,
            rawImagesLength: images?.length ?? 0,
            attachImagesLength: attachImages.length,
            commentary,
            tagsLength: reblogTags.length,
          });
        }
        const { error } = await supabase.from("posts").insert({
          id: newPostId,
          user_id: user.id,
          ...reblogInsertFields(original, {
            commentary,
            tags: reblogTags,
            editorMarksMature: commentary === null ? undefined : editorMarksMature,
          }),
        });
        if (error) {
          console.error(error);
          reportError(await resolveLikelyRateOrGuardFailureMessage(supabase, error, { kind: "reblog" }));
          return;
        }

        if (attachImages.length > 0) {
          const uploadedPaths: string[] = [];
          try {
            // `post_images_copy_for_reblog` copies the chain root gallery onto this row; those rows must be removed
            // before inserting uploader-owned paths. Plain client DELETE can match 0 rows when `posts` SELECT RLS hides
            // the author's own NSFW row from the EXISTS subcheck on `post_images_delete_own_post` — use RPC first
            // (migration 038 `clear_post_images_for_reblog_attachment`), then fall back to client delete.
            const { error: rpcErr } = await supabase.rpc("clear_post_images_for_reblog_attachment", {
              p_post_id: newPostId,
            });
            if (rpcErr) {
              const { error: delCopyErr } = await supabase.from("post_images").delete().eq("post_id", newPostId);
              if (delCopyErr) {
                console.error(delCopyErr);
                const m =
                  delCopyErr.message?.trim() || delCopyErr.code || "Could not prepare image attachments.";
                throw new Error(`Saving image records failed: ${m}`);
              }
            }
            for (const selectedFile of attachImages) {
              const rawExt = selectedFile.name.split(".").pop();
              const fileExt =
                rawExt && /^[a-z0-9]+$/i.test(rawExt) && rawExt.length <= 8 ? rawExt.toLowerCase() : "jpg";
              const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
              const { error: uploadError } = await supabase.storage.from("post-images").upload(filePath, selectedFile, {
                contentType: selectedFile.type || `image/${fileExt}`,
                upsert: false,
              });
              if (uploadError) {
                console.error(uploadError);
                const m = uploadError.message?.trim() || "Image upload failed.";
                throw new Error(`Image upload failed: ${m}`);
              }
              uploadedPaths.push(filePath);
            }

            const { error: piError } = await supabase.from("post_images").insert(
              uploadedPaths.map((storage_path, position) => ({
                post_id: newPostId,
                storage_path,
                position,
              })),
            );
            if (piError) {
              console.error(piError);
              const m = piError.message?.trim() || piError.code || "Could not save image attachments.";
              throw new Error(`Saving image records failed: ${m}`);
            }

            const { error: updError } = await supabase
              .from("posts")
              .update({ image_storage_path: uploadedPaths[0] })
              .eq("id", newPostId);
            if (updError) {
              console.error(updError);
              const m = updError.message?.trim() || updError.code || "Could not link primary image.";
              throw new Error(`Linking primary image failed: ${m}`);
            }
            attachedImageStoragePaths = uploadedPaths;
          } catch (err: unknown) {
            for (const p of uploadedPaths) {
              const { error: rmErr } = await supabase.storage.from("post-images").remove([p]);
              if (rmErr) console.error("Reblog images rollback: storage remove failed", rmErr);
            }
            const { error: delErr } = await supabase.from("posts").delete().eq("id", newPostId);
            if (delErr) console.error("Reblog images rollback: post delete failed", delErr);
            const msg =
              err instanceof Error && err.message.trim()
                ? err.message.trim()
                : "Could not attach photos to this reblog.";
            reportError(msg);
            return;
          }
        }

        succeeded = true;
        const optimistic = buildOptimisticReblogFeedPost({
          newId: newPostId,
          viewerUserId: user.id,
          viewerAuthor: getViewerAuthor?.() ?? null,
          source: original,
          commentary,
          tags: reblogTags,
          editorMarksMature: commentary === null ? undefined : editorMarksMature,
          attachedImageStoragePaths,
        });
        await onOptimisticFeedPost?.(optimistic);
        await onSuccess();
      });
      return succeeded;
    },
    [supabase, onSuccess, onOptimisticFeedPost, getViewerAuthor, onError, runProtectedAction],
  );
}
