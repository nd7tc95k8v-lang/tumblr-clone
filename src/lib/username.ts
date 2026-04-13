/** Normalize for storage and uniqueness checks (lowercase, trim). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Safe slug for `/profile/[username]`; null if missing or not linkable. */
export function getProfileLinkSlug(raw: string | null | undefined): string | null {
  const u = raw?.trim();
  if (!u || usernameLooksLikeEmail(u)) return null;
  return normalizeUsername(u);
}

/** Path segment from /profile/[username] (decode, strip optional @). */
export function normalizeRouteUsername(raw: string): string {
  try {
    return decodeURIComponent(raw).replace(/^@/, "").trim().toLowerCase();
  } catch {
    return raw.replace(/^@/, "").trim().toLowerCase();
  }
}

/** Heuristic: treat values containing @ as email-shaped (invalid public username). */
export function usernameLooksLikeEmail(username: string): boolean {
  const u = username.trim();
  if (!u) return true;
  return u.includes("@");
}

/** Allowed: 3–20 chars, letters, digits, underscore. */
export function isValidUsernameFormat(normalized: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(normalized);
}

/** True until the user has a non–email-like public username. */
export function profileNeedsOnboarding(username: string | null | undefined): boolean {
  const u = username?.trim() ?? "";
  if (!u) return true;
  return usernameLooksLikeEmail(u);
}
