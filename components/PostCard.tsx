"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_IMAGE_MIME_TYPES, validateImageFile } from "@/lib/image-upload-validation";
import { coercePostImageRows } from "@/lib/post-images";
import { postElementDomId } from "@/lib/post-anchor";
import { threadRootPostId } from "@/lib/post-thread-root";
import type { FeedPost } from "@/types/post";
import { coercePostTags, displayTagsForPost, parseCommaSeparatedTags } from "@/lib/tags";
import {
  bodyFromPost,
  formatRelativePostTime,
  hasQuoteReblogLayer,
  plainReblogAttributionProfile,
  plainReblogViaProfile,
  postCardHeaderProfile,
  QUOTE_NEST_MAX_INITIAL_DEPTH,
  quoteLayerOuterMedia,
  resolvePlainReblogDisplay,
} from "@/lib/feed-post-display";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";
import PostMediaGallery from "./PostMediaGallery";
import {
  normalizePostBodyForDedup,
  recordSuccessfulUserWrittenPost,
  validateUserWrittenContent,
} from "@/lib/post-content-guard";
import { InlineErrorBanner } from "./InlineErrorBanner";
import QuotedPostNest from "./QuotedPostNest";
import PostNotesModal from "./PostNotesModal";
import ReblogModal from "./ReblogModal";
import { DEFAULT_NSFW_FEED_MODE, type NsfwFeedMode } from "@/lib/nsfw-feed-preference";
import { useActionGuard } from "./ActionGuardProvider";
import { usePostLikeToggle } from "./usePostLikeToggle";

const ICON_BOX = "h-4 w-4 shrink-0 transition-[transform,opacity] duration-200 ease-out";

function HeartIcon({ active, className }: { active: boolean; className?: string }) {
  const svgClass = [className, "transition-[fill,stroke,opacity] duration-200 ease-out"].filter(Boolean).join(" ");
  if (active) {
    return (
      <svg viewBox="0 0 24 24" className={svgClass} fill="currentColor" aria-hidden>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className={svgClass}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/** Thread reblog count (stroke weight matches outline heart). */
function RepostStatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

/** Commentary / quote action (stroke weight matches RepostStatIcon). */
function QuoteBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** User-added commentary on quote reblogs — distinct from nested quoted content. */
const COMMENTARY_ADDED_LAYER_CLASS =
  "mt-2 rounded-r-card border-l-2 border-electric-purple/35 bg-surface-blue/55 py-2 pl-3 pr-2";

/** Frames nested quote chains as subordinate to the card author + commentary. */
const QUOTED_BLOCK_FRAME_CLASS =
  "mt-2 min-w-0 rounded-lg border border-border-soft bg-bg-secondary/50 p-2 sm:p-2.5";

/** Tabular count slot — avoids horizontal nudge when digits change. */
const STAT_COUNT_CLASS =
  "inline-block min-w-[3ch] text-right tabular-nums transition-colors duration-200 ease-out";

const REBLOG_ACTION_CLASS =
  "inline-flex min-h-[1.75rem] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-meta font-medium text-text-secondary transition-[color,background-color,transform,box-shadow] duration-200 ease-out hover:text-link hover:bg-bg-secondary/60 active:scale-[0.97] active:bg-bg-secondary/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50";

/** Slightly larger hit + tighter icon/text rhythm on phone (labels stay readable). */
const ACTION_HIT_MOBILE = "max-md:min-h-[2rem] max-md:gap-1 max-md:px-2 max-md:py-1";

/** Smaller meta text on phone without affecting `md+`. */
const ACTION_TEXT_MOBILE = "max-md:text-[0.6875rem] max-md:font-normal max-md:leading-snug";

/** Calmer secondary actions (notes / reblog / quote / owner menu trigger). */
const REBLOG_ACTION_ROW_COMPACT = `${ACTION_HIT_MOBILE} ${ACTION_TEXT_MOBILE} max-md:text-text-secondary/90`;

/** Like control: same hit/text tuning; color still from liked / muted state. */
const LIKE_ACTION_ROW_COMPACT = `${ACTION_HIT_MOBILE} ${ACTION_TEXT_MOBILE}`;

/** Reblog count row (non-button): only typography + gap. */
const REBLOG_STAT_ROW_COMPACT = `${ACTION_TEXT_MOBILE} max-md:gap-1`;

/**
 * Quote-style commentary that stays visible above the gate when the row is NSFW and this text is
 * the card author's own layer (not the nested quoted body). See plain `kind: "quoted"` collapse path.
 */
function nsfwUngatedVisibleCommentary(post: FeedPost): string | null {
  if (post.is_nsfw !== true) return null;
  if (hasQuoteReblogLayer(post)) {
    const c = post.reblog_commentary?.trim();
    if (c) return c;
  }
  const resolved = resolvePlainReblogDisplay(post);
  if (resolved?.kind === "quoted") {
    const c = resolved.node.reblog_commentary?.trim();
    if (c) return c;
  }
  return null;
}

function NsfwFeedContentWarning({ onReveal }: { onReveal: () => void }) {
  return (
    <div
      className="mt-2.5 rounded-lg border border-border/70 bg-bg-secondary/75 px-3 py-3 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.04]"
      role="region"
      aria-label="Mature content hidden"
    >
      <p className="font-heading text-sm font-semibold tracking-tight text-text">Mature content</p>
      <p className="mt-1 text-[0.8125rem] leading-snug text-text-secondary">
        This post may contain mature or sensitive content.
      </p>
      <button
        type="button"
        onClick={onReveal}
        className="mt-2.5 inline-flex min-h-[1.75rem] items-center justify-center rounded-md border border-border/80 bg-bg-secondary px-3 py-1.5 text-sm font-medium text-text transition-[color,background-color,transform] duration-200 ease-out hover:border-accent-purple/45 hover:bg-surface-blue/40 hover:text-link focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:ring-offset-0 active:scale-[0.98]"
      >
        View post
      </button>
    </div>
  );
}

type Props = {
  post: FeedPost;
  rebloggingId: string | null;
  onReblog: (post: FeedPost, commentary?: string | null) => boolean | Promise<boolean>;
  showReblog?: boolean;
  supabase: SupabaseClient | null;
  currentUserId: string | null;
  /** Stored normalized tags to highlight (e.g. active search filters). */
  searchHighlightTags?: string[];
  /** Called after the viewer successfully deletes this post (e.g. refetch feed). */
  onPostDeleted?: () => void | Promise<void>;
  /** Called after the viewer successfully updates tags on their post (e.g. refetch feed). */
  onPostUpdated?: () => void | Promise<void>;
  /**
   * Home / Explore / Search only: `warn` uses tap-to-view; `show` never gates; `hide` should not appear (filtered server-side).
   * Omit on profile/tag feeds → defaults to `warn`.
   */
  nsfwFeedMode?: NsfwFeedMode;
};

const TAG_CHIP_BASE =
  "inline-block rounded-full border px-2 py-0.5 text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0";
const TAG_CHIP_DEFAULT =
  "border-border bg-bg-secondary text-text-secondary hover:border-accent-purple/45 hover:text-link";
const TAG_CHIP_HIGHLIGHT =
  "border-accent-purple/55 bg-accent-purple/15 text-text hover:border-accent-purple/70 hover:text-link";

/** Narrow screens: slightly flatter chips, calmer fills, aligned with compact meta/actions. */
const TAG_CHIP_MOBILE_SHELL =
  "max-md:inline-flex max-md:min-h-[1.75rem] max-md:items-center max-md:px-1.5 max-md:py-px max-md:text-[0.6875rem] max-md:font-normal max-md:leading-snug";
const TAG_CHIP_DEFAULT_MOBILE_SOFT =
  "max-md:border-border/55 max-md:bg-bg-secondary/65 max-md:text-text-secondary";
const TAG_CHIP_HIGHLIGHT_MOBILE_SOFT =
  "max-md:border-accent-purple/45 max-md:bg-accent-purple/11 max-md:text-text";

const MAX_POST_IMAGES = 10;
const ACCEPT_IMAGE_ATTR = ALLOWED_IMAGE_MIME_TYPES.join(",");

type MediaSlot =
  | { kind: "row"; rowId: string; path: string; position: number }
  | { kind: "legacy"; path: string };

function errorMessageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const m = err.message.trim();
    if (m) return m;
  }
  if (err && typeof err === "object" && "message" in err) {
    const m = String((err as { message?: unknown }).message).trim();
    if (m) return m;
  }
  return fallback;
}

function buildMediaSlotsFromPost(post: FeedPost): MediaSlot[] {
  const rows = coercePostImageRows(post.post_images);
  if (rows?.length) {
    return rows.map((r) => ({
      kind: "row" as const,
      rowId: r.id,
      path: r.storage_path,
      position: r.position,
    }));
  }
  const leg = post.image_storage_path?.trim();
  if (leg) return [{ kind: "legacy" as const, path: leg }];
  return [];
}

async function collectStoragePathsToDelete(
  supabase: SupabaseClient,
  postId: string,
  ownerId: string,
  droppedPaths: string[],
): Promise<string[]> {
  const ownerPrefix = `${ownerId}/`;
  const removable: string[] = [];
  for (const path of droppedPaths) {
    if (!path.startsWith(ownerPrefix)) continue;
    const { count: piCount, error: c1 } = await supabase
      .from("post_images")
      .select("*", { count: "exact", head: true })
      .eq("storage_path", path)
      .neq("post_id", postId);
    if (c1) throw c1;
    const { count: postCount, error: c2 } = await supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("image_storage_path", path)
      .neq("id", postId);
    if (c2) throw c2;
    if ((piCount ?? 0) === 0 && (postCount ?? 0) === 0) removable.push(path);
  }
  return removable;
}

function MediaEditExistingThumb({
  supabase,
  path,
  onRemove,
  removeDisabled,
}: {
  supabase: SupabaseClient;
  path: string;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.storage.from("post-images").createSignedUrl(path, 3600);
      if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, path]);

  return (
    <div className="relative aspect-square w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-border/70 bg-bg-secondary ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-bg-secondary" aria-hidden />
      )}
      <button
        type="button"
        disabled={removeDisabled}
        onClick={onRemove}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-40"
        aria-label="Remove image"
      >
        ×
      </button>
    </div>
  );
}

function MediaEditNewThumb({
  file,
  onRemove,
  removeDisabled,
}: {
  file: File;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  return (
    <div className="relative aspect-square w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-border/70 bg-bg-secondary ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-bg-secondary" aria-hidden />
      )}
      <button
        type="button"
        disabled={removeDisabled}
        onClick={onRemove}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-40"
        aria-label="Remove image"
      >
        ×
      </button>
    </div>
  );
}

export default function PostCard({
  post,
  rebloggingId,
  onReblog,
  showReblog = true,
  supabase,
  currentUserId,
  searchHighlightTags,
  onPostDeleted,
  onPostUpdated,
  nsfwFeedMode,
}: Props) {
  const [reblogModalPost, setReblogModalPost] = useState<FeedPost | null>(null);
  const [reblogModalBusy, setReblogModalBusy] = useState(false);
  const [reblogModalError, setReblogModalError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagsEditOpen, setTagsEditOpen] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");
  const [tagsEditBusy, setTagsEditBusy] = useState(false);
  const [tagsEditError, setTagsEditError] = useState<string | null>(null);
  const [textEditOpen, setTextEditOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [textEditBusy, setTextEditBusy] = useState(false);
  const [textEditError, setTextEditError] = useState<string | null>(null);
  const [mediaEditOpen, setMediaEditOpen] = useState(false);
  const [mediaEditBusy, setMediaEditBusy] = useState(false);
  const [mediaEditError, setMediaEditError] = useState<string | null>(null);
  const [mediaSlots, setMediaSlots] = useState<MediaSlot[]>([]);
  const [mediaNewFiles, setMediaNewFiles] = useState<File[]>([]);
  const [mediaDragActive, setMediaDragActive] = useState(false);
  const [reblogCount, setReblogCount] = useState(() => Math.max(0, post.reblog_count));
  /** Local offset vs `post.note_comment_count` so the Notes badge updates without a feed refetch. */
  const [noteCommentAdjust, setNoteCommentAdjust] = useState(0);
  const [quoteChainExpanded, setQuoteChainExpanded] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  /** Per-card, session-only: reveal gated feed body/media after viewer opts in. */
  const [nsfwRevealed, setNsfwRevealed] = useState(false);

  const { liked, likeCount, likeBusy, likeError, dismissLikeError, toggleLike } = usePostLikeToggle({
    supabase,
    currentUserId,
    rootPostId: threadRootPostId(post),
    initialLiked: post.liked_by_me,
    initialLikeCount: post.like_count,
  });

  useEffect(() => {
    setReblogCount(Math.max(0, post.reblog_count));
  }, [post.id, post.reblog_count]);

  useEffect(() => {
    setNoteCommentAdjust(0);
  }, [post.id, post.note_comment_count]);

  useEffect(() => {
    setQuoteChainExpanded(false);
    setNsfwRevealed(false);
  }, [post.id, nsfwFeedMode]);
  const header = postCardHeaderProfile(post);
  const { primary, primaryRaw, primaryAvatarUrl } = header;
  const isReblog = Boolean(post.reblog_of?.trim());
  const quoteLayer = hasQuoteReblogLayer(post);
  const plainResolved = resolvePlainReblogDisplay(post);
  const fallbackBody = bodyFromPost(post);
  const tags = displayTagsForPost(post);
  const highlightSet =
    searchHighlightTags && searchHighlightTags.length > 0 ? new Set(searchHighlightTags) : null;
  const commentary = post.reblog_commentary?.trim() || null;
  const quoteOuterMedia = quoteLayerOuterMedia(post);
  const showNestedQuote = Boolean(quoteLayer && post.quoted_post);
  const showFlatReblogFallback = Boolean(isReblog && !post.quoted_post);
  const plainReblogBy = plainReblogAttributionProfile(post);
  const plainReblogVia = plainReblogViaProfile(post);

  const effectiveNsfwFeedMode = nsfwFeedMode ?? DEFAULT_NSFW_FEED_MODE;
  const nsfwPresentationGate = post.is_nsfw === true && effectiveNsfwFeedMode === "warn";
  const ungatedCommentary = nsfwPresentationGate ? nsfwUngatedVisibleCommentary(post) : null;
  const nsfwFeedBodyHidden = nsfwPresentationGate && !nsfwRevealed;
  /** Feed `show` mode only: subtle context label (no gate, no query change). */
  const showNsfwUnGatedBadge = post.is_nsfw === true && effectiveNsfwFeedMode === "show";

  const isOwner = Boolean(currentUserId && currentUserId === post.user_id);
  const hasReblogParent = Boolean(post.reblog_of?.trim());
  /** Originals + quote-layer rows only — not plain snapshot reblogs (text + photos). */
  const canEditPostText = !hasReblogParent || hasQuoteReblogLayer(post);
  const canEditPostMedia = canEditPostText;
  const ownerMenuRef = useRef<HTMLDetailsElement>(null);
  const mediaBaselinePathsRef = useRef<string[]>([]);
  const mediaInitialRowIdsRef = useRef<Set<string>>(new Set());
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const { runProtectedAction } = useActionGuard();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const closeSiblingOwnerModals = useCallback((keep: "tags" | "text" | "media") => {
    if (keep !== "tags") {
      setTagsEditOpen(false);
      setTagsEditError(null);
    }
    if (keep !== "text") {
      setTextEditOpen(false);
      setTextEditError(null);
    }
    if (keep !== "media") {
      setMediaEditOpen(false);
      setMediaEditError(null);
      setMediaNewFiles([]);
      setMediaDragActive(false);
    }
  }, []);

  const handleOwnerDelete = useCallback(async () => {
    if (!supabase) {
      setDeleteError("Cannot delete while offline.");
      return;
    }
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const postId = post.id;
      const ownerPrefix = `${post.user_id}/`;

      const { data: piRows, error: piFetchErr } = await supabase
        .from("post_images")
        .select("storage_path")
        .eq("post_id", postId);
      if (piFetchErr) throw piFetchErr;

      const pathSet = new Set<string>();
      for (const r of piRows ?? []) {
        const p = r.storage_path?.trim();
        if (p) pathSet.add(p);
      }
      const legacy = post.image_storage_path?.trim();
      if (legacy) pathSet.add(legacy);

      const ownerPaths = [...pathSet].filter((p) => p.startsWith(ownerPrefix));

      const removable: string[] = [];
      for (const path of ownerPaths) {
        const { count: piCount, error: c1 } = await supabase
          .from("post_images")
          .select("*", { count: "exact", head: true })
          .eq("storage_path", path)
          .neq("post_id", postId);
        if (c1) throw c1;
        const { count: postCount, error: c2 } = await supabase
          .from("posts")
          .select("*", { count: "exact", head: true })
          .eq("image_storage_path", path)
          .neq("id", postId);
        if (c2) throw c2;
        if ((piCount ?? 0) === 0 && (postCount ?? 0) === 0) {
          removable.push(path);
        }
      }

      const { error: delPostErr } = await supabase.from("posts").delete().eq("id", postId);
      if (delPostErr) throw delPostErr;

      ownerMenuRef.current?.removeAttribute("open");

      if (removable.length > 0) {
        const { error: rmErr } = await supabase.storage.from("post-images").remove(removable);
        if (rmErr) console.error("Post delete: storage remove failed", rmErr);
      }

      await onPostDeleted?.();
    } catch (err: unknown) {
      if (mountedRef.current) {
        setDeleteError(errorMessageFromUnknown(err, "Could not delete this post."));
      }
    } finally {
      if (mountedRef.current) setDeleteBusy(false);
    }
  }, [post, supabase, onPostDeleted]);

  const ownerActionBusy = deleteBusy || tagsEditBusy || textEditBusy || mediaEditBusy;

  const handleOpenEditTags = useCallback(() => {
    closeSiblingOwnerModals("tags");
    ownerMenuRef.current?.removeAttribute("open");
    setTagsDraft(coercePostTags(post.tags).join(", "));
    setTagsEditError(null);
    setTagsEditOpen(true);
  }, [post.tags, closeSiblingOwnerModals]);

  const handleSaveTags = useCallback(async () => {
    if (!supabase) {
      setTagsEditError("Cannot save while offline.");
      return;
    }
    setTagsEditBusy(true);
    setTagsEditError(null);
    try {
      const nextTags = parseCommaSeparatedTags(tagsDraft);
      const { error } = await supabase.from("posts").update({ tags: nextTags }).eq("id", post.id);
      if (error) throw error;
      if (mountedRef.current) setTagsEditOpen(false);
      await onPostUpdated?.();
    } catch (err: unknown) {
      if (mountedRef.current) {
        setTagsEditError(errorMessageFromUnknown(err, "Could not save tags."));
      }
    } finally {
      if (mountedRef.current) setTagsEditBusy(false);
    }
  }, [supabase, post.id, tagsDraft, onPostUpdated]);

  const handleOpenEditText = useCallback(() => {
    closeSiblingOwnerModals("text");
    ownerMenuRef.current?.removeAttribute("open");
    setTextDraft(
      hasReblogParent ? (post.reblog_commentary ?? "") : post.content,
    );
    setTextEditError(null);
    setTextEditOpen(true);
  }, [hasReblogParent, post.content, post.reblog_commentary, closeSiblingOwnerModals]);

  const handleSaveText = useCallback(async () => {
    if (!supabase) {
      setTextEditError("Cannot save while offline.");
      return;
    }
    setTextEditBusy(true);
    setTextEditError(null);
    try {
      if (hasReblogParent) {
        const guard = validateUserWrittenContent(textDraft, { allowEmpty: true });
        if (!guard.ok) {
          setTextEditError(guard.message);
          return;
        }
        const trimmed = textDraft.trim();
        const { error } = await supabase
          .from("posts")
          .update({ reblog_commentary: trimmed.length > 0 ? trimmed : null })
          .eq("id", post.id);
        if (error) throw error;
      } else {
        const guard = validateUserWrittenContent(textDraft, { allowEmpty: false });
        if (!guard.ok) {
          setTextEditError(guard.message);
          return;
        }
        const { error } = await supabase
          .from("posts")
          .update({ content: textDraft.trim() })
          .eq("id", post.id);
        if (error) throw error;
      }
      if (mountedRef.current) setTextEditOpen(false);
      await onPostUpdated?.();
    } catch (err: unknown) {
      if (mountedRef.current) {
        setTextEditError(errorMessageFromUnknown(err, "Could not save text."));
      }
    } finally {
      if (mountedRef.current) setTextEditBusy(false);
    }
  }, [supabase, hasReblogParent, post.id, textDraft, onPostUpdated]);

  const handleOpenEditMedia = useCallback(() => {
    if (!supabase) return;
    closeSiblingOwnerModals("media");
    ownerMenuRef.current?.removeAttribute("open");
    const slots = buildMediaSlotsFromPost(post);
    setMediaSlots(slots);
    setMediaNewFiles([]);
    setMediaEditError(null);
    mediaBaselinePathsRef.current = slots.map((s) => s.path);
    mediaInitialRowIdsRef.current = new Set(
      slots.filter((s): s is Extract<MediaSlot, { kind: "row" }> => s.kind === "row").map((s) => s.rowId),
    );
    setMediaEditOpen(true);
  }, [post, supabase, closeSiblingOwnerModals]);

  const addMediaFiles = useCallback(
    (incoming: readonly File[]) => {
      setMediaNewFiles((prev) => {
        const next = [...prev];
        let firstError: string | null = null;
        for (const f of incoming) {
          if (mediaSlots.length + next.length >= MAX_POST_IMAGES) break;
          const img = validateImageFile(f);
          if (!img.ok) {
            if (!firstError) firstError = img.error;
            continue;
          }
          next.push(f);
        }
        queueMicrotask(() => {
          if (!mountedRef.current) return;
          if (firstError) setMediaEditError(firstError);
          else setMediaEditError(null);
        });
        return next;
      });
    },
    [mediaSlots.length],
  );

  const handleSaveMedia = useCallback(async () => {
    if (!supabase) {
      setMediaEditError("Cannot save while offline.");
      return;
    }
    setMediaEditBusy(true);
    setMediaEditError(null);
    let uploadedPathsForRollback: string[] = [];
    let mediaDbPersisted = false;
    try {
      await runProtectedAction(supabase, { kind: "post" }, async () => {
        uploadedPathsForRollback = [];
        mediaDbPersisted = false;
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) throw new Error(userErr?.message?.trim() || "Not signed in.");
        const ownerPrefix = `${user.id}/`;
        const postId = post.id;
        const baseline = mediaBaselinePathsRef.current;

        const legacySlot = mediaSlots.find((s) => s.kind === "legacy");
        if (legacySlot && mediaNewFiles.length > 0 && !legacySlot.path.startsWith(ownerPrefix)) {
          throw new Error("Remove the copied image before adding new photos.");
        }

        if (mediaSlots.length + mediaNewFiles.length > MAX_POST_IMAGES) {
          throw new Error(`You can have at most ${MAX_POST_IMAGES} images.`);
        }

        const keptRowIds = new Set(
          mediaSlots.filter((s): s is Extract<MediaSlot, { kind: "row" }> => s.kind === "row").map((s) => s.rowId),
        );
        const removedRowIds = [...mediaInitialRowIdsRef.current].filter((id) => !keptRowIds.has(id));

        const newPaths: string[] = [];
        for (const f of mediaNewFiles) {
          const v = validateImageFile(f);
          if (!v.ok) throw new Error(v.error);
          const rawExt = f.name.split(".").pop();
          const fileExt =
            rawExt && /^[a-z0-9]+$/i.test(rawExt) && rawExt.length <= 8 ? rawExt.toLowerCase() : "jpg";
          const filePath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;
          const { error: upErr } = await supabase.storage.from("post-images").upload(filePath, f, {
            contentType: f.type || `image/${fileExt}`,
            upsert: false,
          });
          if (upErr) throw upErr;
          newPaths.push(filePath);
          uploadedPathsForRollback.push(filePath);
        }

        const keptPathsOrdered = mediaSlots.map((s) => s.path);
        const finalPaths = [...keptPathsOrdered, ...newPaths].slice(0, MAX_POST_IMAGES);
        const dropped = baseline.filter((p) => !finalPaths.includes(p));

        const removable = await collectStoragePathsToDelete(supabase, postId, user.id, dropped);

        if (removedRowIds.length > 0) {
          const { error: delE } = await supabase.from("post_images").delete().in("id", removedRowIds);
          if (delE) throw delE;
        }

        if (removable.length > 0) {
          const { error: rmE } = await supabase.storage.from("post-images").remove(removable);
          if (rmE) console.error("Media edit: storage remove failed", rmE);
        }

        const rowSlots = mediaSlots.filter((s) => s.kind === "row");
        const maxRowPos = rowSlots.length > 0 ? Math.max(...rowSlots.map((s) => s.position)) : -1;

        const insertRows: { post_id: string; storage_path: string; position: number }[] = [];

        if (
          mediaSlots.length === 1 &&
          mediaSlots[0].kind === "legacy" &&
          mediaSlots[0].path.startsWith(ownerPrefix) &&
          newPaths.length > 0
        ) {
          insertRows.push({
            post_id: postId,
            storage_path: mediaSlots[0].path,
            position: 0,
          });
          newPaths.forEach((path, i) => {
            insertRows.push({ post_id: postId, storage_path: path, position: 1 + i });
          });
        } else if (newPaths.length > 0) {
          newPaths.forEach((path, i) => {
            insertRows.push({
              post_id: postId,
              storage_path: path,
              position: maxRowPos + 1 + i,
            });
          });
        }

        if (insertRows.length > 0) {
          const { error: insE } = await supabase.from("post_images").insert(insertRows);
          if (insE) throw insE;
        }

        const { error: upPostE } = await supabase
          .from("posts")
          .update({ image_storage_path: finalPaths[0] ?? null })
          .eq("id", postId);
        if (upPostE) throw upPostE;

        mediaDbPersisted = true;
        uploadedPathsForRollback = [];
        if (mountedRef.current) {
          setMediaEditOpen(false);
          setMediaNewFiles([]);
        }
        await onPostUpdated?.();
      });
    } catch (err: unknown) {
      if (!mediaDbPersisted && uploadedPathsForRollback.length > 0 && supabase) {
        const { error: rbErr } = await supabase.storage.from("post-images").remove(uploadedPathsForRollback);
        if (rbErr) console.error("Media edit: rollback orphan uploads failed", rbErr);
      }
      if (mountedRef.current) {
        setMediaEditError(errorMessageFromUnknown(err, "Could not save photos."));
      }
    } finally {
      if (mountedRef.current) setMediaEditBusy(false);
    }
  }, [supabase, post.id, mediaSlots, mediaNewFiles, runProtectedAction, onPostUpdated]);

  useEffect(() => {
    const anyOwnerModalOpen = tagsEditOpen || textEditOpen || mediaEditOpen;
    const ownerModalBusy = tagsEditBusy || textEditBusy || mediaEditBusy;
    if (!anyOwnerModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ownerModalBusy) return;
      if (tagsEditOpen) {
        setTagsEditOpen(false);
        setTagsEditError(null);
      }
      if (textEditOpen) {
        setTextEditOpen(false);
        setTextEditError(null);
      }
      if (mediaEditOpen) {
        setMediaEditOpen(false);
        setMediaEditError(null);
        setMediaNewFiles([]);
        setMediaDragActive(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tagsEditOpen,
    textEditOpen,
    mediaEditOpen,
    tagsEditBusy,
    textEditBusy,
    mediaEditBusy,
  ]);

  const quoteNestExpandProps = {
    maxVisibleDepth: QUOTE_NEST_MAX_INITIAL_DEPTH,
    chainExpanded: quoteChainExpanded,
    onExpandChain: () => setQuoteChainExpanded(true),
  } as const;

  const postTime = formatRelativePostTime(post.created_at);
  const effectiveNoteCommentCount = Math.max(0, post.note_comment_count + noteCommentAdjust);
  const handleThreadNoteCountDelta = useCallback((delta: number) => {
    setNoteCommentAdjust((prev) => prev + delta);
  }, []);
  const notesTriggerTotal =
    Math.max(0, likeCount) + Math.max(0, reblogCount) + effectiveNoteCommentCount;

  return (
    <article id={postElementDomId(post.id)} className="qrtz-card max-md:p-3">
      <div className="flex gap-2 sm:gap-3">
        <ProfileAvatar url={primaryAvatarUrl} label={primary} size="md" className="mt-px" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-semibold leading-snug max-md:leading-tight tracking-tight text-text">
            <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
              {primary}
            </ProfileUsernameLink>
          </p>
          {plainReblogBy ? (
            <p className="mt-0.5 max-md:mt-1 text-[0.8125rem] max-md:text-[0.75rem] leading-snug max-md:leading-normal text-text-secondary">
              <span className="font-normal text-text-muted max-md:text-text-muted/90">Reblogged by </span>
              <ProfileUsernameLink
                usernameRaw={plainReblogBy.primaryRaw}
                className="font-normal text-text-secondary hover:text-link"
              >
                @{plainReblogBy.primary}
              </ProfileUsernameLink>
            </p>
          ) : null}
          {plainReblogVia ? (
            <p
              className={`text-[0.8125rem] max-md:text-[0.75rem] leading-snug max-md:leading-normal text-text-secondary ${
                plainReblogBy ? "mt-0.5 max-md:mt-0.5" : "mt-0.5 max-md:mt-1"
              }`}
            >
              <span className="font-normal text-text-muted max-md:text-text-muted/90">via </span>
              <ProfileUsernameLink
                usernameRaw={plainReblogVia.primaryRaw}
                className="font-normal text-text-secondary hover:text-link"
              >
                @{plainReblogVia.primary}
              </ProfileUsernameLink>
            </p>
          ) : null}
          {post.homeFollowingMatchedTag ? (
            <p className="mt-1.5 max-md:mt-2 text-meta max-md:text-[0.6875rem] max-md:leading-snug text-text-muted max-md:text-text-muted/95">
              From tag you follow:{" "}
              <Link
                href={`/tag/${encodeURIComponent(post.homeFollowingMatchedTag)}`}
                className="font-medium text-link/90 hover:text-link-hover hover:underline"
              >
                #{post.homeFollowingMatchedTag}
              </Link>
            </p>
          ) : null}
          {ungatedCommentary ? (
            <div className={COMMENTARY_ADDED_LAYER_CLASS}>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-text">{ungatedCommentary}</p>
            </div>
          ) : quoteLayer && commentary ? (
            <div className={COMMENTARY_ADDED_LAYER_CLASS}>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-text">{commentary}</p>
            </div>
          ) : null}
          {nsfwFeedBodyHidden ? (
            <NsfwFeedContentWarning onReveal={() => setNsfwRevealed(true)} />
          ) : (
            <>
              {quoteOuterMedia && quoteOuterMedia.length > 0 ? (
                <PostMediaGallery
                  supabase={supabase}
                  normalizedImages={quoteOuterMedia}
                  variant="feed"
                  wrapperClassName="mt-2.5"
                />
              ) : null}
              {!isReblog ? (
                <>
                  <p className="mb-1.5 mt-2.5 whitespace-pre-wrap text-base leading-relaxed text-text">{post.content}</p>
                  <PostMediaGallery supabase={supabase} post={post} variant="feed" wrapperClassName="mt-2.5" />
                </>
              ) : null}
              {plainResolved?.kind === "flat" ? (
                <>
                  {plainResolved.leaf.content ? (
                    <p className="mb-1.5 mt-2.5 whitespace-pre-wrap text-base leading-relaxed text-text">{plainResolved.leaf.content}</p>
                  ) : null}
                  <PostMediaGallery
                    supabase={supabase}
                    post={plainResolved.leaf}
                    variant="feed"
                    wrapperClassName="mt-2.5"
                  />
                </>
              ) : null}
              {plainResolved?.kind === "quoted" ? (
                <>
                  {plainResolved.node.reblog_commentary?.trim() &&
                  !(ungatedCommentary && plainResolved.node.reblog_commentary.trim() === ungatedCommentary) ? (
                    <div className={COMMENTARY_ADDED_LAYER_CLASS}>
                      <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-text">
                        {plainResolved.node.reblog_commentary.trim()}
                      </p>
                    </div>
                  ) : null}
                  {plainResolved.node.quoted_post ? (
                    <div className={QUOTED_BLOCK_FRAME_CLASS}>
                      <QuotedPostNest
                        node={plainResolved.node.quoted_post}
                        depth={0}
                        supabase={supabase}
                        {...quoteNestExpandProps}
                      />
                    </div>
                  ) : (
                    <div className={QUOTED_BLOCK_FRAME_CLASS}>
                      <QuotedPostNest node={plainResolved.node} depth={0} supabase={supabase} {...quoteNestExpandProps} />
                    </div>
                  )}
                </>
              ) : null}
              {showFlatReblogFallback ? (
                <>
                  {fallbackBody.content ? (
                    <p className="mb-1.5 mt-2.5 whitespace-pre-wrap text-base leading-relaxed text-text">{fallbackBody.content}</p>
                  ) : null}
                  <PostMediaGallery
                    supabase={supabase}
                    post={{
                      image_url: fallbackBody.imageSrc,
                      image_storage_path: fallbackBody.image_storage_path,
                    }}
                    variant="feed"
                    wrapperClassName="mt-2.5"
                  />
                  <p className="mt-1.5 text-meta text-text-secondary">Quote chain could not be fully loaded.</p>
                </>
              ) : null}
              {showNestedQuote && post.quoted_post ? (
                <div className={QUOTED_BLOCK_FRAME_CLASS}>
                  <QuotedPostNest node={post.quoted_post} depth={0} supabase={supabase} {...quoteNestExpandProps} />
                </div>
              ) : null}
            </>
          )}
          {tags.length > 0 ? (
            <ul className="mt-2.5 max-md:mt-2 flex list-none flex-wrap gap-1.5 max-md:gap-1 p-0">
              {tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/tag/${encodeURIComponent(t)}`}
                    className={`${TAG_CHIP_BASE} ${TAG_CHIP_MOBILE_SHELL} ${
                      highlightSet?.has(t)
                        ? `${TAG_CHIP_HIGHLIGHT} ${TAG_CHIP_HIGHLIGHT_MOBILE_SOFT}`
                        : `${TAG_CHIP_DEFAULT} ${TAG_CHIP_DEFAULT_MOBILE_SOFT}`
                    }`}
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <InlineErrorBanner
            message={likeError}
            onDismiss={dismissLikeError}
            className="mt-2.5"
          />
          <InlineErrorBanner
            message={deleteError}
            onDismiss={() => setDeleteError(null)}
            className="mt-2.5"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 max-md:gap-x-1.5 max-md:gap-y-1 sm:mt-3 sm:gap-x-2.5">
              <time
                dateTime={post.created_at}
                title={postTime.full}
                aria-label={postTime.full}
                className="max-w-[11rem] max-md:max-w-[9.25rem] shrink-0 truncate text-left text-meta max-md:text-[0.6875rem] font-medium tabular-nums tracking-tight text-text-secondary max-md:tracking-normal"
              >
                {postTime.label}
              </time>
              {showNsfwUnGatedBadge ? (
                <span
                  className="shrink-0 rounded-full border border-border/60 bg-bg-secondary/65 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-text-muted dark:border-border/50 dark:bg-bg-secondary/80"
                  title="Mature content"
                  aria-label="Mature content (NSFW)"
                >
                  NSFW
                </span>
              ) : null}
              <span className="mx-0.5 max-md:mx-0 h-3 w-px shrink-0 bg-border/50" aria-hidden />
              <div className="flex min-h-[1.5rem] flex-wrap items-center gap-x-2 gap-y-0.5 sm:gap-x-3">
                <button
                  type="button"
                  disabled={!currentUserId || likeBusy}
                  onClick={() => void toggleLike()}
                  className={`inline-flex min-h-[1.75rem] min-w-0 touch-manipulation select-none items-center justify-center gap-1.5 rounded-md px-1.5 py-0.5 text-meta font-medium tabular-nums transition-[color,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0 active:scale-95 disabled:pointer-events-none ${LIKE_ACTION_ROW_COMPACT} ${
                    !currentUserId ? "cursor-not-allowed disabled:opacity-45" : "disabled:opacity-100"
                  } ${likeBusy ? "cursor-wait" : currentUserId ? "cursor-pointer" : ""} ${
                    liked ? "text-accent-pink" : "text-text-secondary hover:text-text"
                  }`}
                  aria-pressed={liked}
                  aria-busy={likeBusy}
                  aria-label={currentUserId ? (liked ? "Unlike" : "Like") : "Sign in to like"}
                  title={currentUserId ? undefined : "Sign in to like"}
                >
                  <span
                    className={`inline-flex h-4 w-4 origin-center items-center justify-center will-change-transform ${
                      liked
                        ? "scale-110 transition-transform duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
                        : "scale-100 transition-transform duration-200 ease-out"
                    }`}
                    aria-hidden
                  >
                    <HeartIcon active={liked} className={ICON_BOX} />
                  </span>
                  <span className={STAT_COUNT_CLASS}>{Math.max(0, likeCount)}</span>
                </button>
                <span
                  className={`inline-flex items-center justify-center gap-1.5 px-0.5 py-0.5 text-meta font-medium tabular-nums text-text-secondary ${REBLOG_STAT_ROW_COMPACT}`}
                  title="Reblogs on this thread"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-text-secondary" aria-hidden>
                    <RepostStatIcon className={ICON_BOX} />
                  </span>
                  <span className={STAT_COUNT_CLASS}>{reblogCount}</span>
                </span>
                <button
                  type="button"
                  disabled={!supabase}
                  onClick={() => setNotesModalOpen(true)}
                  className={`${REBLOG_ACTION_CLASS} ${REBLOG_ACTION_ROW_COMPACT} touch-manipulation select-none disabled:pointer-events-none disabled:opacity-45`}
                  aria-haspopup="dialog"
                  aria-expanded={notesModalOpen}
                  aria-label={`View notes${notesTriggerTotal ? ` (${notesTriggerTotal})` : ""}`}
                  title={!supabase ? "Notes unavailable" : undefined}
                >
                  <span className="tabular-nums">
                    {notesTriggerTotal} {notesTriggerTotal === 1 ? "note" : "notes"}
                  </span>
                </button>
              </div>
              {showReblog ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 max-md:gap-x-1 sm:ml-0.5">
                  <button
                    type="button"
                    disabled={rebloggingId !== null}
                    onClick={() => {
                      setReblogModalError(null);
                      void onReblog(post, null);
                    }}
                    className={`${REBLOG_ACTION_CLASS} ${REBLOG_ACTION_ROW_COMPACT} touch-manipulation select-none ${
                      rebloggingId === post.id
                        ? "cursor-wait bg-bg-secondary/50 opacity-90 ring-1 ring-border/45"
                        : "cursor-pointer"
                    }`}
                    aria-busy={rebloggingId === post.id}
                    aria-label={rebloggingId === post.id ? "Reblogging" : "Reblog"}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center shrink-0" aria-hidden>
                      <RepostStatIcon className={ICON_BOX} />
                    </span>
                    <span>{rebloggingId === post.id ? "Reblogging…" : "Reblog"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={rebloggingId !== null || reblogModalBusy}
                    onClick={() => {
                      setReblogModalError(null);
                      setReblogModalPost(post);
                    }}
                    className={`${REBLOG_ACTION_CLASS} ${REBLOG_ACTION_ROW_COMPACT} touch-manipulation select-none ${
                      reblogModalBusy
                        ? "cursor-wait bg-bg-secondary/50 opacity-90 ring-1 ring-border/45"
                        : "cursor-pointer"
                    }`}
                    aria-busy={reblogModalBusy}
                    aria-label="Quote with commentary"
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center shrink-0" aria-hidden>
                      <QuoteBubbleIcon className={ICON_BOX} />
                    </span>
                    <span>Quote</span>
                  </button>
                </span>
              ) : null}
              {isOwner ? (
                <div className="ml-auto shrink-0">
                  <details
                    ref={ownerMenuRef}
                    className={`group relative ${ownerActionBusy ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <summary
                      className={`${REBLOG_ACTION_CLASS} ${REBLOG_ACTION_ROW_COMPACT} list-none [&::-webkit-details-marker]:hidden ${
                        ownerActionBusy ? "cursor-not-allowed" : "cursor-pointer"
                      }`}
                      aria-label="Post options"
                      aria-busy={ownerActionBusy}
                    >
                      <span
                        aria-hidden
                        className="text-lg leading-none tracking-tight max-md:text-base max-md:text-text-secondary/85"
                      >
                        ⋯
                      </span>
                    </summary>
                    <div
                      className="absolute right-0 top-full z-10 mt-1 min-w-[9.5rem] rounded-md border border-border/60 bg-bg-secondary py-1 shadow-md"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={ownerActionBusy || !supabase}
                        className="w-full px-3 py-1.5 text-left text-sm font-medium text-text hover:bg-bg-secondary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 disabled:opacity-50"
                        onClick={handleOpenEditTags}
                      >
                        Edit tags
                      </button>
                      {canEditPostText ? (
                        <button
                          type="button"
                          disabled={ownerActionBusy || !supabase}
                          className="w-full px-3 py-1.5 text-left text-sm font-medium text-text hover:bg-bg-secondary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 disabled:opacity-50"
                          onClick={handleOpenEditText}
                        >
                          Edit text
                        </button>
                      ) : null}
                      {canEditPostMedia ? (
                        <button
                          type="button"
                          disabled={ownerActionBusy || !supabase}
                          className="w-full px-3 py-1.5 text-left text-sm font-medium text-text hover:bg-bg-secondary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 disabled:opacity-50"
                          onClick={handleOpenEditMedia}
                        >
                          Edit photos
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={ownerActionBusy || !supabase}
                        className="w-full px-3 py-1.5 text-left text-sm font-medium text-error hover:bg-error/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 disabled:opacity-50"
                        onClick={() => void handleOwnerDelete()}
                      >
                        {deleteBusy ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </details>
                </div>
              ) : null}
          </div>
        </div>
      </div>
      <PostNotesModal
        open={notesModalOpen}
        onClose={() => setNotesModalOpen(false)}
        supabase={supabase}
        currentUserId={currentUserId}
        threadRootPostId={threadRootPostId(post)}
        onThreadNoteCountDelta={handleThreadNoteCountDelta}
      />
      <ReblogModal
        post={reblogModalPost}
        busy={reblogModalBusy}
        errorMessage={reblogModalError}
        onDismissError={() => setReblogModalError(null)}
        onClose={() => {
          if (reblogModalBusy) return;
          setReblogModalError(null);
          setReblogModalPost(null);
        }}
        onConfirm={async (raw) => {
          if (!reblogModalPost) return;
          const trimmed = raw.trim();
          const guard = validateUserWrittenContent(trimmed, { allowEmpty: true });
          if (!guard.ok) {
            setReblogModalError(guard.message);
            return;
          }
          setReblogModalError(null);
          setReblogModalBusy(true);
          try {
            const ok = await onReblog(reblogModalPost, trimmed.length > 0 ? trimmed : null);
            if (ok && trimmed.length > 0) {
              recordSuccessfulUserWrittenPost(normalizePostBodyForDedup(trimmed));
            }
            if (ok) setReblogModalPost(null);
          } finally {
            setReblogModalBusy(false);
          }
        }}
      />
      {tagsEditOpen ? (
        <div
          className="qrtz-modal-overlay"
          onClick={() => !tagsEditBusy && setTagsEditOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-tags-title"
            onClick={(e) => e.stopPropagation()}
            className="qrtz-modal-panel max-w-md"
          >
            <h2 id="edit-tags-title" className="mb-2 font-heading text-lg font-semibold text-text">
              Edit tags
            </h2>
            <p className="mb-2 text-meta text-text-muted">Comma-separated. Empty removes all tags on this post.</p>
            <label htmlFor="edit-tags-input" className="mb-1 block text-meta font-medium text-text-secondary">
              Tags
            </label>
            <input
              id="edit-tags-input"
              type="text"
              value={tagsDraft}
              onChange={(e) => {
                setTagsDraft(e.target.value);
                if (tagsEditError) setTagsEditError(null);
              }}
              disabled={tagsEditBusy}
              className="qrtz-field mb-2 w-full py-2 text-sm"
              placeholder="e.g. photo, weekend"
              autoComplete="off"
            />
            <InlineErrorBanner
              message={tagsEditError}
              onDismiss={() => setTagsEditError(null)}
              className="mb-3"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={tagsEditBusy}
                className="qrtz-btn-secondary px-3 py-1.5 text-sm"
                onClick={() => {
                  if (tagsEditBusy) return;
                  setTagsEditOpen(false);
                  setTagsEditError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={tagsEditBusy}
                className="qrtz-btn-primary px-3 py-1.5 text-sm"
                onClick={() => void handleSaveTags()}
              >
                {tagsEditBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {textEditOpen ? (
        <div
          className="qrtz-modal-overlay"
          onClick={() => !textEditBusy && setTextEditOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-text-title"
            onClick={(e) => e.stopPropagation()}
            className="qrtz-modal-panel max-w-md"
          >
            <h2 id="edit-text-title" className="mb-2 font-heading text-lg font-semibold text-text">
              {hasReblogParent ? "Edit commentary" : "Edit post text"}
            </h2>
            <label htmlFor="edit-text-area" className="mb-1 block text-meta font-medium text-text-secondary">
              {hasReblogParent ? "Commentary" : "Content"}
            </label>
            <textarea
              id="edit-text-area"
              value={textDraft}
              onChange={(e) => {
                setTextDraft(e.target.value);
                if (textEditError) setTextEditError(null);
              }}
              disabled={textEditBusy}
              rows={6}
              className="qrtz-field mb-2 min-h-[120px] w-full resize-y py-2 text-sm leading-relaxed"
              autoComplete="off"
            />
            <InlineErrorBanner
              message={textEditError}
              onDismiss={() => setTextEditError(null)}
              className="mb-3"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={textEditBusy}
                className="qrtz-btn-secondary px-3 py-1.5 text-sm"
                onClick={() => {
                  if (textEditBusy) return;
                  setTextEditOpen(false);
                  setTextEditError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={textEditBusy}
                className="qrtz-btn-primary px-3 py-1.5 text-sm"
                onClick={() => void handleSaveText()}
              >
                {textEditBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {mediaEditOpen && supabase ? (
        <div
          className="qrtz-modal-overlay"
          onClick={() => !mediaEditBusy && setMediaEditOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-media-title"
            onClick={(e) => e.stopPropagation()}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMediaDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMediaDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMediaDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMediaDragActive(false);
              if (mediaEditBusy) return;
              const cap = MAX_POST_IMAGES - mediaSlots.length - mediaNewFiles.length;
              if (cap <= 0) return;
              addMediaFiles(Array.from(e.dataTransfer.files ?? []).slice(0, cap));
            }}
            className="qrtz-modal-panel max-w-md"
          >
            <h2 id="edit-media-title" className="mb-2 font-heading text-lg font-semibold text-text">
              Edit photos
            </h2>
            <p className="mb-2 text-meta text-text-muted">
              Up to {MAX_POST_IMAGES} images. Remove photos here or add new ones; inherited images from another blog must be
              removed before you can add your own.
            </p>
            {mediaSlots.length > 0 || mediaNewFiles.length > 0 ? (
              <ul className="mb-2 flex list-none flex-wrap gap-1.5 p-0">
                {mediaSlots.map((slot, idx) => (
                  <li
                    key={slot.kind === "row" ? slot.rowId : `legacy-${slot.path}-${idx}`}
                    className="contents"
                  >
                    <MediaEditExistingThumb
                      supabase={supabase}
                      path={slot.path}
                      removeDisabled={mediaEditBusy}
                      onRemove={() =>
                        setMediaSlots((prev) => prev.filter((_, i) => i !== idx))
                      }
                    />
                  </li>
                ))}
                {mediaNewFiles.map((f, idx) => (
                  <li key={`${f.name}-${idx}-${f.size}`} className="contents">
                    <MediaEditNewThumb
                      file={f}
                      removeDisabled={mediaEditBusy}
                      onRemove={() =>
                        setMediaNewFiles((prev) => prev.filter((_, i) => i !== idx))
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-meta text-text-muted">No images on this post yet.</p>
            )}
            <input
              ref={mediaFileInputRef}
              type="file"
              accept={ACCEPT_IMAGE_ATTR}
              multiple
              className="sr-only"
              aria-label="Add images"
              disabled={mediaEditBusy || mediaSlots.length + mediaNewFiles.length >= MAX_POST_IMAGES}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!files.length) return;
                const cap = MAX_POST_IMAGES - mediaSlots.length - mediaNewFiles.length;
                addMediaFiles(files.slice(0, Math.max(0, cap)));
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!mediaEditBusy && mediaSlots.length + mediaNewFiles.length < MAX_POST_IMAGES) {
                    mediaFileInputRef.current?.click();
                  }
                }
              }}
              onClick={() => {
                if (mediaEditBusy || mediaSlots.length + mediaNewFiles.length >= MAX_POST_IMAGES) return;
                mediaFileInputRef.current?.click();
              }}
              className={`cursor-pointer rounded-lg border border-dashed px-3 py-2 text-center text-meta transition-colors ${
                mediaDragActive ? "border-accent-aqua/50 bg-surface-blue/35" : "border-border/55 bg-bg-secondary/30"
              } ${mediaEditBusy || mediaSlots.length + mediaNewFiles.length >= MAX_POST_IMAGES ? "pointer-events-none opacity-50" : ""}`}
            >
              {mediaSlots.length + mediaNewFiles.length >= MAX_POST_IMAGES ? (
                <span className="text-text-muted">Maximum {MAX_POST_IMAGES} images.</span>
              ) : (
                <span className="text-text-secondary">Drop images here or click to add</span>
              )}
            </div>
            <InlineErrorBanner
              message={mediaEditError}
              onDismiss={() => setMediaEditError(null)}
              className="mb-3 mt-3"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={mediaEditBusy}
                className="qrtz-btn-secondary px-3 py-1.5 text-sm"
                onClick={() => {
                  if (mediaEditBusy) return;
                  setMediaEditOpen(false);
                  setMediaEditError(null);
                  setMediaNewFiles([]);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mediaEditBusy}
                className="qrtz-btn-primary px-3 py-1.5 text-sm"
                onClick={() => void handleSaveMedia()}
              >
                {mediaEditBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
