export type PostNoteKind = "like" | "reblog" | "comment";

/**
 * One activity item in a thread-root “Notes” stream (likes, reblogs, and flat note comments).
 * `post_id` is the liked post id for likes (always the thread root), the reblog row id for reblogs,
 * or the thread root for comments.
 *
 * **Modal scope:** likes/reblogs always use the chain thread root (`threadRootPostId`). **Comments:** thread-root
 * by default; `NEXT_PUBLIC_NOTES_COMMENT_SCOPE=anchor` reads anchor-scoped rows but still stamps `post_id` /
 * `root_post_id` = thread root in merged `PostNote` (Phase 1 — see `fetch-post-notes.ts`).
 */
export type PostNote = {
  kind: PostNoteKind;
  acted_at: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  post_id: string;
  /** Chain thread root for this note row (aligned with `PostNotesModal`’s `threadRootPostId` today). */
  root_post_id: string;
  /** Reblogs only: true when `reblog_commentary` is non-empty on that row. */
  has_commentary?: boolean;
  /** Reblogs with commentary: short preview for the notes row. */
  commentary_preview?: string | null;
  /** Comments only: full body (short, DB-capped). */
  body?: string | null;
  /** Comments only: row id for keys and optional future delete. */
  comment_id?: string | null;
};
