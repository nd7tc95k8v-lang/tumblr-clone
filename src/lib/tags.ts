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

/** Tags to persist on a reblog row (copy chain root so tag pages stay consistent). */
export function tagsForReblogFromSource(source: FeedPost): string[] {
  const root = source.original_post;
  if (root) {
    const fromRoot = coercePostTags(root.tags);
    if (fromRoot.length > 0) return fromRoot;
  }
  return coercePostTags(source.tags);
}

/** Tags shown on a feed card: always this row’s `posts.tags` (including reblogs after copy-on-create). */
export function displayTagsForPost(post: FeedPost): string[] {
  return coercePostTags(post.tags);
}
