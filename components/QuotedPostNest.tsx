"use client";

import React from "react";
import type { QuotedPostNode } from "@/types/post";
import {
  QUOTE_NEST_MAX_INITIAL_DEPTH,
  countVisibleQuotedNestLevels,
  quotedNodeProfile,
} from "@/lib/feed-post-display";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";

function QuotedFallbackBody({ node }: { node: QuotedPostNode }) {
  return (
    <>
      <p className="mt-2 text-xs text-text-muted italic">
        Earlier posts in this chain could not be loaded.
      </p>
      {node.content ? (
        <p className="mt-2 text-sm text-text whitespace-pre-wrap">{node.content}</p>
      ) : null}
      {node.image_url?.trim() ? (
        <img
          src={node.image_url.trim()}
          alt="Post image"
          loading="lazy"
          decoding="async"
          className="mt-2 rounded-lg max-h-[400px] w-full object-cover"
        />
      ) : null}
    </>
  );
}

/** Lighter chrome + tighter rhythm for deeper nests; author line stays `text-sm font-semibold`. */
function nestShellClass(depth: number): string {
  if (depth <= 0) {
    return "mt-3 rounded-r-md border-l-2 border-border bg-surface-blue/80 pl-3 pr-2 py-2.5";
  }
  if (depth === 1) {
    return "mt-2.5 rounded-r-md border-l border-border/70 bg-surface-blue/45 pl-2.5 pr-2 py-2";
  }
  return "mt-2 rounded-r-sm border-l border-border/45 bg-surface-blue/25 pl-2 pr-1.5 py-1.5";
}

function nestInnerGapClass(depth: number): string {
  return depth >= 2 ? "gap-2" : "gap-2.5";
}

type Props = {
  node: QuotedPostNode;
  depth: number;
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
        maxVisibleDepth={maxVisibleDepth}
        chainExpanded={chainExpanded}
        onExpandChain={onExpandChain}
      />
    );
  }

  const { primary, primaryRaw, primaryAvatarUrl } = quotedNodeProfile(node);
  const indentPx = depth * (depth >= 2 ? 11 : 14);
  const shell = nestShellClass(depth);
  const innerGap = nestInnerGapClass(depth);

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
          <p className="text-sm font-semibold text-text leading-tight">
            <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
              {primary}
            </ProfileUsernameLink>
          </p>
          {isLeaf ? (
            <>
              {node.content ? (
                <p className="mt-2 text-sm text-text whitespace-pre-wrap leading-relaxed">
                  {node.content}
                </p>
              ) : null}
              {node.image_url?.trim() ? (
                <img
                  src={node.image_url.trim()}
                  alt="Post image"
                  loading="lazy"
                  decoding="async"
                  className="mt-2 rounded-lg max-h-[400px] w-full object-cover"
                />
              ) : null}
            </>
          ) : (
            <>
              {node.reblog_commentary?.trim() ? (
                <p className="mt-2 text-sm text-text whitespace-pre-wrap leading-relaxed">
                  {node.reblog_commentary.trim()}
                </p>
              ) : null}
              {shouldClampChild && onExpandChain ? (
                <div className="mt-2 pl-0.5">
                  <button
                    type="button"
                    onClick={onExpandChain}
                    className="text-left text-xs font-medium text-text-muted hover:text-primary transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    Show full chain
                    {hiddenBelow > 1 ? (
                      <span className="text-text-muted/80 font-normal"> · {hiddenBelow} more</span>
                    ) : null}
                  </button>
                </div>
              ) : child ? (
                <QuotedPostNest
                  node={child}
                  depth={nextDepth}
                  maxVisibleDepth={maxVisibleDepth}
                  chainExpanded={chainExpanded}
                  onExpandChain={onExpandChain}
                />
              ) : (
                <QuotedFallbackBody node={node} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
