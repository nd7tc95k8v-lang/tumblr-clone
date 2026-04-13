export type ProfileUsername = {
  username: string;
};

export type OriginalPostEmbed = {
  id: string;
  content: string;
  image_url?: string | null;
  user_id: string;
  original_poster?: ProfileUsername | ProfileUsername[] | null;
};

export type FeedPost = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  image_url?: string | null;
  reblog_of?: string | null;
  /** Profile for this row's user_id (reblogging user on reblogs, author on originals). */
  poster?: ProfileUsername | ProfileUsername[] | null;
  /** Parent post when reblog_of is set (from posts.reblog_of → posts.id). */
  original?: OriginalPostEmbed | OriginalPostEmbed[] | null;
};

/** PostgREST may return an embedded row as an object or a single-element array. */
export function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
