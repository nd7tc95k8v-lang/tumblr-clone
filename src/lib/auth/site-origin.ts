function trimTrailingSlash(origin: string): string {
  return origin.replace(/\/$/, "");
}

/** Origin for auth redirectTo URLs. Prefer NEXT_PUBLIC_SITE_URL in production. */
export function getAuthSiteOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return trimTrailingSlash(fromEnv);
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
