"use client";

import React, { useCallback, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePostImages, type NormalizedPostImage, type PostWithImages } from "@/lib/post-images";
import { isPostTombstoned } from "@/lib/post-tombstone";
import PostImageLightbox from "./PostImageLightbox";
import PostMediaImage from "./PostMediaImage";

const feedImgClass = "h-auto w-full max-h-[70vh] cursor-zoom-in rounded-xl object-contain";
const nestImgClass = "h-auto w-full max-h-[70vh] cursor-zoom-in rounded-lg object-contain";

type Props = {
  supabase: SupabaseClient | null;
  /** When set (e.g. quote-layer outer media), skips {@link normalizePostImages} on `post`. */
  normalizedImages?: NormalizedPostImage[];
  post?: PostWithImages;
  variant?: "feed" | "quoted";
  wrapperClassName?: string;
};

function focusRing(): string {
  return "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
}

export default function PostMediaGallery({
  supabase,
  normalizedImages,
  post,
  variant = "feed",
  wrapperClassName = "",
}: Props) {
  if (post && isPostTombstoned(post as { deleted_at?: string | null })) {
    return null;
  }

  const images =
    normalizedImages && normalizedImages.length > 0 ? normalizedImages : post ? normalizePostImages(post) : [];
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  /** Paths signed in thumbnails; lightbox reads this ref for instant reuse. */
  const signedUrlByPathRef = useRef<Map<string, string>>(new Map());
  const onGallerySignedUrl = useCallback((path: string, url: string) => {
    signedUrlByPathRef.current.set(path, url);
  }, []);
  const imgClass = variant === "quoted" ? nestImgClass : feedImgClass;

  if (images.length === 0) return null;

  const openAt = (i: number) => {
    setIdx(i);
    setOpen(true);
  };

  const lightbox = (
    <PostImageLightbox
      open={open}
      onClose={() => setOpen(false)}
      supabase={supabase}
      images={images}
      initialIndex={idx}
      prefetchedSignedUrlsRef={signedUrlByPathRef}
    />
  );

  if (images.length === 1) {
    const im = images[0];
    return (
      <>
        <div className={wrapperClassName}>
          <button
            type="button"
            className={`block w-full min-w-0 cursor-zoom-in border-0 bg-transparent p-0 text-left ${focusRing()}`}
            onClick={() => openAt(0)}
            aria-label="View image fullscreen"
          >
            <PostMediaImage
              supabase={supabase}
              storagePath={im.storagePath}
              legacyUrl={im.src}
              alt={im.alt}
              className={imgClass}
              onSignedUrl={onGallerySignedUrl}
            />
          </button>
        </div>
        {lightbox}
      </>
    );
  }

  return (
    <>
      <PostMediaCarousel
        images={images}
        supabase={supabase}
        imgClass={imgClass}
        wrapperClassName={wrapperClassName}
        openAt={openAt}
        onSignedUrl={onGallerySignedUrl}
      />
      {lightbox}
    </>
  );
}

function PostMediaCarousel({
  images,
  supabase,
  imgClass,
  wrapperClassName,
  openAt,
  onSignedUrl,
}: {
  images: NormalizedPostImage[];
  supabase: SupabaseClient | null;
  imgClass: string;
  wrapperClassName: string;
  openAt: (i: number) => void;
  onSignedUrl: (path: string, url: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive((prev) => (prev === i ? prev : Math.min(Math.max(i, 0), images.length - 1)));
  }, [images.length]);

  const goTo = useCallback((i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, []);

  return (
    <div className={`relative ${wrapperClassName}`}>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        role="group"
        aria-roledescription="carousel"
        aria-label={`Image gallery, ${images.length} images`}
        className="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((im, i) => (
          <div key={`${im.storagePath ?? ""}-${im.src ?? ""}-${i}`} className="w-full shrink-0 snap-center">
            <button
              type="button"
              className={`block w-full min-w-0 cursor-zoom-in border-0 bg-transparent p-0 text-left ${focusRing()}`}
              onClick={() => openAt(i)}
              aria-label={`View image ${i + 1} of ${images.length} fullscreen`}
            >
              <PostMediaImage
                supabase={supabase}
                storagePath={im.storagePath}
                legacyUrl={im.src}
                alt={im.alt}
                className={imgClass}
                onSignedUrl={onSignedUrl}
              />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {images.map((im, i) => (
          <button
            key={`dot-${im.storagePath ?? ""}-${im.src ?? ""}-${i}`}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Go to image ${i + 1} of ${images.length}`}
            aria-current={i === active ? "true" : undefined}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              i === active ? "bg-text" : "bg-text-muted/40 hover:bg-text-muted/70"
            } ${focusRing()}`}
          />
        ))}
      </div>
    </div>
  );
}
