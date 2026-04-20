import type { FeedPost } from "@/types/post";

const MAX_TAGS = 30;
const MAX_TAG_LEN = 40;

/** Normalize a single tag (matches how we store values in `posts.tags`). */
export function normalizeTagSegment(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Decode a dynamic `[tag]` route segment into a stored tag, or null if empty/invalid. */
export function tagFromRouteParam(param: string): string | null {
  let decoded = param;
  try {
    decoded = decodeURIComponent(param.replace(/\+/g, " "));
  } catch {
    return null;
  }
  const t = normalizeTagSegment(decoded);
  return t.length > 0 ? t : null;
}

/**
 * Parse a comma-separated tag string from the composer into unique stored tags.
 */
export function parseCommaSeparatedTags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = normalizeTagSegment(part);
    if (!t || t.length > MAX_TAG_LEN) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function coercePostTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

/**
 * Tags shown on a feed card: always this row’s stored `posts.tags` (originals and reblogs alike).
 * New reblog rows store only tags the reblogging user entered in the reblog modal — not the source’s tags.
 */
export function displayTagsForPost(post: FeedPost): string[] {
  return coercePostTags(post.tags);
}
