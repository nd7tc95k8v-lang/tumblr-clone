export type PostNoteKind = "like" | "reblog";

/**
 * One activity item in a thread-root “Notes” stream (likes + reblogs only for now).
 * `post_id` is the liked post id for likes (always the thread root) or the reblog row id for reblogs.
 */
export type PostNote = {
  kind: PostNoteKind;
  acted_at: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  post_id: string;
  root_post_id: string;
  /** Reblogs only: true when `reblog_commentary` is non-empty on that row. */
  has_commentary?: boolean;
};
