"use client";

import React, { useEffect, useId, useCallback, useState } from "react";

/** Characters stripped from URL tail when treating them as prose punctuation outside the href. */
const TRAILING_NON_URL = new Set<string>([".", ",", "!", "?", ")", "]"]);

/** Next URL-like token starting after `offset` (`http`, `https`, `www`). */
const URL_HEAD = /\b(https?:\/\/|www\.)/i;

export type LinkedPostSegment =
  | { kind: "text"; text: string }
  | { kind: "url"; raw: string; href: string; displayText: string };

/** Split plain text into text + URL segments for safe React rendering (no innerHTML). */
export function segmentsFromPlainText(source: string): LinkedPostSegment[] {
  const out: LinkedPostSegment[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const relIdx = source.slice(i).search(URL_HEAD);
    if (relIdx === -1) {
      out.push({ kind: "text", text: source.slice(i) });
      break;
    }

    const start = i + relIdx;
    if (start > i) {
      out.push({ kind: "text", text: source.slice(i, start) });
    }

    let end = start;
    while (end < len && !/\s/u.test(source.charAt(end))) {
      end += 1;
    }
    const token = source.slice(start, end);
    const { core: urlCore, trailing } = stripTrailingLinkPunctuation(token);
    const hrefNormalized = normalizeWwwHref(urlCore);

    if (isHttpUrl(hrefNormalized)) {
      out.push({
        kind: "url",
        raw: token,
        href: hrefNormalized,
        displayText: urlCore,
      });
      if (trailing.length > 0) {
        out.push({ kind: "text", text: trailing });
      }
    } else {
      out.push({ kind: "text", text: token });
    }

    i = end;
  }

  return out.length > 0 ? out : [{ kind: "text", text: source }];
}

function stripTrailingLinkPunctuation(s: string): { core: string; trailing: string } {
  let core = s;
  let trailing = "";
  while (core.length > 0) {
    const last = core.charAt(core.length - 1);
    if (!TRAILING_NON_URL.has(last)) break;
    trailing = last + trailing;
    core = core.slice(0, -1);
  }
  return { core, trailing };
}

function normalizeWwwHref(raw: string): string {
  const t = raw.trim();
  if (/^www\./i.test(t)) {
    return `https://${t}`;
  }
  return t;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function destinationLabel(url: string): string {
  try {
    const u = new URL(url);
    let host = u.hostname;
    try {
      if (host.includes("%")) host = decodeURIComponent(host);
    } catch {
      // keep encoded
    }
    return host || url;
  } catch {
    return url;
  }
}

const LINK_BTN_CLASS =
  "inline cursor-pointer rounded-sm border-none bg-transparent p-0 align-baseline font-inherit text-link hover:text-link-hover hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/60 focus-visible:ring-offset-0";

function LeavingSiteDialog({
  open,
  href,
  onCancel,
  onContinue,
}: {
  open: boolean;
  href: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="qrtz-modal-overlay" onClick={onCancel} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        className="qrtz-modal-panel max-w-md"
      >
        <h2 id={titleId} className="mb-2 font-heading text-lg font-semibold text-text">
          {"You're leaving QrtzApp"}
        </h2>
        <p id={descId} className="text-sm leading-relaxed text-text-secondary">
          This link opens a site outside QrtzApp. Make sure you trust it before continuing.
        </p>
        <p className="mt-2 text-xs leading-snug break-all text-text-muted" title={href}>
          {destinationLabel(href)}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="qrtz-btn-secondary px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="qrtz-btn-primary px-3 py-1.5 text-sm"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export type LinkedPostTextProps = {
  text: string;
  /** Tailwind typography / color; whitespace is always `whitespace-pre-wrap`. */
  className?: string;
};

/**
 * Renders post-ish plain text with URL detection: links open a leaving-site modal,
 * never via immediate navigation or `dangerouslySetInnerHTML`.
 */
export default function LinkedPostText({ text, className }: LinkedPostTextProps) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const segments = React.useMemo(() => segmentsFromPlainText(text ?? ""), [text]);

  const handleContinue = useCallback(() => {
    if (!pendingHref) return;
    const u = pendingHref;
    setPendingHref(null);
    window.open(u, "_blank", "noopener,noreferrer");
  }, [pendingHref]);

  const mergedClass = ["whitespace-pre-wrap", className].filter(Boolean).join(" ");

  return (
    <>
      <p className={mergedClass}>
        {segments.map((seg, idx) =>
          seg.kind === "text" ? (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          ) : (
            <button
              key={`${idx}-${seg.href.slice(0, 32)}`}
              type="button"
              className={LINK_BTN_CLASS}
              aria-label={`External link to ${destinationLabel(seg.href)}`}
              onClick={() => setPendingHref(seg.href)}
            >
              {seg.displayText}
            </button>
          ),
        )}
      </p>
      <LeavingSiteDialog
        open={pendingHref !== null}
        href={pendingHref ?? ""}
        onCancel={() => setPendingHref(null)}
        onContinue={handleContinue}
      />
    </>
  );
}
