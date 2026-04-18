"use client";

import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuotedPostNode } from "@/types/post";
import {
  QUOTE_NEST_MAX_INITIAL_DEPTH,
  countVisibleQuotedNestLevels,
  quotedNodeProfile,
} from "@/lib/feed-post-display";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";
import PostMediaGallery from "./PostMediaGallery";

function QuotedFallbackBody({
  node,
  supabase,
}: {
  node: QuotedPostNode;
  supabase: SupabaseClient | null;
}) {
  return (
    <>
      <p className="mt-1.5 text-meta italic leading-snug text-text-muted">
        Earlier posts in this chain could not be loaded.
      </p>
      {node.content ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{node.content}</p>
      ) : null}
      <PostMediaGallery supabase={supabase} post={node} variant="quoted" wrapperClassName="mt-1.5" />
    </>
  );
}

/** Depth 0 = clearest quote rail; deeper levels step down in contrast and padding. */
function nestShellClass(depth: number): string {
  if (depth <= 0) {
    return "mt-3 rounded-r-card border-l-[3px] border-electric-purple/45 bg-surface-blue/85 py-2.5 pl-3 pr-2 shadow-sm";
  }
  if (depth === 1) {
    return "mt-2 rounded-r-card border-l-2 border-border/60 bg-bg-secondary/45 py-2 pl-2.5 pr-2";
  }
  return "mt-1.5 rounded-r-md border-l border-border/40 bg-bg-secondary/25 py-1.5 pl-2 pr-1.5";
}

function nestInnerGapClass(depth: number): string {
  if (depth >= 3) return "gap-1.5";
  if (depth >= 2) return "gap-2";
  return "gap-2.5";
}

type Props = {
  node: QuotedPostNode;
  depth: number;
  supabase: SupabaseClient | null;
  /**
   * Number of visible bordered levels before clamping (default 3 → depths 0,1,2).
   * Deeper loaded content is revealed with “Show full chain” (no fetch).
   */
  maxVisibleDepth?: number;
  chainExpanded?: boolean;
  onExpandChain?: () => void;
};

/**
 * Renders one level of the quote-reblog chain: that row’s author, then either the original body
 * (leaf) or commentary + nested parent. Plain intermediate reblogs do not add a visible level.
 */
export default function QuotedPostNest({
  node,
  depth,
  supabase,
  maxVisibleDepth = QUOTE_NEST_MAX_INITIAL_DEPTH,
  chainExpanded = false,
  onExpandChain,
}: Props) {
  const isLeaf = !node.reblog_of?.trim();
  /** Plain intermediate reblogs (no commentary) do not add a visible nest level. */
  if (!isLeaf && !node.reblog_commentary?.trim() && node.quoted_post) {
    return (
      <QuotedPostNest
        node={node.quoted_post}
        depth={depth}
        supabase={supabase}
        maxVisibleDepth={maxVisibleDepth}
        chainExpanded={chainExpanded}
        onExpandChain={onExpandChain}
      />
    );
  }

  const { primary, primaryRaw, primaryAvatarUrl } = quotedNodeProfile(node);
  const indentPx = depth * (depth >= 2 ? 10 : 13);
  const shell = nestShellClass(depth);
  const innerGap = nestInnerGapClass(depth);
  const authorClass =
    depth >= 2
      ? "font-heading text-sm font-semibold leading-tight text-text-secondary"
      : "font-heading text-sm font-semibold leading-tight text-text";
  const leafBodyClass =
    depth >= 2
      ? "mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary"
      : "mt-2 whitespace-pre-wrap text-base leading-relaxed text-text";
  const leafMediaMt = depth >= 2 ? "mt-1.5" : "mt-2";

  const child = node.quoted_post;
  const nextDepth = depth + 1;
  const shouldClampChild =
    Boolean(child) &&
    !isLeaf &&
    nextDepth >= maxVisibleDepth &&
    !chainExpanded &&
    countVisibleQuotedNestLevels(child) > 0;

  const hiddenBelow = child && shouldClampChild ? countVisibleQuotedNestLevels(child) : 0;

  return (
    <div className={shell} style={{ marginLeft: indentPx }}>
      <div className={`flex ${innerGap}`}>
        <ProfileAvatar url={primaryAvatarUrl} label={primary} size="sm" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className={authorClass}>
            <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
              {primary}
            </ProfileUsernameLink>
          </p>
          {isLeaf ? (
            <>
              {node.content ? <p className={leafBodyClass}>{node.content}</p> : null}
              <PostMediaGallery supabase={supabase} post={node} variant="quoted" wrapperClassName={leafMediaMt} />
            </>
          ) : (
            <>
              {node.reblog_commentary?.trim() ? (
                <div
                  className={
                    depth <= 0
                      ? "mt-2 rounded-md border-l-2 border-electric-purple/35 bg-surface-blue/50 py-1.5 pl-2.5 pr-2"
                      : "mt-1.5 rounded-md border-l border-electric-purple/25 bg-surface-blue/30 py-1.5 pl-2 pr-1.5"
                  }
                >
                  <p
                    className={
                      depth >= 2
                        ? "whitespace-pre-wrap text-sm leading-relaxed text-text-secondary"
                        : "whitespace-pre-wrap text-sm leading-relaxed text-text"
                    }
                  >
                    {node.reblog_commentary.trim()}
                  </p>
                </div>
              ) : null}
              {shouldClampChild && onExpandChain ? (
                <div className="mt-2 -mx-0.5 border-t border-border/50 bg-bg-secondary/30 px-1.5 py-1.5 sm:rounded-md">
                  <button
                    type="button"
                    onClick={onExpandChain}
                    className="group flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-meta font-medium text-text-secondary transition-colors hover:bg-bg-secondary/55 hover:text-link focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-aqua/50 focus-visible:ring-offset-0"
                  >
                    <span>
                      Show full chain
                      {hiddenBelow > 1 ? (
                        <span className="font-normal text-text-muted"> · {hiddenBelow} more</span>
                      ) : null}
                    </span>
                    <span
                      className="shrink-0 text-text-muted transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                      aria-hidden
                    >
                      →
                    </span>
                  </button>
                </div>
              ) : child ? (
                <QuotedPostNest
                  node={child}
                  depth={nextDepth}
                  supabase={supabase}
                  maxVisibleDepth={maxVisibleDepth}
                  chainExpanded={chainExpanded}
                  onExpandChain={onExpandChain}
                />
              ) : (
                <QuotedFallbackBody node={node} supabase={supabase} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
