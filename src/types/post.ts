/** Embedded profile row on a post (from `profiles`). */
export type PostAuthorEmbed = {
  username: string | null;
  avatar_url?: string | null;
};

/** Row from `post_images` (ordered gallery). */
export type PostImageRow = {
  id: string;
  post_id: string;
  storage_path: string;
  position: number;
  created_at?: string;
};

/** Post row + author (used for merged chain root). */
export type EmbeddedPostWithAuthor = {
  id: string;
  content: string;
  image_url?: string | null;
  /** Path in `post-images` bucket; signed URLs at display time when set. */
  image_storage_path?: string | null;
  /** Gallery rows when present; legacy posts may omit this. */
  post_images?: PostImageRow[] | null;
  user_id: string;
  tags?: string[] | null;
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
  is_nsfw?: boolean;
  /** Set when the author tombstoned this thread root; content and owner media are cleared. */
  deleted_at?: string | null;
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
  image_storage_path?: string | null;
  post_images?: PostImageRow[] | null;
  reblog_of?: string | null;
  reblog_commentary?: string | null;
  /** Inherited from DB; used for future mature-content UI. */
  is_nsfw?: boolean;
  tags: string[];
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
  quoted_post: QuotedPostNode | null;
  deleted_at?: string | null;
};

export type FeedPost = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  image_url?: string | null;
  /** Set for new uploads; reblogs copy parent path. */
  image_storage_path?: string | null;
  post_images?: PostImageRow[] | null;
  reblog_of?: string | null;
  /** Optional note from the reblogger; only set when `reblog_of` is non-null. */
  reblog_commentary?: string | null;
  /**
   * **Thread-root identity only** — the reblog-chain / thread-structure root (`posts.original_post_id` in the
   * DB sense; equals `id` for originals). Used for merged `original_post`, quote ancestry, and any query
   * keyed by chain root.
   *
   * This field is **not** the authored-layer engagement id; do not overload it for per-card likes/notes.
   * Hydration normalizes it via `threadRootPostId`. Which id batches engagement RPCs is separate —
   * see `attachFeedPostEngagement` / `engagementKeyForBatchAndMerge` in
   * `src/lib/supabase/feed-engagement.ts` (currently also thread-root for shipped behavior).
   */
  original_post_id: string;
  /**
   * **Authored-layer / per-card id** reserved for **future** Tumblr-style per-reblog (per-visible-card)
   * engagement: the post id that would own likes, note comments, and counts for this card when/if
   * product semantics match that model. Populated at hydrate from `noteOwnerPostIdForCard` in
   * `src/lib/feed-post-display.ts`.
   *
   * **Important:** intentionally **not** the same as `original_post_id` (thread root).
   * **Current shipped behavior:** likes, notes modals, and feed counts still key off the **thread root**;
   * this field is carried forward so a later RPC/DB migration can switch batching without renaming types.
   */
  card_engagement_owner_post_id: string;
  /** Mature content flag; enforced and inherited in DB (immutable once true). */
  is_nsfw: boolean;
  /** Tombstoned thread root: row kept for FKs; author content and owner media removed. */
  deleted_at?: string | null;
  /** Audit hint from DB: parent_chain | profile_default_posts_nsfw | author | none */
  nsfw_source?: string | null;
  /** Total likes on the thread root (`original_post_id`), same value for every row in the thread. */
  like_count: number;
  /** Descendant reblogs for the chain root (`original_post_id`). */
  reblog_count: number;
  /**
   * Flat note comment count for this card. **Default (shipped):** thread-root (`thread_root_post_id` =
   * chain root) — same value for every row in the thread. **Phase 1 (`NEXT_PUBLIC_NOTES_COMMENT_SCOPE=anchor`):**
   * per-authored-layer count via `note_anchor_post_id` / `card_engagement_owner_post_id` when RPCs exist;
   * falls back to thread-root. Likes/reblogs on the card stay thread-root.
   */
  note_comment_count: number;
  /**
   * **Dev diagnostic only** when comment scope is still thread-root: anchor-scoped total from the read-only
   * probe in `feed-engagement` for comparing thread vs anchor. Omitted when anchor scope is active or probe fails.
   */
  anchor_note_comment_count?: number | null;
  /** True when the viewer liked the thread root (`post_ids_liked_by_auth_user` on root ids). */
  liked_by_me: boolean;
  /** Normalized tag strings (lowercase, trimmed). */
  tags: string[];
  /**
   * Home → Following feed only: first tag on this row (see {@link displayTagsForPost}) that matches a followed tag.
   * Omitted elsewhere.
   */
  homeFollowingMatchedTag?: string;
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
