import { usernameLooksLikeEmail } from "@/lib/username";
import type { EmbeddedPostWithAuthor, FeedPost, QuotedPostNode } from "@/types/post";
import { unwrapEmbed } from "@/types/post";

export function displayUsername(value: string | null | undefined): string {
  const u = value?.trim();
  if (!u) return "Unknown";
  if (usernameLooksLikeEmail(u)) return "Unknown";
  return u;
}

export function formatPostTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function authorUsername(row: FeedPost): string | null | undefined {
  return unwrapEmbed(row.author)?.username ?? undefined;
}

function embedAuthorUsername(embed: EmbeddedPostWithAuthor): string | null | undefined {
  return unwrapEmbed(embed.author)?.username ?? undefined;
}

function authorAvatarUrl(row: FeedPost): string | null {
  const u = unwrapEmbed(row.author)?.avatar_url?.trim();
  return u || null;
}

function quotedNodeAuthorUsername(node: QuotedPostNode): string | null | undefined {
  return unwrapEmbed(node.author)?.username ?? undefined;
}

function quotedNodeAuthorAvatar(node: QuotedPostNode): string | null {
  const u = unwrapEmbed(node.author)?.avatar_url?.trim();
  return u || null;
}

function embedAuthorAvatarUrl(embed: EmbeddedPostWithAuthor): string | null {
  const u = unwrapEmbed(embed.author)?.avatar_url?.trim();
  return u || null;
}

/** Chain root for reblogs (merged `original_post`). */
function chainRootEmbed(row: FeedPost): EmbeddedPostWithAuthor | null {
  if (!row.reblog_of?.trim()) return null;
  return row.original_post;
}

/**
 * Card header: always the **current row** author (reblogger on reblogs).
 * `originalPostBy` / `originalPostByRaw`: chain root author for “Original post by …” (same as primary when not a reblog).
 */
export function usernameFromEmbed(
  row: FeedPost,
): { primary: string; originalPostBy: string; isReblog: boolean } {
  const rowAuthorName = displayUsername(authorUsername(row));
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);

  if (reblogOf && root) {
    return {
      primary: rowAuthorName,
      originalPostBy: displayUsername(embedAuthorUsername(root)),
      isReblog: true,
    };
  }

  if (reblogOf) {
    return {
      primary: rowAuthorName,
      originalPostBy: "Unknown",
      isReblog: true,
    };
  }

  return {
    primary: rowAuthorName,
    originalPostBy: rowAuthorName,
    isReblog: false,
  };
}

export function postProfileLinkRaw(row: FeedPost): {
  primaryRaw: string | null;
  originalPostByRaw: string | null;
} {
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);
  const rowAuthor = authorUsername(row);
  const primaryRaw = rowAuthor?.trim() ? rowAuthor : null;

  if (reblogOf && root) {
    const o = embedAuthorUsername(root);
    return {
      primaryRaw,
      originalPostByRaw: o?.trim() ? o : null,
    };
  }

  if (reblogOf) {
    return {
      primaryRaw,
      originalPostByRaw: null,
    };
  }

  return {
    primaryRaw,
    originalPostByRaw: primaryRaw,
  };
}

/** Header avatar: current row author. */
export function postProfileAvatars(row: FeedPost): {
  primaryAvatarUrl: string | null;
} {
  return {
    primaryAvatarUrl: authorAvatarUrl(row),
  };
}

export function bodyFromPost(row: FeedPost): { content: string; imageSrc: string | null } {
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);

  if (reblogOf && root) {
    const img = root.image_url?.trim() || null;
    return { content: root.content, imageSrc: img };
  }

  const img = row.image_url?.trim() || null;
  return { content: row.content, imageSrc: img };
}

/** Attribution line in the reblog modal (who wrote the quoted body). */
export function quotedPostAuthorDisplay(row: FeedPost): string {
  const root = chainRootEmbed(row);
  if (row.reblog_of?.trim() && root) {
    return displayUsername(embedAuthorUsername(root));
  }
  return displayUsername(authorUsername(row));
}

/** Header line for a nested quoted post (same row author as the quote node). */
export function quotedNodeProfile(node: QuotedPostNode): {
  primary: string;
  primaryRaw: string | null;
  primaryAvatarUrl: string | null;
} {
  const raw = quotedNodeAuthorUsername(node)?.trim() || null;
  return {
    primary: displayUsername(raw),
    primaryRaw: raw,
    primaryAvatarUrl: quotedNodeAuthorAvatar(node),
  };
}

/** Deepest node in a quoted chain (original / leaf). */
export function quotedChainLeaf(node: QuotedPostNode | null): QuotedPostNode | null {
  if (!node) return null;
  let n: QuotedPostNode = node;
  while (n.quoted_post) n = n.quoted_post;
  return n;
}

/** How many bordered quote levels exist under `node`, matching `QuotedPostNest` plain-skip rules (already-loaded tree only). */
export function countVisibleQuotedNestLevels(node: QuotedPostNode | null): number {
  if (!node) return 0;
  const isLeaf = !node.reblog_of?.trim();
  if (!isLeaf && !node.reblog_commentary?.trim() && node.quoted_post) {
    return countVisibleQuotedNestLevels(node.quoted_post);
  }
  if (isLeaf) return 1;
  return 1 + countVisibleQuotedNestLevels(node.quoted_post);
}

/** Default max visible nest depth (0…MAX-1); deeper tail is behind “Show full chain”. */
export const QUOTE_NEST_MAX_INITIAL_DEPTH = 3;

function leafImageFromQuoted(node: QuotedPostNode | null): string | null {
  const leaf = quotedChainLeaf(node);
  return leaf?.image_url?.trim() || null;
}

/**
 * True when this reblog row should show as a new quote layer (commentary and/or image differs from inherited thread media).
 * Plain reblogs (snapshot-only) return false.
 */
export function hasQuoteReblogLayer(post: FeedPost): boolean {
  if (!post.reblog_of?.trim()) return false;
  if (post.reblog_commentary?.trim()) return true;
  const mine = post.image_url?.trim() || null;
  const inherited = leafImageFromQuoted(post.quoted_post);
  if (mine && inherited && mine !== inherited) return true;
  if (mine && !inherited) return true;
  return false;
}

/**
 * True when the feed row is a plain/instant reblog (no quote tier).
 * Same predicate that gates `resolvePlainReblogDisplay` vs quote-layer rendering.
 */
export function isPlainReblogRow(post: FeedPost): boolean {
  return Boolean(post.reblog_of?.trim()) && !hasQuoteReblogLayer(post);
}

/** Reblogger identity for the subtle “Reblogged by …” line; null when not a plain reblog row. */
export function plainReblogAttributionProfile(post: FeedPost): {
  primary: string;
  primaryRaw: string | null;
} | null {
  if (!isPlainReblogRow(post)) return null;
  const raw = authorUsername(post)?.trim() || null;
  return {
    primary: displayUsername(raw),
    primaryRaw: raw,
  };
}

/**
 * Immediate parent in a collapsed plain reblog chain (flat leaf), when their username differs from the leaf.
 * Uses only `post.quoted_post` / resolved leaf — no extra fetches.
 */
export function plainReblogViaProfile(post: FeedPost): {
  primary: string;
  primaryRaw: string | null;
} | null {
  if (!isPlainReblogRow(post) || !post.quoted_post) return null;
  const resolved = resolvePlainReblogDisplay(post);
  if (!resolved || resolved.kind !== "flat") return null;
  const first = post.quoted_post;
  const leaf = resolved.leaf;
  if (first.id === leaf.id) return null;
  const fp = quotedNodeProfile(first);
  const lp = quotedNodeProfile(leaf);
  if (!fp.primaryRaw || !lp.primaryRaw) return null;
  if (fp.primaryRaw.toLowerCase() === lp.primaryRaw.toLowerCase()) return null;
  return fp;
}

/** Outer-card image for a quote layer: only when it is not the same snapshot as the quoted chain leaf. */
export function quoteLayerOuterImageUrl(post: FeedPost): string | null {
  if (!hasQuoteReblogLayer(post)) return null;
  const mine = post.image_url?.trim() || null;
  if (!mine) return null;
  const inherited = leafImageFromQuoted(post.quoted_post);
  if (!inherited || mine !== inherited) return mine;
  return null;
}

export type PlainReblogResolved =
  | { kind: "flat"; leaf: QuotedPostNode }
  | { kind: "quoted"; node: QuotedPostNode };

/**
 * For a plain reblog row, find how to collapse the parent chain for the card header and body.
 * Returns null if not a plain reblog or chain is missing.
 */
export function resolvePlainReblogDisplay(post: FeedPost): PlainReblogResolved | null {
  if (!post.reblog_of?.trim() || hasQuoteReblogLayer(post) || !post.quoted_post) return null;
  let n: QuotedPostNode = post.quoted_post;
  while (!n.reblog_commentary?.trim() && n.reblog_of?.trim() && n.quoted_post) {
    n = n.quoted_post;
  }
  if (!n.reblog_of?.trim()) {
    return { kind: "flat", leaf: n };
  }
  return { kind: "quoted", node: n };
}

/** Avatar / name shown in the post card header (respects plain vs quote reblog rules). */
export function postCardHeaderProfile(post: FeedPost): {
  primary: string;
  primaryRaw: string | null;
  primaryAvatarUrl: string | null;
} {
  if (!post.reblog_of?.trim()) {
    const raw = authorUsername(post)?.trim() || null;
    return {
      primary: displayUsername(raw),
      primaryRaw: raw,
      primaryAvatarUrl: authorAvatarUrl(post),
    };
  }
  if (hasQuoteReblogLayer(post)) {
    const raw = authorUsername(post)?.trim() || null;
    return {
      primary: displayUsername(raw),
      primaryRaw: raw,
      primaryAvatarUrl: authorAvatarUrl(post),
    };
  }
  const resolved = resolvePlainReblogDisplay(post);
  if (resolved?.kind === "flat") return quotedNodeProfile(resolved.leaf);
  if (resolved?.kind === "quoted") return quotedNodeProfile(resolved.node);
  const raw = authorUsername(post)?.trim() || null;
  return {
    primary: displayUsername(raw),
    primaryRaw: raw,
    primaryAvatarUrl: authorAvatarUrl(post),
  };
}
