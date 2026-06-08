"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { formatRelativePostTime } from "@/lib/feed-post-display";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { deleteDraftWithImages } from "@/lib/supabase/draft-images";
import { fetchDrafts } from "@/lib/supabase/fetch-drafts";
import type { PostDraft } from "@/types/draft";
import { InlineErrorBanner } from "./InlineErrorBanner";

const LIST_WRAP = "rounded-2xl bg-bg-secondary/20 p-0.5 sm:p-1.5 dark:bg-bg-secondary/30";

function draftPreviewLabel(draft: PostDraft): string {
  const text = draft.content.trim();
  const imageCount = draft.post_draft_images?.length ?? 0;
  if (text) {
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  if (imageCount > 0) return "Image draft";
  return "Untitled draft";
}

function draftPreviewIsPlaceholder(draft: PostDraft): boolean {
  return draft.content.trim().length === 0;
}

export default function DraftsClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [drafts, setDrafts] = useState<PostDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const loadDrafts = useCallback(async () => {
    if (!supabase || !user) {
      setDrafts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await fetchDrafts(supabase, user.id);
      if (error) {
        setLoadError(error.message);
        setDrafts([]);
        return;
      }
      setDrafts(data ?? []);
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
    void loadDrafts();
  }, [sessionReady, loadDrafts]);

  const handleDelete = useCallback(
    async (draft: PostDraft) => {
      if (!supabase) return;
      const ok = window.confirm("Delete this draft? This cannot be undone.");
      if (!ok) return;

      setActionError(null);
      setDeletingId(draft.id);
      try {
        const result = await deleteDraftWithImages(supabase, { draftId: draft.id });
        if (result.error) {
          setActionError(result.error.message || "Could not delete draft.");
          return;
        }
        if (!result.deleted) {
          setActionError("Draft not found or already deleted.");
          return;
        }
        setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
        if (result.storageCleanupFailed) {
          setStorageWarning(
            "Draft deleted, but some image files may still need cleanup. You can retry later or ignore if storage is already clear.",
          );
        }
      } finally {
        setDeletingId(null);
      }
    },
    [supabase],
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
        <h1 className="text-xl font-semibold text-text">Drafts</h1>
        <p className="text-sm text-text-secondary">Sign in to view your drafts.</p>
        <Link href="/" className="qrtz-btn-primary mx-auto mt-1 inline-block px-4 py-2 text-sm">
          Back to Home
        </Link>
      </div>
    );
  }

  const count = drafts.length;
  const countLabel = count === 1 ? "1 draft" : `${count} drafts`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1 px-3 sm:px-0">
        <h1 className="text-2xl font-bold text-text md:text-3xl">Drafts</h1>
        <p className="text-sm text-text-secondary">{loading ? "Loading…" : countLabel}</p>
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
        <div className="flex flex-col gap-2 px-1" role="status" aria-label="Loading drafts">
          {[0, 1, 2].map((i) => (
            <div key={i} className="qrtz-card animate-pulse px-4 py-4">
              <div className="h-4 w-2/3 max-w-xs rounded bg-bg-secondary" />
              <div className="mt-2 h-3 w-1/3 max-w-[8rem] rounded bg-bg-secondary/80" />
            </div>
          ))}
        </div>
      ) : count === 0 ? (
        <div className="rounded-xl border border-border/60 bg-bg-secondary/25 px-5 py-10 text-center">
          <p className="text-sm font-medium text-text">No drafts yet.</p>
          <p className="mt-2 text-sm text-text-secondary">Start writing and save a draft from Compose.</p>
          <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <Link href="/compose" className="qrtz-btn-primary inline-block px-4 py-2 text-sm">
              Go to Compose
            </Link>
            <Link href="/queue" className="text-meta font-medium text-link hover:text-link-hover hover:underline">
              View queue
            </Link>
          </div>
        </div>
      ) : (
        <ul className={`flex list-none flex-col gap-2 p-0 ${LIST_WRAP}`}>
          {drafts.map((draft) => {
            const imageCount = draft.post_draft_images?.length ?? 0;
            const tags = draft.tags.filter(Boolean);
            const time = formatRelativePostTime(draft.updated_at);
            const preview = draftPreviewLabel(draft);
            const isPlaceholder = draftPreviewIsPlaceholder(draft);

            return (
              <li key={draft.id}>
                <article className="qrtz-card flex flex-col gap-3 px-4 py-4 max-md:px-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm leading-relaxed ${
                          isPlaceholder ? "font-medium italic text-text-secondary" : "text-text"
                        }`}
                      >
                        {preview}
                      </p>
                      {tags.length > 0 ? (
                        <p className="mt-2 text-meta text-text-muted">
                          {tags.map((t) => `#${t}`).join(" · ")}
                        </p>
                      ) : null}
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-text-muted">
                        <time dateTime={draft.updated_at} title={time.full}>
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
                        {draft.is_nsfw ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="text-warning">Mature</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row">
                      <Link
                        href={`/compose?draft=${encodeURIComponent(draft.id)}`}
                        className="qrtz-btn-secondary px-3 py-1.5 text-center text-xs"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        disabled={deletingId !== null}
                        onClick={() => void handleDelete(draft)}
                        className="qrtz-btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                        aria-busy={deletingId === draft.id}
                      >
                        {deletingId === draft.id ? "Deleting…" : "Delete"}
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
