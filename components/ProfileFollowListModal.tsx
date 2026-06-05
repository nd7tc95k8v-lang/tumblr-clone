"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchProfileFollowList } from "@/lib/supabase/fetch-profile-follow-list";
import { getProfileLinkSlug } from "@/lib/username";
import type { FollowListCursor, FollowListEntry, FollowListKind } from "@/types/follows";
import { InlineErrorBanner } from "./InlineErrorBanner";
import ProfileAvatar from "./ProfileAvatar";

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  profileId: string;
  profileUsername: string;
  kind: FollowListKind;
  initialCount: number;
  /** When true, following empty state uses second-person copy. */
  isOwnProfile?: boolean;
};

function FollowListLoadingSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading list">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex animate-pulse gap-3 rounded-xl px-2 py-2">
          <div className="h-10 w-10 shrink-0 rounded-full bg-bg-secondary ring-1 ring-border/40" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-3.5 max-w-[10rem] rounded bg-bg-secondary" />
            <div className="h-3 max-w-[7rem] rounded bg-bg-secondary/80" />
          </div>
        </div>
      ))}
    </div>
  );
}

function emptyMessage(kind: FollowListKind, isOwnProfile: boolean, initialCount: number): string {
  if (kind === "followers") {
    return initialCount > 0
      ? "Followers exist, but none have a public profile link yet."
      : "No followers yet.";
  }
  if (initialCount > 0) {
    return "Following relationships exist, but none have a public profile link yet.";
  }
  return isOwnProfile ? "You're not following anyone yet." : "Not following anyone yet.";
}

function kindLabel(kind: FollowListKind): string {
  return kind === "followers" ? "Followers" : "Following";
}

function appendDedupeEntries(prev: FollowListEntry[], incoming: FollowListEntry[]): FollowListEntry[] {
  const seen = new Set(prev.map((e) => e.id));
  const out = [...prev];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export default function ProfileFollowListModal({
  open,
  onClose,
  supabase,
  profileId,
  profileUsername,
  kind,
  initialCount,
  isOwnProfile = false,
}: Props) {
  const titleId = useId();
  const [entries, setEntries] = useState<FollowListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<FollowListCursor | null>(null);
  const requestGenRef = useRef(0);

  const loadPage = useCallback(
    async (mode: "initial" | "more", requestGen: number) => {
      if (!supabase) {
        if (requestGenRef.current !== requestGen) return;
        setError("Lists are unavailable because Supabase is not configured.");
        return;
      }
      if (mode === "initial") {
        setLoading(true);
        setError(null);
        setEntries([]);
        cursorRef.current = null;
      } else {
        setLoadingMore(true);
        setError(null);
      }

      const { data, error: fetchError, hasMore: more, nextCursor } = await fetchProfileFollowList(
        supabase,
        {
          kind,
          profileId,
          cursor: mode === "more" ? cursorRef.current : null,
        },
      );

      if (requestGenRef.current !== requestGen) return;

      if (mode === "initial") setLoading(false);
      else setLoadingMore(false);

      if (fetchError) {
        setError(fetchError.message || "Could not load this list.");
        return;
      }

      const rows = data ?? [];
      setEntries((prev) => (mode === "more" ? appendDedupeEntries(prev, rows) : rows));
      setHasMore(more);
      cursorRef.current = nextCursor;
    },
    [supabase, kind, profileId],
  );

  useEffect(() => {
    if (!open) {
      requestGenRef.current += 1;
      setEntries([]);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      cursorRef.current = null;
      return;
    }
    const requestGen = ++requestGenRef.current;
    void loadPage("initial", requestGen);
  }, [open, kind, loadPage]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showEmpty = !loading && !error && entries.length === 0;
  const showList = !loading && entries.length > 0;
  const headline =
    initialCount === 1
      ? `1 ${kind === "followers" ? "follower" : "person followed"}`
      : `${initialCount} ${kind === "followers" ? "followers" : "following"}`;

  return (
    <div className="qrtz-modal-overlay" onClick={() => onClose()} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="qrtz-modal-panel flex max-h-[min(85dvh,32rem)] max-w-md flex-col"
      >
        <h2 id={titleId} className="mb-1 shrink-0 font-heading text-lg font-semibold text-text">
          {kindLabel(kind)}
        </h2>
        <p className="mb-3 shrink-0 text-meta text-text-muted">
          @{profileUsername} · {headline}
        </p>

        {error ? (
          <div className="mb-3 shrink-0 space-y-2">
            <InlineErrorBanner message={error} onDismiss={() => setError(null)} />
            <button
              type="button"
              onClick={() => void loadPage(entries.length === 0 ? "initial" : "more", requestGenRef.current)}
              className="qrtz-btn-secondary px-3 py-1.5 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {loading ? <FollowListLoadingSkeleton /> : null}

          {showEmpty ? (
            <div className="rounded-card border border-dashed border-border/70 bg-bg-secondary/15 px-4 py-6 text-center dark:bg-bg-secondary/25">
              <p className="text-sm font-medium text-text">{emptyMessage(kind, isOwnProfile, initialCount)}</p>
              {kind === "following" && isOwnProfile ? (
                <p className="mt-1.5 text-meta leading-relaxed text-text-muted">
                  Find people to follow on{" "}
                  <Link
                    href="/explore"
                    onClick={() => onClose()}
                    className="font-medium text-link transition-colors hover:text-link-hover hover:underline"
                  >
                    Explore
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          ) : null}

          {showList ? (
            <ul className="list-none space-y-0 p-0" role="list">
              {entries.map((entry) => {
                const slug = getProfileLinkSlug(entry.username);
                const display = entry.display_name?.trim() || `@${entry.username}`;
                const profileHref = slug ? `/profile/${encodeURIComponent(slug)}` : null;

                return (
                  <li key={entry.id} className="list-none">
                    {profileHref ? (
                      <Link
                        href={profileHref}
                        onClick={() => onClose()}
                        className="flex gap-3 rounded-xl border border-transparent px-2 py-2.5 transition-[border-color,background-color] duration-150 hover:border-border/55 hover:bg-bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
                      >
                        <ProfileAvatar
                          url={entry.avatar_url}
                          label={display}
                          size="sm"
                          className="shrink-0 ring-border/60"
                        />
                        <div className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-semibold text-text">{display}</p>
                          <p className="truncate text-meta text-text-muted">@{entry.username}</p>
                        </div>
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-2 py-2.5">
                        <ProfileAvatar url={entry.avatar_url} label={display} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text">{display}</p>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {hasMore && !loading && !error ? (
          <div className="mt-3 shrink-0 border-t border-border/50 pt-3">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadPage("more", requestGenRef.current)}
              className="qrtz-btn-secondary w-full px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
