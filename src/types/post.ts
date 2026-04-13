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

/**
 * Immediate parent embedded under a quote reblog (`reblog_of` chain), built in app code.
 * Original/leaf posts use `quoted_post: null` on the feed row; each reblog points at its parent row.
 * The tree is fully loaded for the feed row; the UI may clamp how many nested levels are shown at once.
 */
export type QuotedPostNode = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  image_url?: string | null;
  reblog_of?: string | null;
  reblog_commentary?: string | null;
  tags: string[];
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
  quoted_post: QuotedPostNode | null;
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
  /** Total likes on the thread root (`original_post_id`), same value for every row in the thread. */
  like_count: number;
  /** Descendant reblogs for the chain root (`original_post_id`). */
  reblog_count: number;
  /** True when the viewer liked the thread root (`post_ids_liked_by_auth_user` on root ids). */
  liked_by_me: boolean;
  /** Normalized tag strings (lowercase, trimmed). */
  tags: string[];
  /** This post's author (posts.user_id → profiles). */
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
  /**
   * Chain root merged in app after a second query by `original_post_id`.
   * Null if the root row is missing.
   */
  original_post: EmbeddedPostWithAuthor | null;
  /**
   * Nested quote chain via `reblog_of` (immediate parent only per level).
   * Null for originals; truncated when the parent chain cycles or is missing.
   */
  quoted_post: QuotedPostNode | null;
};

/** PostgREST may return an embedded row as an object or a single-element array. */
export function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
