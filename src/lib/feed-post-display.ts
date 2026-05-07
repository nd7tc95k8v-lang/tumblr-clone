import {
  devNormalizedImageStoragePathsForQuoteMediaDiag,
  normalizePostImages,
  postImagesFingerprint,
  type NormalizedPostImage,
} from "@/lib/post-images";
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

/** Scan-friendly relative / compact labels; full stamp for `title` / `aria-label` (see `formatPostTime`). */
export function formatRelativePostTime(iso: string): { label: string; full: string } {
  const full = formatPostTime(iso);
  let d: Date;
  try {
    d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { label: full, full };
  } catch {
    return { label: full, full };
  }
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return { label: full, full };

  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return { label: "Just now", full };
  if (sec < 90) return { label: "1m", full };
  if (sec < 3600) return { label: `${Math.floor(sec / 60)}m`, full };
  if (sec < 86400) return { label: `${Math.floor(sec / 3600)}h`, full };

  const dayStartMs = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const calendarDaysBehind = Math.round((dayStartMs(Date.now()) - dayStartMs(d.getTime())) / 86400000);
  if (calendarDaysBehind === 1) {
    return {
      label: `Yesterday ${d.toLocaleTimeString(undefined, { timeStyle: "short" })}`,
      full,
    };
  }
  if (calendarDaysBehind >= 2 && calendarDaysBehind < 7) {
    return {
      label: d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }),
      full,
    };
  }
  return { label: full, full };
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

export function bodyFromPost(row: FeedPost): {
  content: string;
  imageSrc: string | null;
  image_storage_path: string | null;
} {
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);

  if (reblogOf && root) {
    return {
      content: root.content,
      imageSrc: root.image_url?.trim() || null,
      image_storage_path: root.image_storage_path?.trim() || null,
    };
  }

  return {
    content: row.content,
    imageSrc: row.image_url?.trim() || null,
    image_storage_path: row.image_storage_path?.trim() || null,
  };
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

/**
 * Linear visible chain **newest → oldest** (`entry` first — immediate parent of the feed row — down to the original).
 * Matches `QuotedPostNest` plain-intermediate skip rules (already-loaded tree only).
 */
export function flattenVisibleQuotedChain(entry: QuotedPostNode | null): QuotedPostNode[] {
  if (!entry) return [];
  const path: QuotedPostNode[] = [];
  let n: QuotedPostNode | null = entry;
  while (n) {
    path.push(n);
    n = n.quoted_post;
  }
  const visible: QuotedPostNode[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const node = path[i];
    const isLeaf = !node.reblog_of?.trim();
    if (isLeaf) {
      visible.push(node);
      continue;
    }
    if (!node.reblog_commentary?.trim() && node.quoted_post) {
      continue;
    }
    visible.push(node);
  }
  return visible;
}

/** How many visible quote layers `node` contributes (same length as {@link flattenVisibleQuotedChain}). */
export function countVisibleQuotedNestLevels(node: QuotedPostNode | null): number {
  return flattenVisibleQuotedChain(node).length;
}

/** Default max visible nest depth (0…MAX-1); deeper tail is behind “Show full chain”. */
export const QUOTE_NEST_MAX_INITIAL_DEPTH = 3;

/** Stable key for comparing “same media” across path + legacy URL. */
export function postMediaKey(
  storagePath: string | null | undefined,
  legacyUrl: string | null | undefined,
): string | null {
  const p = storagePath?.trim() || null;
  const u = legacyUrl?.trim() || null;
  return p || u || null;
}

function leafImagesFingerprintFromQuoted(node: QuotedPostNode | null): string {
  const leaf = quotedChainLeaf(node);
  if (!leaf) return "";
  return postImagesFingerprint(leaf);
}

/** `post-images` paths are `{auth.uid}/…`; compare prefixes case-insensitively (UUID text casing can differ). */
function storagePathOwnedByUser(storagePath: string | null | undefined, userId: string): boolean {
  const p = storagePath?.trim();
  const u = userId.trim().toLowerCase();
  if (!p || !u) return false;
  return p.toLowerCase().startsWith(`${u}/`);
}

/**
 * Images on this reblog row that belong in the **reblogger add-on** layer: storage paths under this row author’s
 * prefix in bucket `post-images`, excluding paths that are already on the quoted chain **leaf** (dedupes copies).
 */
function reblogAddonOwnImages(post: FeedPost): NormalizedPostImage[] {
  const uid = post.user_id?.trim();
  if (!uid) return [];

  const leaf = quotedChainLeaf(post.quoted_post);
  const leafStorageLower = new Set(
    (leaf ? normalizePostImages(leaf) : [])
      .map((i) => (i.storagePath || "").trim().toLowerCase())
      .filter(Boolean),
  );

  const out: NormalizedPostImage[] = [];
  const seenLower = new Set<string>();

  for (const img of normalizePostImages(post)) {
    const sp = img.storagePath?.trim();
    if (!sp || !storagePathOwnedByUser(sp, uid)) continue;
    const sl = sp.toLowerCase();
    if (leafStorageLower.has(sl)) continue;
    if (seenLower.has(sl)) continue;
    seenLower.add(sl);
    out.push(img);
  }

  /* When `post_images` rows failed coercion but `posts.image_storage_path` is set (hydration edge cases). */
  const leg = post.image_storage_path?.trim();
  if (leg && storagePathOwnedByUser(leg, uid)) {
    const ll = leg.toLowerCase();
    if (!leafStorageLower.has(ll) && !seenLower.has(ll)) {
      out.push({
        alt: "Post image",
        src: post.image_url?.trim() || null,
        storagePath: leg,
      });
    }
  }

  return out;
}

/**
 * Same path-prefix + leaf-dedupe rules as {@link reblogAddonOwnImages}, for a {@link QuotedPostNode} inside the nest.
 */
function quotedPostNodeAddonOwnImages(node: QuotedPostNode): NormalizedPostImage[] {
  const uid = node.user_id?.trim();
  if (!uid) return [];

  const leaf = quotedChainLeaf(node.quoted_post);
  const leafStorageLower = new Set(
    (leaf ? normalizePostImages(leaf) : [])
      .map((i) => (i.storagePath || "").trim().toLowerCase())
      .filter(Boolean),
  );

  const out: NormalizedPostImage[] = [];
  const seenLower = new Set<string>();

  for (const img of normalizePostImages(node)) {
    const sp = img.storagePath?.trim();
    if (!sp || !storagePathOwnedByUser(sp, uid)) continue;
    const sl = sp.toLowerCase();
    if (leafStorageLower.has(sl)) continue;
    if (seenLower.has(sl)) continue;
    seenLower.add(sl);
    out.push(img);
  }

  const leg = node.image_storage_path?.trim();
  if (leg && storagePathOwnedByUser(leg, uid)) {
    const ll = leg.toLowerCase();
    if (!leafStorageLower.has(ll) && !seenLower.has(ll)) {
      out.push({
        alt: "Post image",
        src: node.image_url?.trim() || null,
        storagePath: leg,
      });
    }
  }

  return out;
}

/**
 * Distinct gallery for a **non-leaf** {@link QuotedPostNode} in `QuotedPostNest` — mirrors {@link quoteLayerOuterMedia}
 * (author-owned add-on paths first, else full set when it differs from the quoted subtree leaf fingerprint).
 * Returns `null` for originals / leaf nodes (`reblog_of` empty).
 */
export function quotedNestLayerOuterMedia(node: QuotedPostNode): NormalizedPostImage[] | null {
  if (!node.reblog_of?.trim()) return null;

  const addon = quotedPostNodeAddonOwnImages(node);
  if (addon.length > 0) return addon;

  const mine = normalizePostImages(node);
  if (mine.length === 0) return null;
  const inherited = leafImagesFingerprintFromQuoted(node.quoted_post);
  const mineFp = postImagesFingerprint(node);
  if (!inherited || mineFp !== inherited) return mine;
  return null;
}

/**
 * True when this reblog row should show as a new quote layer (commentary and/or image differs from inherited thread media).
 * Plain reblogs (snapshot-only) return false.
 *
 * Drives both **UI tiering** and **`noteOwnerPostIdForCard`** (quote layers use the current row id as the authored layer).
 */
export function hasQuoteReblogLayer(post: FeedPost): boolean {
  if (!post.reblog_of?.trim()) return false;
  if (post.reblog_commentary?.trim()) return true;
  if (reblogAddonOwnImages(post).length > 0) return true;
  const mine = postImagesFingerprint(post);
  const inherited = leafImagesFingerprintFromQuoted(post.quoted_post);
  if (mine && !inherited) return true;
  if (mine && inherited && mine !== inherited) return true;
  return false;
}

/**
 * True when the feed row is a plain/instant reblog (no quote tier).
 * Same predicate that gates `resolvePlainReblogDisplay` vs quote-layer rendering.
 */
export function isPlainReblogRow(post: FeedPost): boolean {
  return Boolean(post.reblog_of?.trim()) && !hasQuoteReblogLayer(post);
}

/** Display + link fields for a single @username line (header, via, source). */
export type PostCardLineProfile = {
  primary: string;
  primaryRaw: string | null;
};

/**
 * Card header attribution: current-row author, immediate parent (“via”), and optional chain root (“Source”).
 * Uses `post.quoted_post` (immediate parent) and `post.original_post` (thread root); no extra queries.
 */
export type PostCardHeaderAttribution = PostCardLineProfile & {
  primaryAvatarUrl: string | null;
  /** Immediate parent author; omitted when missing or same as the row author. */
  via: PostCardLineProfile | null;
  /** Thread-root author when {@link PostCardHeaderAttribution.showSource}; otherwise null. */
  source: PostCardLineProfile | null;
  /** True when root author differs from the via author (deeper chains only). */
  showSource: boolean;
};

export function postCardHeaderAttribution(post: FeedPost): PostCardHeaderAttribution {
  const primaryRaw = authorUsername(post)?.trim() || null;
  const primary = displayUsername(primaryRaw);
  const primaryAvatarUrl = authorAvatarUrl(post);

  if (!post.reblog_of?.trim()) {
    return {
      primary,
      primaryRaw,
      primaryAvatarUrl,
      via: null,
      source: null,
      showSource: false,
    };
  }

  let via: PostCardLineProfile | null = null;
  if (post.quoted_post) {
    const parent = quotedNodeProfile(post.quoted_post);
    if (
      parent.primaryRaw &&
      (!primaryRaw || parent.primaryRaw.toLowerCase() !== primaryRaw.toLowerCase())
    ) {
      via = { primary: parent.primary, primaryRaw: parent.primaryRaw };
    }
  }

  const rootEmbed = post.original_post;
  const rootRaw = rootEmbed ? embedAuthorUsername(rootEmbed)?.trim() || null : null;
  const sourceLine: PostCardLineProfile | null =
    rootRaw ? { primary: displayUsername(rootRaw), primaryRaw: rootRaw } : null;

  const showSource = Boolean(
    via &&
    sourceLine &&
    via.primaryRaw &&
    sourceLine.primaryRaw &&
    sourceLine.primaryRaw.toLowerCase() !== via.primaryRaw.toLowerCase(),
  );

  return {
    primary,
    primaryRaw,
    primaryAvatarUrl,
    via,
    source: showSource ? sourceLine : null,
    showSource,
  };
}

/**
 * Outer-card media for a quote layer: only when the gallery / legacy image set differs from the quoted chain leaf.
 * Prefer **reblogger add-on** images (paths under this author’s prefix that are not on the leaf); otherwise legacy dedupe.
 */
export function quoteLayerOuterMedia(post: FeedPost): NormalizedPostImage[] | null {
  if (!hasQuoteReblogLayer(post)) return null;
  const addon = reblogAddonOwnImages(post);
  if (addon.length > 0) return addon;

  const mine = normalizePostImages(post);
  if (mine.length === 0) return null;
  const inherited = leafImagesFingerprintFromQuoted(post.quoted_post);
  const mineFp = postImagesFingerprint(post);
  if (!inherited || mineFp !== inherited) return mine;
  return null;
}

/**
 * Temporary DEV-only: compact `console.debug` for quote-reblog row media after hydration.
 * Remove when investigation is complete.
 */
export function debugLogQuoteReblogMediaHydration(post: FeedPost): void {
  if (process.env.NODE_ENV !== "development") return;
  if (!hasQuoteReblogLayer(post)) return;

  const normalizedStoragePaths = devNormalizedImageStoragePathsForQuoteMediaDiag(post);
  const uid = post.user_id?.trim() ?? "";
  const uidPrefix = `${uid.toLowerCase()}/`;
  const anyStoragePathStartsWithUserIdPrefix = normalizedStoragePaths.some((p) =>
    p.toLowerCase().startsWith(uidPrefix),
  );
  const addon = reblogAddonOwnImages(post);
  const reblogAddonPaths = addon.map((i) => (i.storagePath || "").trim()).filter(Boolean);
  const mineFp = postImagesFingerprint(post);
  const leafFp = leafImagesFingerprintFromQuoted(post.quoted_post);
  const outer = quoteLayerOuterMedia(post);

  console.debug("[quote-reblog-media]", {
    postId: post.id,
    userId: post.user_id,
    normalizedStoragePaths,
    reblogAddonOwnImages: reblogAddonPaths,
    postImagesFingerprint: mineFp,
    leafImagesFingerprintFromQuoted: leafFp,
    quoteLayerOuterMediaIsNull: outer === null,
    anyStoragePathStartsWithUserIdPrefix,
  });
}

export type PlainReblogResolved =
  | { kind: "flat"; leaf: QuotedPostNode }
  | { kind: "quoted"; node: QuotedPostNode };

/**
 * For a plain reblog row, find how to collapse the parent chain for the card header and body.
 * Returns null if not a plain reblog or chain is missing.
 *
 * **`noteOwnerPostIdForCard`** reuses this collapse: `flat` → leaf id (stacked plain reblogs collapse to one authored
 * surface); `quoted` → last plain hop before commentary. This is **display + future engagement identity only** —
 * shipped likes/notes still resolve on the thread root in `feed-engagement` / Notes fetchers.
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

/**
 * Avatar / name shown in the post card header — always the **current feed row** author
 * (reblogger on reblogs), including plain / quick reblogs (no longer collapsed to chain leaf).
 */
export function postCardHeaderProfile(post: FeedPost): {
  primary: string;
  primaryRaw: string | null;
  primaryAvatarUrl: string | null;
} {
  const a = postCardHeaderAttribution(post);
  return {
    primary: a.primary,
    primaryRaw: a.primaryRaw,
    primaryAvatarUrl: a.primaryAvatarUrl,
  };
}

/**
 * **Preparatory helper:** post id that **would** “own” this card’s **authored layer** in a future Tumblr-style
 * per-reblog engagement model (populate `FeedPost.card_engagement_owner_post_id` at hydrate).
 *
 * Purely derived from the loaded row and quote tree; mirrors **`postCardHeaderProfile`** /
 * **`resolvePlainReblogDisplay`** / **`hasQuoteReblogLayer`** so ownership matches what the user sees:
 * - Original (`reblog_of` empty) → `post.id`.
 * - Quote layer (`hasQuoteReblogLayer`) → `post.id`.
 * - Plain reblog → `resolvePlainReblogDisplay`: `quoted` → that node’s id; `flat` → leaf id;
 *   unresolved chain → `post.id`.
 *
 * **Not wired** to shipped likes, note comment counts, Notes modal queries, or RPC batch keys — those remain
 * thread-root until an explicit migration switches `engagementKeyForBatchAndMerge` and related product rules.
 */
export function noteOwnerPostIdForCard(post: FeedPost): string {
  if (!post.reblog_of?.trim()) {
    return post.id;
  }
  if (hasQuoteReblogLayer(post)) {
    return post.id;
  }
  const resolved = resolvePlainReblogDisplay(post);
  if (resolved?.kind === "flat") {
    return resolved.leaf.id;
  }
  if (resolved?.kind === "quoted") {
    return resolved.node.id;
  }
  return post.id;
}
