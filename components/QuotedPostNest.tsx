"use client";

import React, { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuotedPostNode } from "@/types/post";
import {
  flattenVisibleQuotedChain,
  QUOTE_NEST_MAX_INITIAL_DEPTH,
  quotedNodeProfile,
} from "@/lib/feed-post-display";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";
import { QuoteLayerInlineTime } from "./QuoteLayerInlineTime";
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

type Props = {
  node: QuotedPostNode;
  supabase: SupabaseClient | null;
  /**
   * Max quote layers to show before “Show full chain” (default 3).
   * Oldest layers are shown first; newer tail is hidden while collapsed.
   */
  maxVisibleDepth?: number;
  chainExpanded?: boolean;
  onExpandChain?: () => void;
};

/**
 * One horizontal layer in a flattened quote chain (oldest → newest): author row + body or commentary.
 * No recursive inset — stacks vertically instead of nesting boxes.
 */
function QuotedChainLayer({
  node,
  isFirst,
  supabase,
}: {
  node: QuotedPostNode;
  isFirst: boolean;
  supabase: SupabaseClient | null;
}) {
  const isLeaf = !node.reblog_of?.trim();
  const { primary, primaryRaw, primaryAvatarUrl } = quotedNodeProfile(node);

  return (
    <div className={isFirst ? "min-w-0" : "min-w-0 border-t border-border-soft/45 pt-2 max-md:pt-2.5"}>
      <div className="flex gap-1.5 sm:gap-2">
        <ProfileAvatar url={primaryAvatarUrl} label={primary} size="sm" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline justify-between gap-x-2">
            <p className="min-w-0 flex-1 truncate font-heading text-sm font-semibold leading-tight text-text">
              <ProfileUsernameLink usernameRaw={primaryRaw} className="font-semibold text-inherit">
                {primary}
              </ProfileUsernameLink>
            </p>
            <QuoteLayerInlineTime iso={node.created_at} />
          </div>
          {isLeaf ? (
            <>
              {node.content ? (
                <p className="mt-1.5 whitespace-pre-wrap text-base leading-relaxed text-text max-md:text-[0.9375rem] max-md:leading-relaxed">
                  {node.content}
                </p>
              ) : null}
              <PostMediaGallery
                supabase={supabase}
                post={node}
                variant="quoted"
                wrapperClassName="mt-1.5 max-md:mt-1.5"
              />
            </>
          ) : (
            <>
              {node.reblog_commentary?.trim() ? (
                <div className="mt-1.5 rounded-md border-l-2 border-electric-purple/35 bg-surface-blue/45 py-1.5 pl-2 pr-2 max-md:py-1.5 max-md:pl-2">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text max-md:text-[0.8125rem] max-md:leading-snug">
                    {node.reblog_commentary.trim()}
                  </p>
                </div>
              ) : null}
              {!node.quoted_post ? <QuotedFallbackBody node={node} supabase={supabase} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Quote chain as a vertical stack (Twitter/Tumblr style): oldest/original at the top, each reblog
 * layer below — no recursive inset. Immediate parent of the feed row is the bottom layer in this list.
 */
export default function QuotedPostNest({
  node,
  supabase,
  maxVisibleDepth = QUOTE_NEST_MAX_INITIAL_DEPTH,
  chainExpanded = false,
  onExpandChain,
}: Props) {
  const allLayers = useMemo(() => flattenVisibleQuotedChain(node), [node]);
  const displayedLayers = chainExpanded ? allLayers : allLayers.slice(0, maxVisibleDepth);
  const hiddenCount = chainExpanded ? 0 : Math.max(0, allLayers.length - maxVisibleDepth);

  return (
    <div className="min-w-0">
      {displayedLayers.map((layerNode, index) => (
        <QuotedChainLayer
          key={layerNode.id}
          node={layerNode}
          isFirst={index === 0}
          supabase={supabase}
        />
      ))}
      {!chainExpanded && hiddenCount > 0 && onExpandChain ? (
        <div className="mt-2 -mx-0.5 border-t border-border/50 bg-bg-secondary/30 px-1.5 py-1.5 sm:rounded-md">
          <button
            type="button"
            onClick={onExpandChain}
            className="group flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-meta font-medium text-text-secondary transition-colors hover:bg-bg-secondary/55 hover:text-link focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-aqua/50 focus-visible:ring-offset-0"
          >
            <span>
              Show full chain
              {hiddenCount > 1 ? (
                <span className="font-normal text-text-muted"> · {hiddenCount} more</span>
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
      ) : null}
    </div>
  );
}
