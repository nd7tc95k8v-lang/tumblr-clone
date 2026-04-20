"use client";

import React, { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCachedPostImageSignedUrl,
  invalidatePostImageSignedUrlCache,
} from "@/lib/supabase/post-image-url-cache";

/** Periodically re-check cache (may refresh near expiry via shared cache). */
const REFRESH_MS = 50 * 60 * 1000;

type Props = {
  supabase: SupabaseClient | null;
  storagePath: string | null | undefined;
  legacyUrl: string | null | undefined;
  alt: string;
  className?: string;
  /** Fired when a signed URL is ready for this path (not used for legacy-only URLs). */
  onSignedUrl?: (storagePath: string, url: string) => void;
};

/**
 * Renders a post image: signed URL for `image_storage_path` (private bucket), else legacy `image_url`.
 * Uses shared {@link getCachedPostImageSignedUrl}; `onError` triggers a limited retry for expired links.
 */
export default function PostMediaImage({
  supabase,
  storagePath,
  legacyUrl,
  alt,
  className,
  onSignedUrl,
}: Props) {
  const path = storagePath?.trim() || null;
  const legacy = legacyUrl?.trim() || null;
  const [src, setSrc] = useState<string | null>(() => (!path ? legacy : null));
  const [err, setErr] = useState(false);
  const [signNonce, setSignNonce] = useState(0);
  const imgErrorRetries = useRef(0);
  const onSignedUrlRef = useRef(onSignedUrl);
  onSignedUrlRef.current = onSignedUrl;

  useEffect(() => {
    imgErrorRetries.current = 0;
  }, [path]);

  useEffect(() => {
    setErr(false);
    if (!path) {
      setSrc(legacy);
      return;
    }
    if (!supabase) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    void getCachedPostImageSignedUrl(supabase, path).then(({ url, error }) => {
      if (cancelled) return;
      if (error || !url) {
        console.error(error);
        setErr(true);
        setSrc(legacy);
        return;
      }
      setErr(false);
      setSrc(url);
      onSignedUrlRef.current?.(path, url);
    });
    return () => {
      cancelled = true;
    };
  }, [path, legacy, supabase, signNonce]);

  useEffect(() => {
    if (!path || !supabase) return;
    const id = window.setInterval(() => setSignNonce((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [path, supabase]);

  const handleImgError = () => {
    if (!path || !supabase) return;
    if (imgErrorRetries.current >= 2) return;
    imgErrorRetries.current += 1;
    invalidatePostImageSignedUrlCache(path);
    setSignNonce((n) => n + 1);
  };

  if (!path && !legacy) return null;
  if (!src) {
    if (path && err) {
      return <p className="text-xs text-text-muted mt-2">Image unavailable.</p>;
    }
    return path ? (
      <div
        className={`min-h-[120px] w-full max-h-[70vh] animate-pulse rounded-card bg-bg-secondary ${className ?? ""}`}
        aria-hidden
      />
    ) : null;
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={handleImgError}
    />
  );
}
