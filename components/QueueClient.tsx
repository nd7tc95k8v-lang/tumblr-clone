"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { formatPostTime, formatRelativePostTime } from "@/lib/feed-post-display";
import {
  normalizePostBodyForDedup,
  recordSuccessfulUserWrittenPost,
} from "@/lib/post-content-guard";
import {
  isQueuePublishCleanupFailure,
  publishQueueItem,
  validateQueueItemForPublish,
} from "@/lib/queue/publish-queue-item";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchQueueItems } from "@/lib/supabase/fetch-queue";
import { fetchFeedPostById } from "@/lib/supabase/fetch-feed-posts";
import { resetStaleQueuePublishing } from "@/lib/supabase/queue-claim";
import { deleteQueueItemWithImages, reorderQueueItems } from "@/lib/supabase/queue-images";
import type { PostQueueItem, QueueStatus } from "@/types/queue";
import { useActionGuard } from "./ActionGuardProvider";
import { InlineErrorBanner } from "./InlineErrorBanner";

/** Must match `ComposeClient` / `HomeClient` — sessionStorage handoff for optimistic feed merge. */
const PENDING_FEED_POST_STORAGE_KEY = "qrtz:pendingFeedPost";

const LIST_WRAP = "rounded-2xl bg-bg-secondary/20 p-0.5 sm:p-1.5 dark:bg-bg-secondary/30";

function queuePreviewLabel(item: PostQueueItem): string {
  const text = item.content.trim();
  const imageCount = item.post_queue_images?.length ?? 0;
  if (text) {
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  if (imageCount > 0) return "Image queued post";
  return "Untitled queued post";
}

function queuePreviewIsPlaceholder(item: PostQueueItem): boolean {
  return item.content.trim().length === 0;
}

function queueScheduleLabel(item: PostQueueItem): string {
  if (item.scheduled_for?.trim()) {
    return `Scheduled ${formatPostTime(item.scheduled_for)}`;
  }
  return "Queued";
}

function queueStatusLabel(status: QueueStatus): string | null {
  if (status === "queued") return null;
  if (status === "publishing") return "Publishing";
  return "Failed";
}

function canShowPublishNow(item: PostQueueItem): boolean {
  if (item.status === "publishing") return false;
  if (isQueuePublishCleanupFailure(item)) return false;
  return true;
}

export default function QueueClient() {
  const router = useRouter();
  const { runProtectedAction } = useActionGuard();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [items, setItems] = useState<PostQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const refreshSession = useCallback(async () => {
    if (!supabase) {
      setUser(null);
      setSessionReady(true);
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setUser(session?.user ?? null);
    setSessionReady(true);
  }, [supabase]);

  const loadQueue = useCallback(async () => {
    if (!supabase || !user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const staleResult = await resetStaleQueuePublishing(supabase, 15);
      if (staleResult.error) {
        console.error("Queue stale publishing reset failed", staleResult.error);
      }

      const { data, error } = await fetchQueueItems(supabase, user.id);
      if (error) {
        setLoadError(error.message);
        setItems([]);
        return;
      }
      setItems(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => {
    void refreshSession();
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase, refreshSession]);

  useEffect(() => {
    if (!sessionReady) return;
    void loadQueue();
  }, [sessionReady, loadQueue]);

  const handleDelete = useCallback(
    async (item: PostQueueItem) => {
      if (!supabase) return;
      if (publishingId !== null) return;
      const ok = window.confirm("Remove this item from your queue? This cannot be undone.");
      if (!ok) return;

      setActionError(null);
      setDeletingId(item.id);
      try {
        const result = await deleteQueueItemWithImages(supabase, { queueId: item.id });
        if (result.error) {
          setActionError(result.error.message || "Could not delete queue item.");
          return;
        }
        if (!result.deleted) {
          setActionError("Queue item not found or already deleted.");
          return;
        }
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        if (result.storageCleanupFailed) {
          setStorageWarning(
            "Queue item deleted, but some image files may still need cleanup. You can retry later or ignore if storage is already clear.",
          );
        }
      } finally {
        setDeletingId(null);
      }
    },
    [supabase, publishingId],
  );

  const handleMove = useCallback(
    async (index: number, direction: "up" | "down") => {
      if (!supabase || !user || reordering || deletingId !== null || publishingId !== null) return;

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= items.length) return;

      const previous = items;
      const next = [...items];
      [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
      setItems(next);
      setActionError(null);
      setReordering(true);

      try {
        const result = await reorderQueueItems(supabase, {
          userId: user.id,
          orderedQueueIds: next.map((row) => row.id),
        });
        if (result.error) {
          setItems(previous);
          setActionError(result.error.message || "Could not reorder queue.");
          return;
        }
        if (result.data) {
          setItems(result.data);
        }
      } finally {
        setReordering(false);
      }
    },
    [supabase, user, items, reordering, deletingId, publishingId],
  );

  const handlePublish = useCallback(
    async (item: PostQueueItem) => {
      if (!supabase || !user || publishingId !== null || deletingId !== null || reordering) return;
      if (!canShowPublishNow(item)) return;

      const validation = validateQueueItemForPublish(item);
      if (!validation.ok) {
        setActionError(validation.error);
        return;
      }

      const ok = window.confirm(
        "Publish now? This posts immediately and removes the item from your queue.",
      );
      if (!ok) return;

      setActionError(null);
      setPublishingId(item.id);

      try {
        await runProtectedAction(supabase, { kind: "post" }, async () => {
          setItems((prev) =>
            prev.map((row) =>
              row.id === item.id ? { ...row, status: "publishing" as const, last_error: null } : row,
            ),
          );

          const result = await publishQueueItem({
            supabase,
            queueId: item.id,
            userId: user.id,
          });

          if (!result.ok) {
            setActionError(result.error);
            await loadQueue();
            return;
          }

          recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(validation.trimmedContent));

          setItems((prev) => prev.filter((row) => row.id !== item.id));

          const { data: post } = await fetchFeedPostById(supabase, result.postId, user.id);
          if (post) {
            try {
              sessionStorage.setItem(PENDING_FEED_POST_STORAGE_KEY, JSON.stringify(post));
            } catch {
              /* storage full or disabled */
            }
          }

          router.push("/");
        });
      } finally {
        setPublishingId(null);
      }
    },
    [
      supabase,
      user,
      publishingId,
      deletingId,
      reordering,
      runProtectedAction,
      router,
      loadQueue,
    ],
  );

  if (!supabase) {
    return (
      <div className="qrtz-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="font-medium">Supabase is not configured</p>
        <p className="mt-1 text-meta text-text-secondary">
          Add publishable env vars to <code className="qrtz-code-inline">.env.local</code>.
        </p>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="qrtz-card px-4 py-8 text-center text-meta text-text-muted" aria-busy="true">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-6 text-center">
        <h1 className="text-xl font-semibold text-text">Queue</h1>
        <p className="text-sm text-text-secondary">Sign in to view your queue.</p>
        <Link href="/" className="qrtz-btn-primary mx-auto mt-1 inline-block px-4 py-2 text-sm">
          Back to Home
        </Link>
      </div>
    );
  }

  const count = items.length;
  const countLabel = count === 1 ? "1 queued post" : `${count} queued posts`;
  const actionsBusy = reordering || deletingId !== null || publishingId !== null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 px-3 sm:px-0">
        <h1 className="text-2xl font-bold text-text md:text-3xl">Queue</h1>
        <p className="text-sm text-text-secondary">{loading ? "Loading…" : countLabel}</p>
        {!loading && count > 0 ? (
          <p className="text-meta leading-snug text-text-muted">
            Publish now posts immediately and removes the item from your queue.
          </p>
        ) : null}
      </header>

      <InlineErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />
      <InlineErrorBanner message={actionError} onDismiss={() => setActionError(null)} />

      {storageWarning ? (
        <div
          role="status"
          className="flex items-start justify-between gap-2 rounded-card border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
        >
          <p className="min-w-0 flex-1 leading-snug text-text-secondary">{storageWarning}</p>
          <button
            type="button"
            onClick={() => setStorageWarning(null)}
            className="shrink-0 rounded px-1.5 py-0.5 text-meta font-medium text-text-muted transition-colors hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning/50"
            aria-label="Dismiss warning"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2 px-1" role="status" aria-label="Loading queue">
          {[0, 1, 2].map((i) => (
            <div key={i} className="qrtz-card animate-pulse px-4 py-4">
              <div className="h-4 w-2/3 max-w-xs rounded bg-bg-secondary" />
              <div className="mt-2 h-3 w-1/3 max-w-[8rem] rounded bg-bg-secondary/80" />
            </div>
          ))}
        </div>
      ) : count === 0 ? (
        <div className="rounded-xl border border-border/60 bg-bg-secondary/25 px-5 py-10 text-center">
          <p className="text-sm font-medium text-text">Your queue is empty.</p>
          <p className="mt-2 text-sm text-text-secondary">
            Add posts from Compose using Add to queue.
          </p>
          <Link href="/compose" className="qrtz-btn-primary mt-4 inline-block px-4 py-2 text-sm">
            Go to Compose
          </Link>
        </div>
      ) : (
        <ul className={`flex list-none flex-col gap-2 p-0 ${LIST_WRAP}`}>
          {items.map((item, index) => {
            const imageCount = item.post_queue_images?.length ?? 0;
            const tags = item.tags.filter(Boolean);
            const time = formatRelativePostTime(item.updated_at || item.created_at);
            const preview = queuePreviewLabel(item);
            const isPlaceholder = queuePreviewIsPlaceholder(item);
            const statusLabel = queueStatusLabel(item.status);
            const scheduleLabel = queueScheduleLabel(item);
            const positionLabel = index + 1;

            return (
              <li key={item.id}>
                <article className="qrtz-card flex flex-col gap-3 px-4 py-4 max-md:px-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-meta font-semibold tabular-nums text-text-secondary ring-1 ring-border/50"
                      aria-label={`Queue position ${positionLabel}`}
                    >
                      {positionLabel}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm leading-relaxed ${
                          isPlaceholder ? "font-medium italic text-text-secondary" : "text-text"
                        }`}
                      >
                        {preview}
                      </p>
                      {tags.length > 0 ? (
                        <p className="mt-2 text-meta text-text-muted">{tags.map((t) => `#${t}`).join(" · ")}</p>
                      ) : null}
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-text-muted">
                        <span>{scheduleLabel}</span>
                        {statusLabel ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className={item.status === "failed" ? "text-warning" : "text-text-secondary"}>
                              {statusLabel}
                            </span>
                          </>
                        ) : null}
                        <span aria-hidden>·</span>
                        <time dateTime={item.updated_at || item.created_at} title={time.full}>
                          Updated {time.label}
                        </time>
                        {imageCount > 0 ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>
                              {imageCount} {imageCount === 1 ? "image" : "images"}
                            </span>
                          </>
                        ) : null}
                        {item.is_nsfw ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="text-warning">Mature</span>
                          </>
                        ) : null}
                      </p>
                      {item.last_error?.trim() ? (
                        <p className="mt-2 text-meta leading-snug text-warning">{item.last_error.trim()}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={actionsBusy || index === 0}
                        onClick={() => void handleMove(index, "up")}
                        className="qrtz-btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-50"
                        aria-label={`Move queue item ${positionLabel} up`}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        disabled={actionsBusy || index === items.length - 1}
                        onClick={() => void handleMove(index, "down")}
                        className="qrtz-btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-50"
                        aria-label={`Move queue item ${positionLabel} down`}
                      >
                        Down
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canShowPublishNow(item) ? (
                        <button
                          type="button"
                          disabled={actionsBusy}
                          onClick={() => void handlePublish(item)}
                          className="qrtz-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                          aria-busy={publishingId === item.id}
                        >
                          {publishingId === item.id ? "Publishing…" : "Publish now"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={actionsBusy}
                        onClick={() => void handleDelete(item)}
                        className="qrtz-btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                        aria-busy={deletingId === item.id}
                      >
                        {deletingId === item.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
