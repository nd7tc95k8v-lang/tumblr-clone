/**
 * Viewer preference for NSFW posts on home / explore / search feeds only.
 * Stored on `profiles.nsfw_feed_mode`; unrelated to `posts.is_nsfw` writes.
 */

export const NSFW_FEED_MODES = ["show", "warn", "hide"] as const;

export type NsfwFeedMode = (typeof NSFW_FEED_MODES)[number];

export const DEFAULT_NSFW_FEED_MODE: NsfwFeedMode = "warn";

export function isNsfwFeedMode(value: unknown): value is NsfwFeedMode {
  return value === "show" || value === "warn" || value === "hide";
}

/** Normalize DB / API values; unknown or missing → warn (product default). */
export function parseNsfwFeedMode(raw: unknown): NsfwFeedMode {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (isNsfwFeedMode(t)) return t;
  }
  return DEFAULT_NSFW_FEED_MODE;
}

export function resolveNsfwFeedModeFromProfileRow(
  row: { nsfw_feed_mode?: unknown } | null | undefined,
): NsfwFeedMode {
  if (!row) return DEFAULT_NSFW_FEED_MODE;
  return parseNsfwFeedMode(row.nsfw_feed_mode);
}

/** When true, feed/search queries should add `is_nsfw = false` server-side. */
export function excludeNsfwPostsFromFeedQuery(mode: NsfwFeedMode): boolean {
  return mode === "hide";
}
