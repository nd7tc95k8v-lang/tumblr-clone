"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedPostImage } from "@/lib/post-images";
import { getCachedPostImageSignedUrl } from "@/lib/supabase/post-image-url-cache";

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  images: NormalizedPostImage[];
  initialIndex: number;
  /**
   * Latest signed URLs resolved by gallery thumbnails (path → url), so the lightbox can show
   * immediately without waiting on another round-trip when the feed already loaded the same path.
   */
  prefetchedSignedUrlsRef?: React.MutableRefObject<Map<string, string>>;
};

export default function PostImageLightbox({
  open,
  onClose,
  supabase,
  images,
  initialIndex,
  prefetchedSignedUrlsRef,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [resolved, setResolved] = useState<Map<number, string>>(new Map());
  const touchStartX = useRef<number | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const imagesSig = useMemo(
    () => images.map((i) => `${i.storagePath ?? ""}\u001f${i.src ?? ""}\u001f${i.alt}`).join("\u001e"),
    [images],
  );

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, images.length - 1)));
  }, [open, initialIndex, images.length]);

  useEffect(() => {
    if (!open) setResolved(new Map());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = imagesRef.current;
    if (list.length === 0) return;
    let cancelled = false;
    const toLoad = [index, index - 1, index + 1].filter((i) => i >= 0 && i < list.length);
    void (async () => {
      for (const i of toLoad) {
        const img = list[i];
        if (!img) continue;
        let url: string | null = img.src?.trim() || null;
        const path = img.storagePath?.trim();
        if (!url && path && prefetchedSignedUrlsRef?.current) {
          url = prefetchedSignedUrlsRef.current.get(path) ?? null;
        }
        if (!url && path && supabase) {
          const r = await getCachedPostImageSignedUrl(supabase, path);
          url = r.url;
        }
        if (cancelled || !url) continue;
        setResolved((prev) => {
          if (prev.has(i)) return prev;
          const n = new Map(prev);
          n.set(i, url);
          return n;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, index, imagesSig, supabase, prefetchedSignedUrlsRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((j) => (j > 0 ? j - 1 : j));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((j) => (j < images.length - 1 ? j + 1 : j));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length, onClose]);

  if (!open || images.length === 0) return null;

  const currentSrc = resolved.get(index) ?? (images[index]?.src ?? null);
  const canPrev = index > 0;
  const canNext = index < images.length - 1;
  const multi = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-2"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-3 top-3 z-[102] rounded-full bg-bg/90 px-3 py-1.5 text-sm font-medium text-text shadow-md transition-colors hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus md:right-4 md:top-4"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
      >
        Close
      </button>
      {multi ? (
        <>
          <button
            type="button"
            aria-label="Previous image"
            disabled={!canPrev}
            className="absolute left-2 top-1/2 z-[101] hidden -translate-y-1/2 rounded-full bg-bg/85 p-2 text-text shadow-md transition-colors hover:bg-bg disabled:opacity-30 md:left-4 md:block"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((j) => j - 1);
            }}
          >
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next image"
            disabled={!canNext}
            className="absolute right-2 top-1/2 z-[101] hidden -translate-y-1/2 rounded-full bg-bg/85 p-2 text-text shadow-md transition-colors hover:bg-bg disabled:opacity-30 md:right-4 md:block"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((j) => j + 1);
            }}
          >
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      ) : null}
      <div
        className="flex max-h-full max-w-full flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          touchStartX.current = e.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start == null || !multi) return;
          const end = e.changedTouches[0]?.clientX ?? start;
          const dx = end - start;
          if (Math.abs(dx) < 48) return;
          if (dx < 0 && canNext) setIndex((j) => j + 1);
          if (dx > 0 && canPrev) setIndex((j) => j - 1);
        }}
      >
        {currentSrc ? (
          <img
            src={currentSrc}
            alt={images[index]?.alt ?? "Post image"}
            loading="eager"
            decoding="async"
            className="max-h-[92vh] max-w-[96vw] object-contain"
          />
        ) : (
          <div className="h-40 w-64 animate-pulse rounded-lg bg-white/10" aria-hidden />
        )}
        {multi ? (
          <p className="mt-3 text-sm text-white/80">
            {index + 1} / {images.length}
          </p>
        ) : null}
      </div>
    </div>
  );
}
