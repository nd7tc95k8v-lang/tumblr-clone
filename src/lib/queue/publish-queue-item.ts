import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLikelyRateOrGuardFailureMessage } from "@/lib/action-guard/resolve-rate-or-guard-failure";
import { publishOriginalPost, type PublishImageSource } from "@/lib/compose";
import { validateUserWrittenContent } from "@/lib/post-content-guard";
import { deleteQueueItem } from "@/lib/supabase/delete-queue-item";
import { fetchQueueItemById } from "@/lib/supabase/fetch-queue";
import {
  claimQueueItemForPublish,
  QUEUE_CLAIM_UNAVAILABLE_MESSAGE,
} from "@/lib/supabase/queue-claim";
import { claimQueueItemForPublishWorker } from "@/lib/supabase/queue-scheduler";
import { saveQueueItem } from "@/lib/supabase/save-queue-item";
import type { PostQueueItem } from "@/types/queue";

export const QUEUE_PUBLISH_CLEANUP_FAILED_MESSAGE =
  "Post was published, but the queue item could not be removed. Delete this queue item before publishing again.";

export type PublishQueueItemMode = "user" | "worker";

export type PublishQueueItemInput = {
  supabase: SupabaseClient;
  queueId: string;
  userId: string;
  /** Default `user` (JWT claim RPC). Scheduler uses `worker` (service role RPC). */
  mode?: PublishQueueItemMode;
};

export type PublishQueueItemResult =
  | {
      ok: true;
      postId: string;
    }
  | {
      ok: false;
      error: string;
      cleanupFailed?: boolean;
      publishedPostId?: string;
    };

function buildQueueImageSources(item: PostQueueItem): PublishImageSource[] {
  return (item.post_queue_images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((image) => ({ kind: "storage_path" as const, storagePath: image.storage_path }));
}

/** Pre-flight validation shared by UI and publish service. */
export function validateQueueItemForPublish(
  item: PostQueueItem,
): { ok: true; trimmedContent: string; imageSources: PublishImageSource[] } | { ok: false; error: string } {
  const trimmedContent = item.content.trim();
  const imageSources = buildQueueImageSources(item);
  const hasImages = imageSources.length > 0;

  if (!trimmedContent && !hasImages) {
    return { ok: false, error: "Add some text or images before publishing." };
  }

  if (!(trimmedContent === "" && hasImages)) {
    const written = validateUserWrittenContent(trimmedContent, { allowEmpty: false });
    if (!written.ok) {
      return { ok: false, error: written.message };
    }
  }

  return { ok: true, trimmedContent, imageSources };
}

export function isQueuePublishCleanupFailure(item: PostQueueItem): boolean {
  return item.last_error?.trim() === QUEUE_PUBLISH_CLEANUP_FAILED_MESSAGE;
}

async function markQueueItemFailed(
  supabase: SupabaseClient,
  item: PostQueueItem,
  userId: string,
  message: string,
): Promise<void> {
  await saveQueueItem(supabase, {
    id: item.id,
    userId,
    content: item.content,
    tags: item.tags,
    isNsfw: item.is_nsfw,
    status: "failed",
    lastError: message,
  });
}

export async function publishQueueItem(input: PublishQueueItemInput): Promise<PublishQueueItemResult> {
  const queueId = input.queueId?.trim() ?? "";
  const userId = input.userId?.trim() ?? "";
  if (!queueId || !userId) {
    return { ok: false, error: "Missing queue item." };
  }

  const { data: item, error: fetchError } = await fetchQueueItemById(input.supabase, queueId, userId);
  if (fetchError) {
    return { ok: false, error: fetchError.message || "Could not load queue item." };
  }
  if (!item) {
    return { ok: false, error: "Queue item not found." };
  }

  const preClaimValidation = validateQueueItemForPublish(item);
  if (!preClaimValidation.ok) {
    return { ok: false, error: preClaimValidation.error };
  }

  const mode = input.mode ?? "user";
  const claimResult =
    mode === "worker"
      ? await claimQueueItemForPublishWorker(input.supabase, userId, queueId)
      : await claimQueueItemForPublish(input.supabase, queueId);

  if (claimResult.error) {
    return { ok: false, error: claimResult.error.message || "Could not claim queue item for publish." };
  }
  if (!claimResult.data) {
    return { ok: false, error: QUEUE_CLAIM_UNAVAILABLE_MESSAGE };
  }
  const claimed = claimResult.data;

  const { data: claimedItem, error: refetchError } = await fetchQueueItemById(input.supabase, queueId, userId);
  if (refetchError || !claimedItem) {
    const message = refetchError?.message || "Could not load queue item after claim.";
    await markQueueItemFailed(input.supabase, claimed, userId, message);
    return { ok: false, error: message };
  }

  const validation = validateQueueItemForPublish(claimedItem);
  if (!validation.ok) {
    await markQueueItemFailed(input.supabase, claimedItem, userId, validation.error);
    return { ok: false, error: validation.error };
  }

  const publishResult = await publishOriginalPost({
    supabase: input.supabase,
    userId,
    content: validation.trimmedContent,
    tags: claimedItem.tags,
    isNsfw: claimedItem.is_nsfw,
    imageSources: validation.imageSources,
  });

  if (!publishResult.ok) {
    const message =
      mode === "user" && publishResult.stage === "post_insert"
        ? await resolveLikelyRateOrGuardFailureMessage(input.supabase, publishResult.error, { kind: "post" })
        : publishResult.message;
    await markQueueItemFailed(input.supabase, claimedItem, userId, message);
    return { ok: false, error: message };
  }

  const deleteResult = await deleteQueueItem(input.supabase, queueId);
  if (deleteResult.error || !deleteResult.deleted) {
    console.error("Queue cleanup after publish failed", deleteResult.error);
    await markQueueItemFailed(input.supabase, claimedItem, userId, QUEUE_PUBLISH_CLEANUP_FAILED_MESSAGE);
    return {
      ok: false,
      error: QUEUE_PUBLISH_CLEANUP_FAILED_MESSAGE,
      cleanupFailed: true,
      publishedPostId: publishResult.postId,
    };
  }

  return { ok: true, postId: publishResult.postId };
}
