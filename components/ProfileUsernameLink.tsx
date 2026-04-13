"use client";

import Link from "next/link";
import React from "react";
import { getProfileLinkSlug } from "@/lib/username";

type Props = {
  /** Value from `profiles.username` (before display masking). */
  usernameRaw: string | null | undefined;
  children: React.ReactNode;
  className?: string;
};

export default function ProfileUsernameLink({ usernameRaw, children, className = "" }: Props) {
  const slug = getProfileLinkSlug(usernameRaw);
  if (!slug) {
    return <span className={className}>{children}</span>;
  }
  return (
    <Link
      href={`/profile/${encodeURIComponent(slug)}`}
      className={`${className} rounded-sm transition-colors hover:text-primary`.trim()}
    >
      {children}
    </Link>
  );
}
