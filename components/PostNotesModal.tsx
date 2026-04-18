"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { displayUsername, formatRelativePostTime } from "@/lib/feed-post-display";
import { getProfileLinkSlug } from "@/lib/username";
import { fetchPostNotes, fetchPostNotesTotalCount } from "@/lib/supabase/fetch-post-notes";
import type { PostNote } from "@/types/post-note";
import { useActionGuard } from "./ActionGuardProvider";
import { InlineErrorBanner } from "./InlineErrorBanner";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";

const NOTES_FETCH_LIMIT = 50;

/** Compact follow control; primary for Follow, muted border for Following (matches profile intent, smaller). */
const FOLLOW_BTN_BASE =
  "shrink-0 rounded-md px-2 py-0.5 text-meta font-medium transition-[opacity,colors,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-45";

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  currentUserId: string | null;
  threadRootPostId: string;
};

function noteActionPhrase(note: PostNote): string {
  if (note.kind === "like") return "liked this";
  if (note.has_commentary) return "reblogged with commentary";
  return "reblogged this";
}

export default function PostNotesModal({
  open,
  onClose,
  supabase,
  currentUserId,
  threadRootPostId,
}: Props) {
  const { runProtectedAction } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<PostNote[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [likeCount, setLikeCount] = useState<number | null>(null);
  const [reblogCount, setReblogCount] = useState<number | null>(null);
  const [followedIdSet, setFollowedIdSet] = useState<Set<string>>(() => new Set());
  const [followPendingIds, setFollowPendingIds] = useState<Set<string>>(() => new Set());
  const followPendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setError(null);
      setNotes([]);
      setTotal(null);
      setLikeCount(null);
      setReblogCount(null);
      setFollowedIdSet(new Set());
      setFollowPendingIds(new Set());
      followPendingRef.current.clear();
      return;
    }

    if (!supabase) {
      setError("Notes are unavailable right now.");
      return;
    }

    const root = threadRootPostId?.trim();
    if (!root) {
      setError("Could not resolve this thread.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotes([]);
    setTotal(null);
    setLikeCount(null);
    setReblogCount(null);
    setFollowedIdSet(new Set());

    void (async () => {
      const notesPromise = fetchPostNotes(supabase, { threadRootPostId: root, limit: NOTES_FETCH_LIMIT });
      const totalsPromise = fetchPostNotesTotalCount(supabase, root);
      const followsPromise =
        currentUserId && currentUserId.trim().length > 0
          ? supabase.from("follows").select("following_id").eq("follower_id", currentUserId)
          : Promise.resolve({ data: [] as { following_id: string }[], error: null });

      const [notesRes, totalsRes, followsRes] = await Promise.all([notesPromise, totalsPromise, followsPromise]);

      if (cancelled) return;

      if (notesRes.error) {
        setError(notesRes.error.message);
        setLoading(false);
        return;
      }
      if (totalsRes.error) {
        setError(totalsRes.error.message);
        setLoading(false);
        return;
      }
      if (followsRes.error) {
        console.error(followsRes.error);
      }

      setNotes(notesRes.data ?? []);
      setTotal(totalsRes.total);
      setLikeCount(totalsRes.like_count);
      setReblogCount(totalsRes.reblog_count);
      if (!followsRes.error && Array.isArray(followsRes.data)) {
        setFollowedIdSet(new Set(followsRes.data.map((r) => r.following_id)));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, supabase, threadRootPostId, currentUserId]);

  const handleFollowToggle = useCallback(
    async (targetUserId: string, isFollowing: boolean) => {
      if (!supabase || !currentUserId || targetUserId === currentUserId) return;
      if (followPendingRef.current.has(targetUserId)) return;

      followPendingRef.current.add(targetUserId);
      setFollowPendingIds((prev) => new Set(prev).add(targetUserId));

      try {
        if (isFollowing) {
          const { error: delErr } = await supabase
            .from("follows")
            .delete()
            .eq("follower_id", currentUserId)
            .eq("following_id", targetUserId);
          if (delErr) {
            console.error(delErr);
          } else {
            setFollowedIdSet((prev) => {
              const next = new Set(prev);
              next.delete(targetUserId);
              return next;
            });
          }
        } else {
          await runProtectedAction(supabase, { kind: "follow", followMode: "insert" }, async () => {
            const { error: insErr } = await supabase.from("follows").insert({
              follower_id: currentUserId,
              following_id: targetUserId,
            });
            if (insErr) {
              console.error(insErr);
              await alertIfLikelyRateOrGuardFailure(supabase, insErr, { kind: "follow", followMode: "insert" });
              return;
            }
            setFollowedIdSet((prev) => new Set(prev).add(targetUserId));
          });
        }
      } finally {
        followPendingRef.current.delete(targetUserId);
        setFollowPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(targetUserId);
          return next;
        });
      }
    },
    [supabase, currentUserId, runProtectedAction],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const summaryHeadline =
    total !== null ? (
      <p className="text-sm font-medium text-text">
        {total} {total === 1 ? "note" : "notes"}
      </p>
    ) : loading ? (
      <p className="text-sm font-medium text-text-muted">…</p>
    ) : null;

  const breakdown =
    likeCount !== null && reblogCount !== null ? (
      <p className="mt-0.5 text-meta text-text-muted">
        {likeCount} {likeCount === 1 ? "like" : "likes"} · {reblogCount}{" "}
        {reblogCount === 1 ? "reblog" : "reblogs"}
      </p>
    ) : null;

  return (
    <div className="qrtz-modal-overlay" onClick={() => onClose()} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-notes-title"
        onClick={(e) => e.stopPropagation()}
        className="qrtz-modal-panel max-w-md"
      >
        <h2 id="post-notes-title" className="mb-2 font-heading text-lg font-semibold text-text">
          Notes
        </h2>

        <div className="mb-3 border-b border-border pb-3">
          {summaryHeadline}
          {breakdown}
        </div>

        {error ? (
          <InlineErrorBanner message={error} onDismiss={() => setError(null)} className="mb-3" />
        ) : null}

        {loading ? (
          <p className="mb-4 text-meta text-text-muted" role="status" aria-live="polite">
            Loading notes…
          </p>
        ) : null}

        {!loading && !error && notes.length === 0 ? (
          <p className="mb-4 text-sm text-text-secondary">No notes on this post yet.</p>
        ) : null}

        {!loading && notes.length > 0 ? (
          <ul className="mb-4 max-h-[min(24rem,55vh)] list-none space-y-2.5 overflow-y-auto p-0" role="list">
            {notes.map((note) => {
              const display = displayUsername(note.username);
              const slug = getProfileLinkSlug(note.username);
              const nameLabel = display === "Unknown" ? display : `@${display}`;
              const t = formatRelativePostTime(note.acted_at);
              const avatar = (
                <ProfileAvatar
                  url={note.avatar_url}
                  label={display}
                  size="sm"
                  className="mt-0.5 ring-border/60"
                />
              );
              const showFollow =
                Boolean(currentUserId && supabase && note.user_id && note.user_id !== currentUserId);
              const isFollowing = followedIdSet.has(note.user_id);
              const followBusy = followPendingIds.has(note.user_id);

              return (
                <li key={`${note.kind}-${note.post_id}-${note.user_id}-${note.acted_at}`}>
                  <div className="flex gap-2.5 items-start">
                    {slug ? (
                      <Link
                        href={`/profile/${encodeURIComponent(slug)}`}
                        className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/60 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
                        aria-label={`${display} profile`}
                      >
                        {avatar}
                      </Link>
                    ) : (
                      avatar
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-text">
                        <ProfileUsernameLink
                          usernameRaw={note.username}
                          className="font-semibold text-text hover:text-link"
                        >
                          {nameLabel}
                        </ProfileUsernameLink>{" "}
                        <span className="font-normal text-text-secondary">{noteActionPhrase(note)}</span>
                      </p>
                      <time
                        dateTime={note.acted_at}
                        title={t.full}
                        className="mt-0.5 block text-meta tabular-nums text-text-muted"
                      >
                        {t.label}
                      </time>
                    </div>
                    {showFollow ? (
                      <button
                        type="button"
                        disabled={followBusy}
                        onClick={() => void handleFollowToggle(note.user_id, isFollowing)}
                        className={
                          isFollowing
                            ? `${FOLLOW_BTN_BASE} border border-border/80 bg-bg-secondary/60 text-text-secondary hover:border-border hover:bg-bg-secondary hover:text-text`
                            : `${FOLLOW_BTN_BASE} qrtz-btn-primary`
                        }
                        aria-busy={followBusy}
                        aria-label={isFollowing ? `Unfollow ${nameLabel}` : `Follow ${nameLabel}`}
                      >
                        {followBusy ? "…" : isFollowing ? "Following" : "Follow"}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="qrtz-btn-secondary px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
