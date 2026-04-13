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
  quoteLayerOuterImageUrl,
  resolvePlainReblogDisplay,
} from "@/lib/feed-post-display";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";
import {
  normalizePostBodyForDedup,
  recordSuccessfulUserWrittenPost,
  validateUserWrittenContent,
} from "@/lib/post-content-guard";
import { InlineErrorBanner } from "./InlineErrorBanner";
import QuotedPostNest from "./QuotedPostNest";
import ReblogModal from "./ReblogModal";
import { usePostLikeToggle } from "./usePostLikeToggle";

const ICON_BOX = "h-4 w-4 shrink-0";

function HeartIcon({ active, className }: { active: boolean; className?: string }) {
  if (active) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    );
  }
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

const REBLOG_ACTION_CLASS =
  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:text-primary-hover transition-colors disabled:pointer-events-none disabled:opacity-50";

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
  const quoteOuterImage = quoteLayerOuterImageUrl(post);
  const showNestedQuote = Boolean(quoteLayer && post.quoted_post);
  const showFlatReblogFallback = Boolean(isReblog && !post.quoted_post);
  const plainReblogBy = plainReblogAttributionProfile(post);
  const plainReblogVia = plainReblogViaProfile(post);

  const quoteNestExpandProps = {
    maxVisibleDepth: QUOTE_NEST_MAX_INITIAL_DEPTH,
    chainExpanded: quoteChainExpanded,
    onExpandChain: () => setQuoteChainExpanded(true),
  } as const;

  return (
    <article className="bg-surface rounded-lg shadow-sm border border-border p-4">
      <div className="flex gap-3">
        <ProfileAvatar url={primaryAvatarUrl} label={primary} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-text">
            <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
              {primary}
            </ProfileUsernameLink>
          </p>
          {plainReblogBy ? (
            <p className="mt-1 text-xs text-text-muted leading-snug">
              <span className="text-text-muted/90">Reblogged by </span>
              <ProfileUsernameLink
                usernameRaw={plainReblogBy.primaryRaw}
                className="font-medium text-text-muted hover:text-primary"
              >
                @{plainReblogBy.primary}
              </ProfileUsernameLink>
            </p>
          ) : null}
          {plainReblogVia ? (
            <p className="mt-0.5 text-xs text-text-muted/85 leading-snug">
              <span className="text-text-muted/75">via </span>
              <ProfileUsernameLink
                usernameRaw={plainReblogVia.primaryRaw}
                className="font-medium text-text-muted hover:text-primary"
              >
                @{plainReblogVia.primary}
              </ProfileUsernameLink>
            </p>
          ) : null}
          {quoteLayer && commentary ? (
            <p className="mt-2 text-sm text-text whitespace-pre-wrap leading-relaxed">{commentary}</p>
          ) : null}
          {quoteOuterImage ? (
            <img
              src={quoteOuterImage}
              alt="Post image"
              loading="lazy"
              decoding="async"
              className="mt-3 rounded-xl max-h-[500px] w-full object-cover"
            />
          ) : null}
          {!isReblog ? (
            <>
              <p className="text-text mt-3 mb-2 whitespace-pre-wrap">{post.content}</p>
              {post.image_url?.trim() ? (
                <img
                  src={post.image_url.trim()}
                  alt="Post image"
                  loading="lazy"
                  decoding="async"
                  className="mt-3 rounded-xl max-h-[500px] w-full object-cover"
                />
              ) : null}
            </>
          ) : null}
          {plainResolved?.kind === "flat" ? (
            <>
              {plainResolved.leaf.content ? (
                <p className="text-text mt-3 mb-2 whitespace-pre-wrap">{plainResolved.leaf.content}</p>
              ) : null}
              {plainResolved.leaf.image_url?.trim() ? (
                <img
                  src={plainResolved.leaf.image_url.trim()}
                  alt="Post image"
                  loading="lazy"
                  decoding="async"
                  className="mt-3 rounded-xl max-h-[500px] w-full object-cover"
                />
              ) : null}
            </>
          ) : null}
          {plainResolved?.kind === "quoted" ? (
            <>
              {plainResolved.node.reblog_commentary?.trim() ? (
                <p className="mt-2 text-sm text-text whitespace-pre-wrap leading-relaxed">
                  {plainResolved.node.reblog_commentary.trim()}
                </p>
              ) : null}
              {plainResolved.node.quoted_post ? (
                <QuotedPostNest node={plainResolved.node.quoted_post} depth={0} {...quoteNestExpandProps} />
              ) : (
                <QuotedPostNest node={plainResolved.node} depth={0} {...quoteNestExpandProps} />
              )}
            </>
          ) : null}
          {showFlatReblogFallback ? (
            <>
              {fallbackBody.content ? (
                <p className="text-text mt-3 mb-2 whitespace-pre-wrap">{fallbackBody.content}</p>
              ) : null}
              {fallbackBody.imageSrc ? (
                <img
                  src={fallbackBody.imageSrc}
                  alt="Post image"
                  loading="lazy"
                  decoding="async"
                  className="mt-3 rounded-xl max-h-[500px] w-full object-cover"
                />
              ) : null}
              <p className="mt-2 text-xs text-text-muted">Quote chain could not be fully loaded.</p>
            </>
          ) : null}
          {showNestedQuote && post.quoted_post ? (
            <QuotedPostNest node={post.quoted_post} depth={0} {...quoteNestExpandProps} />
          ) : null}
          {tags.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2 list-none p-0">
              {tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`/tag/${encodeURIComponent(t)}`}
                    className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary text-text hover:bg-border-soft transition-colors"
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
            className="mt-3"
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-3">
              <p className="text-xs text-text-muted tabular-nums shrink-0">
                {formatPostTime(post.created_at)}
              </p>
              <span className="hidden sm:inline text-border-soft select-none" aria-hidden>
                ·
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-h-[1.75rem]">
                <button
                  type="button"
                  disabled={!currentUserId || likeBusy}
                  onClick={() => void toggleLike()}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                    liked ? "text-error" : "text-text-muted hover:text-text"
                  } ${likeBusy ? "cursor-wait" : "cursor-pointer"}`}
                  aria-pressed={liked}
                  aria-busy={likeBusy}
                  aria-label={currentUserId ? (liked ? "Unlike" : "Like") : "Sign in to like"}
                  title={currentUserId ? undefined : "Sign in to like"}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden>
                    <HeartIcon active={liked} className={ICON_BOX} />
                  </span>
                  <span className="min-w-[1ch] text-left">{Math.max(0, likeCount)}</span>
                </button>
                <span
                  className="inline-flex items-center justify-center gap-1.5 px-0.5 py-1 text-xs font-medium tabular-nums text-text-muted"
                  title="Reblogs on this thread"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center text-text-muted" aria-hidden>
                    <RepostStatIcon className={ICON_BOX} />
                  </span>
                  <span className="min-w-[1ch]">{reblogCount}</span>
                </span>
              </div>
              {showReblog ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 sm:ml-0.5">
                  <button
                    type="button"
                    disabled={rebloggingId !== null}
                    onClick={() => {
                      setReblogModalError(null);
                      void onReblog(post, null);
                    }}
                    className={`${REBLOG_ACTION_CLASS} ${rebloggingId === post.id ? "cursor-wait" : "cursor-pointer"}`}
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
                    className={`${REBLOG_ACTION_CLASS} ${reblogModalBusy ? "cursor-wait" : "cursor-pointer"}`}
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
