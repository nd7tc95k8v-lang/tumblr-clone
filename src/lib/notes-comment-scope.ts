/**
 * Phase 1 — note **comment** read/count scope only (likes + reblogs stay thread-root everywhere).
 *
 * - **`thread`** (default): missing or any value other than `anchor` — shipped behavior.
 * - **`anchor`**: comment list/count use `note_anchor_post_id` / migration **035** anchor RPCs when
 *   `notesAnchorPostId` is present; falls back to thread-root if RPCs are missing.
 *
 * Legacy dev prototype (`NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE=1` + caller opt-in) remains
 * compatible and does not require `NODE_ENV === development` when `NEXT_PUBLIC_NOTES_COMMENT_SCOPE=anchor`.
 */

export type NotesCommentScope = "thread" | "anchor";

const ANCHOR_SCOPE_ENV = "anchor";

/** Parsed `NEXT_PUBLIC_NOTES_COMMENT_SCOPE`; invalid / absent → `thread`. */
export function notesCommentScopeFromEnv(): NotesCommentScope {
  const raw = process.env.NEXT_PUBLIC_NOTES_COMMENT_SCOPE?.trim().toLowerCase();
  return raw === ANCHOR_SCOPE_ENV ? "anchor" : "thread";
}

/** True when the explicit env flag selects authored-layer comment scope. */
export function isNotesCommentScopeAnchor(): boolean {
  return notesCommentScopeFromEnv() === "anchor";
}

export type AnchorScopedNoteCommentsParams = {
  notesAnchorPostId?: string | null;
  /** Legacy dev opt-in; ignored unless prototype env + development (see below). */
  prototypeAnchorScopedComments?: boolean;
};

/**
 * Whether note **comment** fetches should use anchor RPCs / `note_anchor_post_id`.
 * Likes and reblogs are unaffected — callers still use thread root for those paths.
 */
export function wantsAnchorScopedNoteComments(params: AnchorScopedNoteCommentsParams): boolean {
  const anchorKey = params.notesAnchorPostId?.trim() ?? "";
  if (!anchorKey.length) return false;

  if (isNotesCommentScopeAnchor()) return true;

  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.NEXT_PUBLIC_NOTES_ANCHOR_COMMENTS_PROTOTYPE !== "1") return false;
  return Boolean(params.prototypeAnchorScopedComments);
}
