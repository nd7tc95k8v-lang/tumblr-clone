/** Embedded profile row on a post (from `profiles`). */
export type PostAuthorEmbed = {
  username: string | null;
  avatar_url?: string | null;
};

/** Post row + author (used for merged chain root). */
export type EmbeddedPostWithAuthor = {
  id: string;
  content: string;
  image_url?: string | null;
  user_id: string;
  tags?: string[] | null;
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
};

export type FeedPost = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  image_url?: string | null;
  reblog_of?: string | null;
  /** Optional note from the reblogger; only set when `reblog_of` is non-null. */
  reblog_commentary?: string | null;
  /** Root post id for this chain (equals `id` for originals). */
  original_post_id: string;
  /** Normalized tag strings (lowercase, trimmed). */
  tags: string[];
  /** This post's author (posts.user_id → profiles). */
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
  /**
   * Chain root merged in app after a second query by `original_post_id`.
   * Null if the root row is missing.
   */
  original_post: EmbeddedPostWithAuthor | null;
};

/** PostgREST may return an embedded row as an object or a single-element array. */
export function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
