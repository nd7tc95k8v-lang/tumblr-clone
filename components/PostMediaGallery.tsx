"use client";

import React, { useCallback, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePostImages, type NormalizedPostImage, type PostWithImages } from "@/lib/post-images";
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

  if (images.length === 2) {
    return (
      <>
        <div className={`grid grid-cols-2 gap-1 ${wrapperClassName}`}>
          {images.map((im, i) => (
            <button
              key={`${im.storagePath ?? ""}-${im.src ?? ""}-${i}`}
              type="button"
              className={`block min-w-0 cursor-zoom-in overflow-hidden rounded-xl border-0 bg-transparent p-0 text-left ${focusRing()}`}
              onClick={() => openAt(i)}
              aria-label={`View image ${i + 1} fullscreen`}
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
          ))}
        </div>
        {lightbox}
      </>
    );
  }

  if (images.length === 3) {
    return (
      <>
        <div className={`grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-xl ${wrapperClassName}`}>
          <button
            type="button"
            className={`row-span-2 flex min-h-[10rem] min-w-0 cursor-zoom-in items-center justify-center border-0 bg-bg-secondary p-0 ${focusRing()}`}
            onClick={() => openAt(0)}
            aria-label="View image 1 fullscreen"
          >
            <PostMediaImage
              supabase={supabase}
              storagePath={images[0].storagePath}
              legacyUrl={images[0].src}
              alt={images[0].alt}
              className={`${imgClass} max-h-none`}
              onSignedUrl={onGallerySignedUrl}
            />
          </button>
          <button
            type="button"
            className={`flex min-h-0 min-w-0 cursor-zoom-in items-center justify-center border-0 bg-bg-secondary p-0 ${focusRing()}`}
            onClick={() => openAt(1)}
            aria-label="View image 2 fullscreen"
          >
            <PostMediaImage
              supabase={supabase}
              storagePath={images[1].storagePath}
              legacyUrl={images[1].src}
              alt={images[1].alt}
              className={`${imgClass} max-h-[calc(35vh-0.25rem)]`}
              onSignedUrl={onGallerySignedUrl}
            />
          </button>
          <button
            type="button"
            className={`flex min-h-0 min-w-0 cursor-zoom-in items-center justify-center border-0 bg-bg-secondary p-0 ${focusRing()}`}
            onClick={() => openAt(2)}
            aria-label="View image 3 fullscreen"
          >
            <PostMediaImage
              supabase={supabase}
              storagePath={images[2].storagePath}
              legacyUrl={images[2].src}
              alt={images[2].alt}
              className={`${imgClass} max-h-[calc(35vh-0.25rem)]`}
              onSignedUrl={onGallerySignedUrl}
            />
          </button>
        </div>
        {lightbox}
      </>
    );
  }

  const rest = images.length - 4;
  return (
    <>
      <div className={`grid grid-cols-2 gap-1 overflow-hidden rounded-xl ${wrapperClassName}`}>
        {images.slice(0, 4).map((im, i) => (
          <button
            key={`${im.storagePath ?? ""}-${im.src ?? ""}-${i}`}
            type="button"
            className={`relative flex min-h-[8rem] min-w-0 cursor-zoom-in items-center justify-center border-0 bg-bg-secondary p-0 ${focusRing()}`}
            onClick={() => openAt(i)}
            aria-label={
              i === 3 && rest > 0 ? `View image ${i + 1}, ${rest} more in fullscreen` : `View image ${i + 1} fullscreen`
            }
          >
            <PostMediaImage
              supabase={supabase}
              storagePath={im.storagePath}
              legacyUrl={im.src}
              alt={im.alt}
              className="h-full w-full max-h-[min(35vh,12rem)] object-contain"
              onSignedUrl={onGallerySignedUrl}
            />
            {i === 3 && rest > 0 ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-semibold text-white">
                +{rest}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {lightbox}
    </>
  );
}
