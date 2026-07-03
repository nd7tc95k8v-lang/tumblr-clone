import Link from "next/link";
import React from "react";

export const LEGAL_POLICY_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/community-guidelines", label: "Community Guidelines" },
  { href: "/copyright", label: "Copyright & DMCA Policy" },
] as const;

export default function LegalLinksFooter() {
  return (
    <nav
      aria-label="Legal policies"
      className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1"
    >
      {LEGAL_POLICY_LINKS.map(({ href, label }, index) => (
        <React.Fragment key={href}>
          {index > 0 ? (
            <span aria-hidden className="text-text-muted/50">
              ·
            </span>
          ) : null}
          <Link
            href={href}
            className="text-link transition-colors hover:text-link-hover hover:underline"
          >
            {label}
          </Link>
        </React.Fragment>
      ))}
    </nav>
  );
}
