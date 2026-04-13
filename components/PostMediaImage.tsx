"use client";

import React, { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "post-images";
/** Supabase signed URL TTL (seconds). */
const SIGNED_SEC = 3600;
/** Refresh before typical expiry (50 min for 60 min URLs) so long-open tabs keep loading. */
const REFRESH_MS = 50 * 60 * 1000;

type Props = {
  supabase: SupabaseClient | null;
  storagePath: string | null | undefined;
  legacyUrl: string | null | undefined;
  alt: string;
  className?: string;
};

/**
 * Renders a post image: signed URL for `image_storage_path` (private bucket), else legacy `image_url`.
 * Periodically re-signs URLs; `onError` triggers a limited retry for expired links.
 */
export default function PostMediaImage({ supabase, storagePath, legacyUrl, alt, className }: Props) {
  const path = storagePath?.trim() || null;
  const legacy = legacyUrl?.trim() || null;
  const [src, setSrc] = useState<string | null>(() => (!path ? legacy : null));
  const [err, setErr] = useState(false);
  const [signNonce, setSignNonce] = useState(0);
  const imgErrorRetries = useRef(0);

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
    void supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_SEC)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          console.error(error);
          setErr(true);
          setSrc(legacy);
          return;
        }
        setErr(false);
        setSrc(data.signedUrl);
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
