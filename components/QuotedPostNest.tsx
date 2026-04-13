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
import PostMediaImage from "./PostMediaImage";

function QuotedFallbackBody({
  node,
  supabase,
}: {
  node: QuotedPostNode;
  supabase: SupabaseClient | null;
}) {
  return (
    <>
      <p className="mt-2 text-meta italic text-text-muted">
        Earlier posts in this chain could not be loaded.
      </p>
      {node.content ? (
        <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-text">{node.content}</p>
      ) : null}
      <PostMediaImage
        supabase={supabase}
        storagePath={node.image_storage_path}
        legacyUrl={node.image_url}
        alt="Post image"
        className="mt-2 rounded-card max-h-[400px] w-full object-cover"
      />
    </>
  );
}

/** Lighter chrome + tighter rhythm for deeper nests; author line stays `text-sm font-semibold`. */
function nestShellClass(depth: number): string {
  if (depth <= 0) {
    return "mt-3 rounded-r-card border-l-2 border-electric-purple/35 bg-surface-blue/80 py-2.5 pl-3 pr-2";
  }
  if (depth === 1) {
    return "mt-2.5 rounded-r-card border-l border-border/70 bg-surface-blue/45 py-2 pl-2.5 pr-2";
  }
  return "mt-2 rounded-r-sm border-l border-border/45 bg-surface-blue/25 py-1.5 pl-2 pr-1.5";
}

function nestInnerGapClass(depth: number): string {
  return depth >= 2 ? "gap-2" : "gap-2.5";
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
          <p className="font-heading text-sm font-semibold leading-tight text-text">
            <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
              {primary}
            </ProfileUsernameLink>
          </p>
          {isLeaf ? (
            <>
              {node.content ? (
                <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-text">{node.content}</p>
              ) : null}
              <PostMediaImage
                supabase={supabase}
                storagePath={node.image_storage_path}
                legacyUrl={node.image_url}
                alt="Post image"
                className="mt-2 rounded-card max-h-[400px] w-full object-cover"
              />
            </>
          ) : (
            <>
              {node.reblog_commentary?.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-text">
                  {node.reblog_commentary.trim()}
                </p>
              ) : null}
              {shouldClampChild && onExpandChain ? (
                <div className="mt-2 pl-0.5">
                  <button
                    type="button"
                    onClick={onExpandChain}
                    className="rounded-sm text-left text-meta font-medium text-text-muted transition-colors hover:text-link focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-aqua/50 focus-visible:ring-offset-0"
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
