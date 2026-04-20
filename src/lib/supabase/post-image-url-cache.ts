import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "post-images";

/** Must match signing calls — used to compute wall-clock expiry. */
export const POST_IMAGE_SIGNED_URL_TTL_SEC = 3600;

/**
 * Refresh (re-sign) when this much lifetime remains, so links stay valid in long-lived tabs.
 * 10 minutes before the hour-long token expires.
 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** Cap stored entries to avoid unbounded growth on infinite scroll. */
const MAX_CACHE_ENTRIES = 200;

type CacheEntry = {
  url: string;
  /** When the signed URL is expected to stop working (wall clock). */
  expiresAtMs: number;
  lastAccessMs: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<{ url: string | null; error: Error | null }>>();

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldest = Infinity;
  for (const [k, v] of cache) {
    if (v.lastAccessMs < oldest) {
      oldest = v.lastAccessMs;
      oldestKey = k;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

function cacheSet(path: string, url: string): void {
  const now = Date.now();
  cache.set(path, {
    url,
    expiresAtMs: now + POST_IMAGE_SIGNED_URL_TTL_SEC * 1000,
    lastAccessMs: now,
  });
  evictIfNeeded();
}

/**
 * Drop a path after load failures (e.g. expired token) so the next resolve re-signs.
 */
export function invalidatePostImageSignedUrlCache(storagePath: string): void {
  const key = storagePath.trim();
  if (!key) return;
  cache.delete(key);
}

/**
 * Clear all cached URLs and in-flight sign requests.
 * `AppShell` calls this on `SIGNED_IN`, `SIGNED_OUT`, and `USER_UPDATED` so URLs are not reused across sessions.
 */
export function clearPostImageSignedUrlCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * Returns a signed URL for `post-images` object path, reusing a cached URL until near expiry.
 * Concurrent requests for the same path share one `createSignedUrl` call.
 */
export async function getCachedPostImageSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<{ url: string | null; error: Error | null }> {
  const path = storagePath.trim();
  if (!path) {
    return { url: null, error: new Error("Missing storage path") };
  }

  const now = Date.now();
  const hit = cache.get(path);
  if (hit && now < hit.expiresAtMs - REFRESH_MARGIN_MS) {
    hit.lastAccessMs = now;
    return { url: hit.url, error: null };
  }

  const pending = inflight.get(path);
  if (pending) return pending;

  const promise = (async (): Promise<{ url: string | null; error: Error | null }> => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, POST_IMAGE_SIGNED_URL_TTL_SEC);
      if (error) {
        const msg =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: string }).message)
            : String(error);
        return { url: null, error: new Error(msg || "Storage signed URL error") };
      }
      const url = data?.signedUrl?.trim() || null;
      if (!url) {
        return { url: null, error: new Error("No signed URL returned") };
      }
      cacheSet(path, url);
      return { url, error: null };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { url: null, error: err };
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, promise);
  return promise;
}
