import type { SupabaseClient } from "@supabase/supabase-js";
import {
  advanceQueueSchedulerNextRun,
  initializeQueueSchedulerNextRun,
  resetStaleQueuePublishingWorker,
  selectDueQueueUsers,
  selectNextSchedulableQueueItem,
} from "@/lib/supabase/queue-scheduler";
import { publishQueueItem } from "./publish-queue-item";

export type QueueSchedulerUserOutcome =
  | "empty_advanced"
  | "published"
  | "publish_failed"
  | "dry_run_would_publish"
  | "skipped_error";

export type QueueSchedulerUserResult = {
  userId: string;
  queueId?: string;
  outcome: QueueSchedulerUserOutcome;
  postId?: string;
  error?: string;
};

export type RunQueueSchedulerTickOptions = {
  userLimit?: number;
  staleOlderThanMinutes?: number;
  dryRun?: boolean;
};

export type RunQueueSchedulerTickResult = {
  staleResetCount: number;
  usersProcessed: number;
  published: number;
  failed: number;
  skippedEmpty: number;
  errors: string[];
  userResults: QueueSchedulerUserResult[];
};

export async function runQueueSchedulerTick(
  supabase: SupabaseClient,
  options: RunQueueSchedulerTickOptions = {},
): Promise<RunQueueSchedulerTickResult> {
  const userLimit = options.userLimit ?? 50;
  const staleOlderThanMinutes = options.staleOlderThanMinutes ?? 15;
  const dryRun = Boolean(options.dryRun);

  const summary: RunQueueSchedulerTickResult = {
    staleResetCount: 0,
    usersProcessed: 0,
    published: 0,
    failed: 0,
    skippedEmpty: 0,
    errors: [],
    userResults: [],
  };

  const staleResult = await resetStaleQueuePublishingWorker(supabase, staleOlderThanMinutes);
  if (staleResult.error) {
    summary.errors.push(staleResult.error.message || "Stale publishing reset failed.");
  } else {
    summary.staleResetCount = staleResult.resetCount;
  }

  const dueResult = await selectDueQueueUsers(supabase, userLimit);
  if (dueResult.error) {
    summary.errors.push(dueResult.error.message || "Could not load due queue users.");
    return summary;
  }

  for (const dueUser of dueResult.data) {
    summary.usersProcessed += 1;
    const userId = dueUser.user_id;

    const initResult = await initializeQueueSchedulerNextRun(supabase, userId);
    if (initResult.error) {
      summary.errors.push(
        `User ${userId}: initialize queue_next_run_at failed: ${initResult.error.message}`,
      );
      summary.userResults.push({ userId, outcome: "skipped_error", error: initResult.error.message });
      continue;
    }

    const nextItemResult = await selectNextSchedulableQueueItem(supabase, userId);
    if (nextItemResult.error) {
      summary.errors.push(
        `User ${userId}: select next queue item failed: ${nextItemResult.error.message}`,
      );
      summary.userResults.push({ userId, outcome: "skipped_error", error: nextItemResult.error.message });
      continue;
    }

    if (!nextItemResult.data) {
      const advanceResult = await advanceQueueSchedulerNextRun(supabase, userId);
      if (advanceResult.error) {
        summary.errors.push(
          `User ${userId}: advance next run failed: ${advanceResult.error.message}`,
        );
        summary.userResults.push({ userId, outcome: "skipped_error", error: advanceResult.error.message });
        continue;
      }
      summary.skippedEmpty += 1;
      summary.userResults.push({ userId, outcome: "empty_advanced" });
      continue;
    }

    const queueId = nextItemResult.data.id;

    if (dryRun) {
      summary.userResults.push({ userId, queueId, outcome: "dry_run_would_publish" });
      continue;
    }

    const publishResult = await publishQueueItem({
      supabase,
      queueId,
      userId,
      mode: "worker",
    });

    const advanceResult = await advanceQueueSchedulerNextRun(supabase, userId);
    if (advanceResult.error) {
      summary.errors.push(`User ${userId}: advance next run failed: ${advanceResult.error.message}`);
    }

    if (publishResult.ok) {
      summary.published += 1;
      summary.userResults.push({
        userId,
        queueId,
        outcome: "published",
        postId: publishResult.postId,
      });
      continue;
    }

    summary.failed += 1;
    summary.userResults.push({
      userId,
      queueId,
      outcome: "publish_failed",
      error: publishResult.error,
    });
  }

  return summary;
}
