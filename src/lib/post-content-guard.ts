const LAST_USER_TEXT_KEY = "qrtz_app_guard_last_text";
const DUPLICATE_WINDOW_MS = 60_000;
export const MAX_URLS_PER_USER_TEXT = 3;

const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/gi;

export function normalizePostBodyForDedup(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function countUrls(text: string): number {
  const matches = text.match(URL_REGEX);
  return matches?.length ?? 0;
}

/** True when there is no letter or number (any script) — blocks "!!!!" or "..."-only posts. */
export function isOnlyPunctuationOrSymbols(trimmed: string): boolean {
  if (!trimmed) return true;
  return !/[\p{L}\p{N}]/u.test(trimmed);
}

type StoredLast = { n: string; at: number };

function readLastUserText(nowMs: number): StoredLast | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_USER_TEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.n !== "string" || typeof o.at !== "number") return null;
    if (nowMs - o.at > DUPLICATE_WINDOW_MS) return null;
    return { n: o.n, at: o.at };
  } catch {
    return null;
  }
}

export function recordSuccessfulUserWrittenPost(normalizedBody: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      LAST_USER_TEXT_KEY,
      JSON.stringify({ n: normalizedBody, at: Date.now() }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export type ValidateUserWrittenOptions = {
  /** When true, empty trimmed text is allowed (e.g. optional reblog commentary). */
  allowEmpty: boolean;
};

export type UserWrittenValidation = { ok: true } | { ok: false; message: string };

/**
 * Lightweight spam-style checks for user-authored text (posts, reblog commentary).
 * Duplicate detection uses sessionStorage so it survives remounts in the same tab.
 */
export function validateUserWrittenContent(
  raw: string,
  opts: ValidateUserWrittenOptions,
  nowMs: number = Date.now(),
): UserWrittenValidation {
  const trimmed = raw.trim();
  if (!trimmed) {
    return opts.allowEmpty ? { ok: true } : { ok: false, message: "Write something before posting." };
  }

  if (countUrls(trimmed) > MAX_URLS_PER_USER_TEXT) {
    return {
      ok: false,
      message: `Posts can include at most ${MAX_URLS_PER_USER_TEXT} links.`,
    };
  }

  if (isOnlyPunctuationOrSymbols(trimmed)) {
    return { ok: false, message: "Add some words — content can't be only punctuation or symbols." };
  }

  const normalized = normalizePostBodyForDedup(trimmed);
  const last = readLastUserText(nowMs);
  if (last && last.n === normalized) {
    return {
      ok: false,
      message: "You just sent this. Wait about a minute before posting the same text again.",
    };
  }

  return { ok: true };
}
