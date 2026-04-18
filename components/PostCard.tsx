"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { threadRootPostId } from "@/lib/post-thread-root";
import type { FeedPost } from "@/types/post";
import { displayTagsForPost } from "@/lib/tags";
import {
  bodyFromPost,
  formatPostTime,
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
import ReblogModal from "./ReblogModal";
import { usePostLikeToggle } from "./usePostLikeToggle";

/** Scan-friendly relative / compact labels; full stamp stays in `title` / `aria-label` via `formatPostTime`. */
function postTimestampPresentation(iso: string): { label: string; full: string } {
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

type Props = {
  post: FeedPost;
  rebloggingId: string | null;
  onReblog: (post: FeedPost, commentary?: string | null) => boolean | Promise<boolean>;
  showReblog?: boolean;
  supabase: SupabaseClient | null;
  currentUserId: string | null;
};

export default function PostCard({
  post,
  rebloggingId,
  onReblog,
  showReblog = true,
  supabase,
  currentUserId,
}: Props) {
  const [reblogModalPost, setReblogModalPost] = useState<FeedPost | null>(null);
  const [reblogModalBusy, setReblogModalBusy] = useState(false);
  const [reblogModalError, setReblogModalError] = useState<string | null>(null);
  const [reblogCount, setReblogCount] = useState(() => Math.max(0, post.reblog_count));
  const [quoteChainExpanded, setQuoteChainExpanded] = useState(false);

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
    setQuoteChainExpanded(false);
  }, [post.id]);
  const header = postCardHeaderProfile(post);
  const { primary, primaryRaw, primaryAvatarUrl } = header;
  const isReblog = Boolean(post.reblog_of?.trim());
  const quoteLayer = hasQuoteReblogLayer(post);
  const plainResolved = resolvePlainReblogDisplay(post);
  const fallbackBody = bodyFromPost(post);
  const tags = displayTagsForPost(post);
  const commentary = post.reblog_commentary?.trim() || null;
  const quoteOuterMedia = quoteLayerOuterMedia(post);
  const showNestedQuote = Boolean(quoteLayer && post.quoted_post);
  const showFlatReblogFallback = Boolean(isReblog && !post.quoted_post);
  const plainReblogBy = plainReblogAttributionProfile(post);
  const plainReblogVia = plainReblogViaProfile(post);

  const quoteNestExpandProps = {
    maxVisibleDepth: QUOTE_NEST_MAX_INITIAL_DEPTH,
    chainExpanded: quoteChainExpanded,
    onExpandChain: () => setQuoteChainExpanded(true),
  } as const;

  const postTime = postTimestampPresentation(post.created_at);

  return (
    <article className="qrtz-card">
      <div className="flex gap-2.5 sm:gap-3">
        <ProfileAvatar url={primaryAvatarUrl} label={primary} size="md" className="mt-px" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-semibold leading-snug tracking-tight text-text">
            <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
              {primary}
            </ProfileUsernameLink>
          </p>
          {plainReblogBy ? (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-text-secondary">
              <span className="font-normal text-text-muted">Reblogged by </span>
              <ProfileUsernameLink
                usernameRaw={plainReblogBy.primaryRaw}
                className="font-normal text-text-secondary hover:text-link"
              >
                @{plainReblogBy.primary}
              </ProfileUsernameLink>
            </p>
          ) : null}
          {plainReblogVia ? (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-text-secondary">
              <span className="font-normal text-text-muted">via </span>
              <ProfileUsernameLink
                usernameRaw={plainReblogVia.primaryRaw}
                className="font-normal text-text-secondary hover:text-link"
              >
                @{plainReblogVia.primary}
              </ProfileUsernameLink>
            </p>
          ) : null}
          {quoteLayer && commentary ? (
            <div className={COMMENTARY_ADDED_LAYER_CLASS}>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-text">{commentary}</p>
            </div>
          ) : null}
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
              {plainResolved.node.reblog_commentary?.trim() ? (
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
          {tags.length > 0 ? (
            <ul className="mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
              {tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/tag/${encodeURIComponent(t)}`}
                    className="inline-block rounded-full border border-border bg-bg-secondary px-2 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:border-accent-purple/45 hover:text-link focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0"
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
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-2.5">
              <time
                dateTime={post.created_at}
                title={postTime.full}
                aria-label={postTime.full}
                className="max-w-[11rem] shrink-0 truncate text-left text-meta font-medium tabular-nums tracking-tight text-text-secondary"
              >
                {postTime.label}
              </time>
              <span className="mx-0.5 h-3 w-px shrink-0 bg-border/50" aria-hidden />
              <div className="flex min-h-[1.5rem] flex-wrap items-center gap-x-3 gap-y-0.5">
                <button
                  type="button"
                  disabled={!currentUserId || likeBusy}
                  onClick={() => void toggleLike()}
                  className={`inline-flex min-h-[1.75rem] min-w-0 touch-manipulation select-none items-center justify-center gap-1.5 rounded-md px-1.5 py-0.5 text-meta font-medium tabular-nums transition-[color,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0 active:scale-95 disabled:pointer-events-none ${
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
                  className="inline-flex items-center justify-center gap-1.5 px-0.5 py-0.5 text-meta font-medium tabular-nums text-text-secondary"
                  title="Reblogs on this thread"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-text-secondary" aria-hidden>
                    <RepostStatIcon className={ICON_BOX} />
                  </span>
                  <span className={STAT_COUNT_CLASS}>{reblogCount}</span>
                </span>
              </div>
              {showReblog ? (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:ml-0.5">
                  <button
                    type="button"
                    disabled={rebloggingId !== null}
                    onClick={() => {
                      setReblogModalError(null);
                      void onReblog(post, null);
                    }}
                    className={`${REBLOG_ACTION_CLASS} touch-manipulation select-none ${
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
                    className={`${REBLOG_ACTION_CLASS} touch-manipulation select-none ${
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
          </div>
        </div>
      </div>
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
    </article>
  );
}
