"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { displayUsername, formatRelativePostTime } from "@/lib/feed-post-display";
import {
  normalizePostBodyForDedup,
  recordSuccessfulUserWrittenPost,
  validateUserWrittenContent,
} from "@/lib/post-content-guard";
import { getProfileLinkSlug } from "@/lib/username";
import { fetchPostNotes, fetchPostNotesTotalCount } from "@/lib/supabase/fetch-post-notes";
import type { PostNote, PostNoteKind } from "@/types/post-note";
import { useActionGuard } from "./ActionGuardProvider";
import { InlineErrorBanner } from "./InlineErrorBanner";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";

const NOTES_FETCH_LIMIT = 50;
const NOTE_COMMENT_MAX_LEN = 500;

/** Compact follow control; primary for Follow, muted border for Following (matches profile intent, smaller). */
const FOLLOW_BTN_BASE =
  "shrink-0 rounded-md px-2 py-0.5 text-meta font-medium transition-[opacity,colors,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-45";

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  currentUserId: string | null;
  threadRootPostId: string;
  /** Applied to the PostCard Notes badge (+1 / -1) without refetching the feed. */
  onThreadNoteCountDelta?: (delta: number) => void;
};

const DELETE_NOTE_BTN =
  "shrink-0 rounded-md px-2 py-0.5 text-meta font-medium text-text-muted transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-45";

function noteActionPhrase(note: PostNote): string {
  if (note.kind === "like") return "liked this";
  if (note.kind === "comment") return "left a note";
  if (note.has_commentary) return "reblogged with commentary";
  return "reblogged this";
}

function rowKindLabel(kind: PostNoteKind): string {
  if (kind === "like") return "Like";
  if (kind === "reblog") return "Reblog";
  return "Note";
}

function rowKindAccent(kind: PostNoteKind): string {
  if (kind === "like") return "bg-rose-500/85";
  if (kind === "reblog") return "bg-emerald-500/80";
  return "bg-sky-500/80";
}

function groupKey(note: PostNote): "reblog" | "like" | "comment" {
  if (note.kind === "comment") return "comment";
  if (note.kind === "reblog") return "reblog";
  return "like";
}

function groupHeading(key: "reblog" | "like" | "comment"): string {
  if (key === "reblog") return "Reblogs";
  if (key === "like") return "Likes";
  return "Notes & replies";
}

function NotesLoadingSkeleton() {
  return (
    <div className="mb-4 space-y-3" role="status" aria-busy="true" aria-label="Loading notes">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse gap-2.5 rounded-xl px-2 py-2">
          <div className="h-9 w-9 shrink-0 rounded-full bg-bg-secondary ring-1 ring-border/40" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <div className="h-3.5 max-w-[14rem] rounded bg-bg-secondary" />
            <div className="h-3 max-w-[9rem] rounded bg-bg-secondary/80" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PostNotesModal({
  open,
  onClose,
  supabase,
  currentUserId,
  threadRootPostId,
  onThreadNoteCountDelta,
}: Props) {
  const { runProtectedAction } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<PostNote[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [likeCount, setLikeCount] = useState<number | null>(null);
  const [reblogCount, setReblogCount] = useState<number | null>(null);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [followedIdSet, setFollowedIdSet] = useState<Set<string>>(() => new Set());
  const [followPendingIds, setFollowPendingIds] = useState<Set<string>>(() => new Set());
  const followPendingRef = useRef<Set<string>>(new Set());

  const [composerText, setComposerText] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const loadNotes = useCallback(
    async (opts?: { silent?: boolean; isCancelled?: () => boolean }) => {
      const silent = Boolean(opts?.silent);
      const isCancelled = opts?.isCancelled;

      if (!supabase) {
        if (!isCancelled?.()) setError("Notes are unavailable right now.");
        if (!silent) setLoading(false);
        return;
      }
      const root = threadRootPostId?.trim();
      if (!root) {
        if (!isCancelled?.()) setError("Could not resolve this thread.");
        if (!silent) setLoading(false);
        return;
      }

      if (!silent) {
        setLoading(true);
        setError(null);
        setNotes([]);
        setTotal(null);
        setLikeCount(null);
        setReblogCount(null);
        setCommentCount(null);
        setFollowedIdSet(new Set());
      }

      const notesPromise = fetchPostNotes(supabase, { threadRootPostId: root, limit: NOTES_FETCH_LIMIT });
      const totalsPromise = fetchPostNotesTotalCount(supabase, root);
      const followsPromise =
        currentUserId && currentUserId.trim().length > 0
          ? supabase.from("follows").select("following_id").eq("follower_id", currentUserId)
          : Promise.resolve({ data: [] as { following_id: string }[], error: null });

      const [notesRes, totalsRes, followsRes] = await Promise.all([notesPromise, totalsPromise, followsPromise]);

      if (isCancelled?.()) return;

      if (notesRes.error) {
        setError(notesRes.error.message);
        if (!silent) setLoading(false);
        return;
      }
      if (totalsRes.error) {
        setError(totalsRes.error.message);
        if (!silent) setLoading(false);
        return;
      }
      if (followsRes.error) {
        console.error(followsRes.error);
      }

      setNotes(notesRes.data ?? []);
      setTotal(totalsRes.total);
      setLikeCount(totalsRes.like_count);
      setReblogCount(totalsRes.reblog_count);
      setCommentCount(totalsRes.comment_count);
      if (!followsRes.error && Array.isArray(followsRes.data)) {
        setFollowedIdSet(new Set(followsRes.data.map((r) => r.following_id)));
      }
      if (!silent) setLoading(false);
    },
    [supabase, threadRootPostId, currentUserId],
  );

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setError(null);
      setNotes([]);
      setTotal(null);
      setLikeCount(null);
      setReblogCount(null);
      setCommentCount(null);
      setFollowedIdSet(new Set());
      setFollowPendingIds(new Set());
      followPendingRef.current.clear();
      setComposerText("");
      setComposerError(null);
      setComposerSubmitting(false);
      setDeleteError(null);
      setDeletingCommentId(null);
      return;
    }

    let cancelled = false;
    void loadNotes({ silent: false, isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [open, loadNotes]);

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

  const handleSubmitComment = useCallback(async () => {
    if (!supabase || !currentUserId) return;
    const root = threadRootPostId?.trim();
    if (!root) return;

    const trimmed = composerText.trim();
    if (trimmed.length > NOTE_COMMENT_MAX_LEN) {
      setComposerError(`Notes can be at most ${NOTE_COMMENT_MAX_LEN} characters.`);
      return;
    }

    const guard = validateUserWrittenContent(trimmed, { allowEmpty: false });
    if (!guard.ok) {
      setComposerError(guard.message);
      return;
    }

    setComposerError(null);
    setComposerSubmitting(true);
    try {
      await runProtectedAction(supabase, { kind: "note_comment" }, async () => {
        const { error: insErr } = await supabase.from("post_note_comments").insert({
          thread_root_post_id: root,
          user_id: currentUserId,
          body: trimmed,
        });
        if (insErr) {
          console.error(insErr);
          await alertIfLikelyRateOrGuardFailure(supabase, insErr, { kind: "note_comment" });
          return;
        }
        onThreadNoteCountDelta?.(1);
        recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(trimmed));
        setComposerText("");
        await loadNotes({ silent: true });
      });
    } finally {
      setComposerSubmitting(false);
    }
  }, [
    supabase,
    currentUserId,
    threadRootPostId,
    composerText,
    runProtectedAction,
    loadNotes,
    onThreadNoteCountDelta,
  ]);

  const handleDeleteOwnComment = useCallback(
    async (commentId: string) => {
      if (!supabase || !currentUserId || !commentId.trim()) return;
      setDeleteError(null);
      setDeletingCommentId(commentId);
      try {
        await runProtectedAction(supabase, { kind: "note_comment" }, async () => {
          const { error: delErr } = await supabase.from("post_note_comments").delete().eq("id", commentId);
          if (delErr) {
            console.error(delErr);
            await alertIfLikelyRateOrGuardFailure(supabase, delErr, { kind: "note_comment" });
            setDeleteError(delErr.message?.trim() ? delErr.message : "Could not remove that note.");
            return;
          }
          onThreadNoteCountDelta?.(-1);
          await loadNotes({ silent: true });
        });
      } finally {
        setDeletingCommentId(null);
      }
    },
    [supabase, currentUserId, runProtectedAction, loadNotes, onThreadNoteCountDelta],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const listBlocks = useMemo(() => {
    const blocks: { heading: string | null; note: PostNote }[] = [];
    let prev: "reblog" | "like" | "comment" | null = null;
    for (const note of notes) {
      const k = groupKey(note);
      const heading = prev === null || k !== prev ? groupHeading(k) : null;
      blocks.push({ heading, note });
      prev = k;
    }
    return blocks;
  }, [notes]);

  if (!open) return null;

  const summaryHeadline =
    total !== null ? (
      <p className="text-sm font-medium text-text">
        {total} {total === 1 ? "note" : "notes"}
      </p>
    ) : loading ? (
      <p className="text-sm font-medium text-text-muted">Gathering activity…</p>
    ) : null;

  const breakdown =
    likeCount !== null && reblogCount !== null && commentCount !== null ? (
      <p className="mt-0.5 text-meta text-text-muted">
        {likeCount} {likeCount === 1 ? "like" : "likes"} · {reblogCount} {reblogCount === 1 ? "reblog" : "reblogs"} ·{" "}
        {commentCount} {commentCount === 1 ? "reply" : "replies"}
      </p>
    ) : null;

  const showEmpty = !loading && !error && notes.length === 0;
  const showList = !loading && notes.length > 0;

  return (
    <div className="qrtz-modal-overlay" onClick={() => onClose()} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-notes-title"
        onClick={(e) => e.stopPropagation()}
        className="qrtz-modal-panel max-w-md"
      >
        <h2 id="post-notes-title" className="mb-1 font-heading text-lg font-semibold text-text">
          Notes
        </h2>
        <p className="mb-3 text-meta leading-snug text-text-muted">
          Likes, reblogs, and short replies on this thread — same vibe as classic Tumblr notes, without full
          threading.
        </p>

        <div className="mb-3 rounded-card border border-border/60 bg-bg-secondary/25 px-3 py-2.5 dark:bg-bg-secondary/35">
          {summaryHeadline}
          {breakdown}
        </div>

        {error ? (
          <InlineErrorBanner message={error} onDismiss={() => setError(null)} className="mb-3" />
        ) : null}

        {deleteError ? (
          <InlineErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} className="mb-3" />
        ) : null}

        {loading ? <NotesLoadingSkeleton /> : null}

        {showEmpty ? (
          <div className="mb-4 rounded-card border border-dashed border-border/70 bg-bg-secondary/15 px-4 py-6 text-center dark:bg-bg-secondary/25">
            <p className="text-sm font-medium text-text">Quiet thread</p>
            <p className="mt-1.5 text-meta leading-relaxed text-text-muted">
              No likes or reblogs here yet. When people react, you will see them listed with a little context — like
              Tumblr notes, tuned for Qrtz.
            </p>
          </div>
        ) : null}

        {showList ? (
          <ul className="mb-4 max-h-[min(22rem,50vh)] list-none space-y-0 overflow-y-auto p-0 pr-0.5" role="list">
            {listBlocks.map(({ heading, note }) => {
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
              const isOwnComment =
                note.kind === "comment" &&
                Boolean(note.comment_id && currentUserId && note.user_id === currentUserId);
              const deleteBusy = Boolean(note.comment_id && deletingCommentId === note.comment_id);
              const rowKey =
                note.kind === "comment" && note.comment_id
                  ? `comment-${note.comment_id}`
                  : `${note.kind}-${note.post_id}-${note.user_id}-${note.acted_at}`;

              return (
                <li key={rowKey} className="list-none">
                  {heading ? (
                    <p className="mb-1.5 mt-3 first:mt-0 text-[0.7rem] font-semibold uppercase tracking-wide text-text-muted">
                      {heading}
                    </p>
                  ) : null}
                  <div
                    className="group flex gap-2.5 rounded-xl border border-transparent px-2 py-2 transition-[border-color,background-color,box-shadow] duration-150 hover:border-border/55 hover:bg-bg-secondary/35 hover:shadow-sm dark:hover:bg-bg-secondary/45"
                  >
                    <div
                      className={`mt-2 h-8 w-0.5 shrink-0 rounded-full ${rowKindAccent(note.kind)} opacity-90`}
                      aria-hidden
                    />
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
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={`rounded px-1 py-px text-[0.65rem] font-semibold uppercase tracking-wide ${
                            note.kind === "like"
                              ? "bg-rose-500/12 text-rose-700 dark:text-rose-300"
                              : note.kind === "reblog"
                                ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200"
                                : "bg-sky-500/12 text-sky-800 dark:text-sky-200"
                          }`}
                        >
                          {rowKindLabel(note.kind)}
                        </span>
                        <p className="min-w-0 text-sm leading-snug text-text">
                          <ProfileUsernameLink
                            usernameRaw={note.username}
                            className="font-semibold text-text hover:text-link"
                          >
                            {nameLabel}
                          </ProfileUsernameLink>{" "}
                          <span className="font-normal text-text-secondary">{noteActionPhrase(note)}</span>
                        </p>
                      </div>
                      {note.kind === "reblog" && note.commentary_preview ? (
                        <p className="mt-1.5 border-l-2 border-border/70 pl-2 text-sm leading-snug text-text-secondary">
                          {note.commentary_preview}
                        </p>
                      ) : null}
                      {note.kind === "comment" && note.body ? (
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-snug text-text">{note.body}</p>
                      ) : null}
                      <time
                        dateTime={note.acted_at}
                        title={t.full}
                        className="mt-1 block text-meta tabular-nums text-text-muted"
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
                    ) : isOwnComment && note.comment_id ? (
                      <button
                        type="button"
                        disabled={deleteBusy || !supabase}
                        onClick={() => void handleDeleteOwnComment(note.comment_id!)}
                        className={DELETE_NOTE_BTN}
                        aria-busy={deleteBusy}
                        aria-label="Remove your note"
                        title="Remove your note"
                      >
                        {deleteBusy ? "…" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mb-4 border-t border-border/80 pt-3">
          {currentUserId && supabase ? (
            <>
              <label htmlFor="post-note-comment" className="mb-1 block text-meta font-medium text-text-secondary">
                Add a short note
              </label>
              <textarea
                id="post-note-comment"
                rows={2}
                maxLength={NOTE_COMMENT_MAX_LEN}
                value={composerText}
                disabled={composerSubmitting || Boolean(loading)}
                onChange={(e) => {
                  setComposerText(e.target.value);
                  if (composerError) setComposerError(null);
                }}
                placeholder="Say something quick — this is not threaded comments."
                className="qrtz-field mb-2 w-full resize-none py-2 text-sm leading-snug"
              />
              <div className="mb-2 flex items-center justify-between gap-2 text-meta text-text-muted">
                <span>
                  {composerText.length}/{NOTE_COMMENT_MAX_LEN}
                </span>
                <button
                  type="button"
                  disabled={composerSubmitting || loading || !composerText.trim()}
                  onClick={() => void handleSubmitComment()}
                  className="qrtz-btn-primary px-3 py-1.5 text-sm disabled:pointer-events-none disabled:opacity-45"
                >
                  {composerSubmitting ? "Sending…" : "Post note"}
                </button>
              </div>
              <InlineErrorBanner message={composerError} onDismiss={() => setComposerError(null)} className="mb-0" />
            </>
          ) : (
            <p className="text-meta leading-relaxed text-text-muted">
              Sign in to leave a short note on this thread. Everyone who can see the post can read notes here.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="qrtz-btn-secondary px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
