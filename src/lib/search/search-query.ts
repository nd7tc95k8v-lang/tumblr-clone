/**
 * Shared parsing for `/search` text `q` so SSR, client refetch, and helpers stay aligned.
 */

/** Entire token is `@` + username-safe characters only (matches public username charset, not emails). */
const AT_USERNAME_MENTION = /^@[a-zA-Z0-9_]+$/;

/** Same character class as stored usernames (token is wholly this, no `@`). */
export const USERNAME_SHAPED_TOKEN_RE = /^[a-zA-Z0-9_]+$/;

/** Stored usernames are 3–24 chars; keep hint token in that range to avoid tiny noise tokens. */
export const USERNAME_HINT_TOKEN_MIN_LEN = 3;
export const USERNAME_HINT_TOKEN_MAX_LEN = 24;

/**
 * Split trimmed `q` on whitespace into non-empty segments (each segment trimmed).
 */
export function tokenizeSearchText(raw: string): string[] {
  const text = raw.trim();
  if (!text.length) return [];
  return text.split(/\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Text to use for post body `ILIKE`: same words as `q` but with @-username tokens removed.
 * Only removes tokens that are clearly mentions (`@letters_digits_underscores`), e.g. `@andrew coffee` → `coffee`.
 */
export function stripAtMentionsForPostSearch(raw: string): string {
  const parts = tokenizeSearchText(raw);
  if (!parts.length) return "";
  return parts.filter((p) => !AT_USERNAME_MENTION.test(p)).join(" ").trim();
}

/**
 * Text passed to post `ILIKE`: strips full-token `@mentions` only; with no `@mentions`, drops a leading
 * username-shaped token only when there are **3+** tokens (`andrew cute cats` → `cute cats`).
 * Single- and two-token queries stay intact for the initial post search (see two-token retry in fetch layer).
 */
export function derivePostSearchText(raw: string): string {
  const originalParts = tokenizeSearchText(raw);
  const hadAtMention = originalParts.some((p) => AT_USERNAME_MENTION.test(p));
  const parts = tokenizeSearchText(stripAtMentionsForPostSearch(raw));
  if (!parts.length) return "";

  if (!hadAtMention && parts.length >= 3) {
    const first = parts[0]!;
    if (USERNAME_SHAPED_TOKEN_RE.test(first)) {
      return parts.slice(1).join(" ").trim();
    }
  }

  return parts.join(" ").trim();
}

/**
 * When `raw` has no full-token `@mentions` and exactly two post tokens after stripping them,
 * returns those tokens for bounded post-search retries (full phrase first, then each token alone).
 */
export function getTwoTokenPostSearchTokens(raw: string): readonly [string, string] | null {
  const originalParts = tokenizeSearchText(raw);
  if (originalParts.some((p) => AT_USERNAME_MENTION.test(p))) {
    return null;
  }
  const parts = tokenizeSearchText(stripAtMentionsForPostSearch(raw));
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a?.length || !b?.length) return null;
  return [a, b];
}

/**
 * First whitespace-delimited token with optional leading `@`, username-shaped and length-bounded
 * (same charset as stored usernames, 3–24 chars). Examples: `andrew cats` → `andrew`; `@andrew` → `andrew`.
 */
export function getStrongUsernameHintToken(raw: string): string | null {
  const parts = tokenizeSearchText(raw);
  if (!parts.length) return null;
  const first = parts[0]!;
  const stripped = first.startsWith("@") ? first.slice(1) : first;
  if (!stripped.length) return null;
  if (!USERNAME_SHAPED_TOKEN_RE.test(stripped)) return null;
  if (
    stripped.length < USERNAME_HINT_TOKEN_MIN_LEN ||
    stripped.length > USERNAME_HINT_TOKEN_MAX_LEN
  ) {
    return null;
  }
  return stripped;
}
