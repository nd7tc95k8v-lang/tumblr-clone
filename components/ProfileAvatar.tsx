"use client";

import React from "react";

const frameClass = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-20 w-20",
} as const;

const fallbackTextClass = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-lg",
} as const;

function initialsFromLabel(label: string): string {
  const t = label.replace(/^@/, "").trim();
  if (!t || t === "Unknown") return "?";
  const parts = t.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

type Props = {
  url: string | null;
  /** Used for fallback initials and image alt text. */
  label: string;
  size?: keyof typeof frameClass;
  className?: string;
};

export default function ProfileAvatar({ url, label, size = "md", className = "" }: Props) {
  const frame = frameClass[size];
  const safeUrl = url?.trim() || null;
  const alt = `${label} avatar`;

  if (safeUrl) {
    return (
      <img
        src={safeUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`${frame} rounded-full object-cover shrink-0 bg-bg-secondary ring-1 ring-border ${className}`}
      />
    );
  }

  return (
    <div
      className={`${frame} ${fallbackTextClass[size]} rounded-full shrink-0 flex items-center justify-center font-semibold bg-bg-secondary text-text-secondary ring-1 ring-border ${className}`}
      aria-hidden
    >
      {initialsFromLabel(label)}
    </div>
  );
}
