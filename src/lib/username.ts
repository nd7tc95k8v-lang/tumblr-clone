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

/** Blocked public usernames (compare on normalized / lowercase input). */
export const RESERVED_USERNAMES = [
  "admin",
  "support",
  "api",
  "settings",
  "login",
  "signup",
  "explore",
  "tag",
  "profile",
] as const;

const RESERVED_SET = new Set<string>(RESERVED_USERNAMES);

export type UsernameValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Validate a username that is already `normalizeUsername` output.
 * Rules: 3–24 chars, [a-z0-9_]+, no leading/trailing underscore, not reserved, not email-shaped.
 */
export function validateUsernameNormalized(normalized: string): UsernameValidationResult {
  if (!normalized) {
    return { ok: false, message: "Enter a username." };
  }
  if (usernameLooksLikeEmail(normalized)) {
    return { ok: false, message: "Usernames can't look like an email address." };
  }
  if (normalized.length < 3 || normalized.length > 24) {
    return { ok: false, message: "Usernames must be 3–24 characters." };
  }
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return { ok: false, message: "Use only lowercase letters, numbers, and underscores." };
  }
  if (normalized.startsWith("_") || normalized.endsWith("_")) {
    return { ok: false, message: "Usernames can't start or end with an underscore." };
  }
  if (RESERVED_SET.has(normalized)) {
    return { ok: false, message: "That username is reserved. Choose another." };
  }
  return { ok: true };
}

/** First validation error for inline hints, or null if empty/valid so far. */
export function describeUsernameFieldError(normalized: string): string | null {
  if (!normalized) return null;
  const v = validateUsernameNormalized(normalized);
  return v.ok ? null : v.message;
}

/** True when {@link validateUsernameNormalized} succeeds. */
export function isValidUsernameFormat(normalized: string): boolean {
  return validateUsernameNormalized(normalized).ok;
}

/** True until the user has a non–email-like public username. */
export function profileNeedsOnboarding(username: string | null | undefined): boolean {
  const u = username?.trim() ?? "";
  if (!u) return true;
  return usernameLooksLikeEmail(u);
}
