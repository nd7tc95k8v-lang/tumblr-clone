"use client";

import React from "react";

type Props = {
  height: number;
  refreshing: boolean;
  readyToRefresh: boolean;
};

/** Mobile-only pull-to-refresh affordance shown above feed content. */
export default function FeedPullIndicator({ height, refreshing, readyToRefresh }: Props) {
  if (height <= 0 && !refreshing) return null;

  const label = refreshing
    ? "Refreshing…"
    : readyToRefresh
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <div
      className="pointer-events-none flex w-full justify-center overflow-hidden md:hidden"
      style={{ height: Math.max(height, 0) }}
      role={refreshing ? "status" : undefined}
      aria-live={refreshing ? "polite" : undefined}
      aria-hidden={!refreshing ? true : undefined}
    >
      <div
        className="flex items-center gap-2 pt-2 text-meta text-text-muted transition-opacity duration-150 motion-reduce:transition-none"
        style={{ opacity: height > 8 || refreshing ? 1 : 0 }}
      >
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border/50 ${
            refreshing ? "animate-spin motion-reduce:animate-none border-t-text-secondary" : "bg-bg-secondary/80"
          }`}
          style={
            refreshing
              ? undefined
              : {
                  transform: `rotate(${Math.min(readyToRefresh ? 180 : height * 2, 180)}deg)`,
                  transition: "transform 120ms ease-out",
                }
          }
        >
          {!refreshing ? (
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className="h-2.5 w-2.5 text-text-secondary"
              aria-hidden
            >
              <path
                d="M10 4v4m0 4V8m0 0-2-2m2 2 2-2"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
        <span className="font-medium">{label}</span>
      </div>
    </div>
  );
}
