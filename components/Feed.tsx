"use client";

import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NsfwFeedMode } from "@/lib/nsfw-feed-preference";
import type { FeedPost } from "@/types/post";
import FeedPullIndicator from "./FeedPullIndicator";
import PostCard from "./PostCard";
import type { ReblogActionHandler } from "./useReblogAction";
import { useFeedPullToRefresh } from "./useFeedPullToRefresh";

type Props = {
  posts: FeedPost[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onReblog: ReblogActionHandler;
  /** Default for “Mark this reblog as mature” when opening the modal (SFW sources only). */
  viewerDefaultPostsNsfw?: boolean;
  showReblog?: boolean;
  supabase: SupabaseClient | null;
  currentUserId: string | null;
  /** Optional copy when there are no posts (e.g. search vs home). */
  emptyTitle?: React.ReactNode;
  emptyDescription?: React.ReactNode;
  /** Normalized tag strings to emphasize on each card (e.g. search tag filters). */
  postSearchHighlightTags?: string[];
  /** Called after the viewer successfully deletes their own post (refetch / sync parent state). */
  onPostDeleted?: () => void | Promise<void>;
  /** Called after the viewer successfully updates their own post (e.g. tags). */
  onPostUpdated?: () => void | Promise<void>;
  /** Home / Explore / Search: controls NSFW tap-to-view; omit for profile/tag (defaults to warn). */
  nsfwFeedMode?: NsfwFeedMode;
  /** When true, show a footer control to fetch the next page (Explore pagination). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Mobile pull-to-refresh: reload page 1 (document must be scrolled to top). */
  onRefresh?: () => Promise<void> | void;
};

const FEED_SKELETON_KEYS = ["feed-sk-0", "feed-sk-1", "feed-sk-2"] as const;

/** Outer width + horizontal padding; keeps the column centered and stable on desktop. */
const FEED_OUTER = "mx-auto w-full max-w-3xl px-3 sm:px-6";

/** Vertical rhythm between cards — slightly tighter on phone, unchanged from `md` up. */
const FEED_STACK_GAP = "gap-2 max-md:gap-1.5";

/** Soft rail behind posts; child selectors only soften PostCard edges (no PostCard edits). */
const FEED_STREAM =
  "rounded-2xl bg-bg-secondary/20 p-0.5 sm:p-1.5 dark:bg-bg-secondary/30 [&>article]:border-border/40 [&>article]:shadow-none";

type FeedShellProps = {
  active: boolean;
  indicatorHeight: number;
  pullDistance: number;
  refreshing: boolean;
  readyToRefresh: boolean;
  isTouching: boolean;
  children: React.ReactNode;
};

function FeedShell({
  active,
  indicatorHeight,
  pullDistance,
  refreshing,
  readyToRefresh,
  isTouching,
  children,
}: FeedShellProps) {
  const translateY = active && (pullDistance > 0 || refreshing) ? pullDistance : 0;
  const transitionClass =
    active && !isTouching && !refreshing
      ? "transition-transform duration-200 ease-out motion-reduce:transition-none"
      : "";

  return (
    <div className={FEED_OUTER}>
      {active ? (
        <FeedPullIndicator
          height={indicatorHeight}
          refreshing={refreshing}
          readyToRefresh={readyToRefresh}
        />
      ) : null}
      <div
        className={transitionClass}
        style={active ? { transform: `translateY(${translateY}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

const Feed: React.FC<Props> = ({
  posts,
  loading,
  error,
  onRetry,
  onReblog,
  showReblog = true,
  supabase,
  currentUserId,
  emptyTitle = "This feed is open",
  emptyDescription = "Nothing is rolling through yet. Share a post and it will land here.",
  postSearchHighlightTags,
  onPostDeleted,
  onPostUpdated,
  nsfwFeedMode,
  viewerDefaultPostsNsfw = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRefresh,
}) => {
  const [rebloggingId, setRebloggingId] = useState<string | null>(null);
  const { active, pullDistance, indicatorHeight, refreshing, isTouching, readyToRefresh } =
    useFeedPullToRefresh(onRefresh);

  if (loading && posts.length === 0) {
    return (
      <FeedShell
        active={active}
        indicatorHeight={indicatorHeight}
        pullDistance={pullDistance}
        refreshing={refreshing}
        readyToRefresh={readyToRefresh}
        isTouching={isTouching}
      >
        <div
          className={`flex flex-col ${FEED_STACK_GAP}`}
          role="status"
          aria-busy="true"
          aria-label="Loading posts"
        >
          <div className={`flex flex-col ${FEED_STACK_GAP} ${FEED_STREAM}`}>
            {FEED_SKELETON_KEYS.map((key) => (
              <article key={key} className="qrtz-card max-md:p-3 animate-pulse">
                <div className="flex gap-2 sm:gap-3">
                  <div
                    className="mt-px h-10 w-10 shrink-0 rounded-full bg-bg-secondary ring-1 ring-border/40"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-36 max-w-[55%] rounded-md bg-bg-secondary" aria-hidden />
                    <div className="h-3 w-28 max-w-[40%] rounded-md bg-bg-secondary/75" aria-hidden />
                    <div className="space-y-2 pt-0.5" aria-hidden>
                      <div className="h-3 w-full rounded-md bg-bg-secondary/90" />
                      <div className="h-3 w-[94%] rounded-md bg-bg-secondary/80" />
                      <div className="h-3 w-[68%] rounded-md bg-bg-secondary/70" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-1.5" aria-hidden>
                      <div className="h-3 w-14 rounded bg-bg-secondary/60" />
                      <div className="h-3 w-10 rounded bg-bg-secondary/55" />
                      <div className="h-3 w-16 rounded bg-bg-secondary/50" />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </FeedShell>
    );
  }

  if (error) {
    return (
      <FeedShell
        active={active}
        indicatorHeight={indicatorHeight}
        pullDistance={pullDistance}
        refreshing={refreshing}
        readyToRefresh={readyToRefresh}
        isTouching={isTouching}
      >
        <div className="flex flex-col gap-2 rounded-card border border-error/30 bg-error/10 p-4 text-sm text-text">
          <p>{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="text-left underline font-medium text-link hover:text-link-hover"
          >
            Try again
          </button>
        </div>
      </FeedShell>
    );
  }

  if (posts.length === 0) {
    return (
      <FeedShell
        active={active}
        indicatorHeight={indicatorHeight}
        pullDistance={pullDistance}
        refreshing={refreshing}
        readyToRefresh={readyToRefresh}
        isTouching={isTouching}
      >
        <div className="rounded-xl border border-border/60 bg-bg-secondary/25 px-5 py-8 text-center">
          <p className="text-sm font-medium text-text">{emptyTitle}</p>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{emptyDescription}</p>
        </div>
      </FeedShell>
    );
  }

  return (
    <FeedShell
      active={active}
      indicatorHeight={indicatorHeight}
      pullDistance={pullDistance}
      refreshing={refreshing}
      readyToRefresh={readyToRefresh}
      isTouching={isTouching}
    >
      <div className={`flex flex-col ${FEED_STACK_GAP} ${FEED_STREAM}`}>
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            rebloggingId={rebloggingId}
            showReblog={showReblog}
            supabase={supabase}
            currentUserId={currentUserId}
            searchHighlightTags={postSearchHighlightTags}
            onReblog={async (p, commentary, tags, editorMarksMature, images, invokeOpts) => {
              setRebloggingId(p.id);
              try {
                return await onReblog(p, commentary, tags, editorMarksMature, images, invokeOpts);
              } finally {
                setRebloggingId(null);
              }
            }}
            viewerDefaultPostsNsfw={viewerDefaultPostsNsfw}
            onPostDeleted={onPostDeleted}
            onPostUpdated={onPostUpdated}
            nsfwFeedMode={nsfwFeedMode}
          />
        ))}
      </div>
      {hasMore && onLoadMore ? (
        <div className="flex justify-center pt-3">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="qrtz-btn-secondary px-4 py-2 text-sm disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more posts"}
          </button>
        </div>
      ) : null}
    </FeedShell>
  );
};

export default Feed;
