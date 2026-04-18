import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getStrongUsernameHintToken,
  tokenizeSearchText,
} from "@/lib/search/search-query";
import { escapeIlikePattern } from "@/lib/supabase/escape-ilike-pattern";
import { getProfileLinkSlug, isValidUsernameFormat, normalizeUsername } from "@/lib/username";

export const SEARCH_USERS_LIMIT = 10;

/** Max distinct tokens we query in parallel (keeps request size predictable). */
const MAX_USERNAME_SEARCH_TOKENS = 5;

/** Rows per token before merge; ranking + dedupe yield up to {@link SEARCH_USERS_LIMIT}. */
const PER_TOKEN_FETCH_LIMIT = 15;

/** Allowed characters in stored usernames; tokens matching this are preferred as username candidates. */
const USERNAME_CHARS_RE = /^[a-zA-Z0-9_]+$/;

export type SearchUserResult = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Split the free-text search query into tokens (whitespace), strip leading `@` per token, dedupe case-insensitively.
 * Uses the same whitespace tokenization as {@link tokenizeSearchText}.
 */
export function tokenizeSearchTextForUsers(raw: string): string[] {
  const parts = tokenizeSearchText(raw);
  if (!parts.length) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (let part of parts) {
    if (part.startsWith("@")) {
      part = part.slice(1).trim();
    }
    if (!part.length) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

/**
 * Pick tokens to drive username `ILIKE` queries: prefer `[a-zA-Z0-9_]+` segments.
 * If none qualify (e.g. a single hyphenated word), fall back to the first raw token only.
 */
export function usernameSearchCandidateTokens(tokens: string[]): string[] {
  if (!tokens.length) return [];

  const shaped = tokens.filter((t) => USERNAME_CHARS_RE.test(t));
  const source = shaped.length > 0 ? shaped : tokens.slice(0, 1);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of source) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_USERNAME_SEARCH_TOKENS) break;
  }
  return out;
}

/** Higher = better. Exact > prefix > contains; longer matching token wins within the same tier. */
function usernameMatchScore(usernameNorm: string, tokenNorm: string): number {
  if (!tokenNorm.length) return 0;
  let tier = 0;
  if (usernameNorm === tokenNorm) tier = 3;
  else if (usernameNorm.startsWith(tokenNorm)) tier = 2;
  else if (usernameNorm.includes(tokenNorm)) tier = 1;
  return tier * 1000 + Math.min(tokenNorm.length, 24);
}

function bestUsernameMatchScore(username: string, candidateTokens: string[]): number {
  const u = normalizeUsername(username);
  let best = 0;
  for (const raw of candidateTokens) {
    const t = normalizeUsername(raw);
    best = Math.max(best, usernameMatchScore(u, t));
  }
  return best;
}

async function fetchProfilesUsernameContains(
  supabase: SupabaseClient,
  token: string,
): Promise<{ rows: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const pattern = `%${escapeIlikePattern(token)}%`;
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .not("username", "is", null)
    .ilike("username", pattern)
    .order("username", { ascending: true })
    .limit(PER_TOKEN_FETCH_LIMIT);

  if (error) {
    return { rows: null, error };
  }
  return { rows: rows ?? [], error: null };
}

/**
 * Substring match on `profiles.username` using forgiving token-based candidates (mixed queries like `andrew coffee`).
 * Post search is unchanged; this only affects user lookup.
 * Omits profiles without a public profile URL slug (e.g. email-shaped placeholders).
 */
export async function fetchSearchUsers(
  supabase: SupabaseClient,
  rawQuery: string,
): Promise<{ data: SearchUserResult[] | null; error: { message: string } | null }> {
  const tokens = tokenizeSearchTextForUsers(rawQuery);
  if (!tokens.length) {
    return { data: [], error: null };
  }

  const searchTokens = usernameSearchCandidateTokens(tokens);
  if (!searchTokens.length) {
    return { data: [], error: null };
  }

  const fetches = await Promise.all(searchTokens.map((t) => fetchProfilesUsernameContains(supabase, t)));

  for (const f of fetches) {
    if (f.error) {
      return { data: null, error: f.error };
    }
  }

  const byId = new Map<string, SearchUserResult>();

  for (const f of fetches) {
    for (const row of f.rows ?? []) {
      if (!row || typeof row.username !== "string") continue;
      if (!getProfileLinkSlug(row.username)) continue;
      const id = row.id as string;
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        username: row.username,
        display_name: (row.display_name as string | null | undefined) ?? null,
        avatar_url: (row.avatar_url as string | null | undefined) ?? null,
      });
    }
  }

  const ranked = [...byId.values()].sort((a, b) => {
    const sa = bestUsernameMatchScore(a.username, searchTokens);
    const sb = bestUsernameMatchScore(b.username, searchTokens);
    if (sa !== sb) return sb - sa;
    return normalizeUsername(a.username).localeCompare(normalizeUsername(b.username));
  });

  return { data: ranked.slice(0, SEARCH_USERS_LIMIT), error: null };
}

/**
 * Resolve at most one profile for the **first** username-shaped token in `rawQuery`, for a bounded
 * `/search` post hint when tags are selected. Multi-token queries use **exact** username match only;
 * single-token queries try exact, then a **unique** prefix match (`username` ILIKE `token%`, limit 2).
 */
export async function resolveStrongUsernameForTagSearchHint(
  supabase: SupabaseClient,
  rawQuery: string,
): Promise<{ id: string; username: string } | null> {
  const token = getStrongUsernameHintToken(rawQuery);
  if (!token) return null;

  const norm = normalizeUsername(token);
  if (!norm.length || !isValidUsernameFormat(norm)) return null;

  const multiToken = tokenizeSearchText(rawQuery).length >= 2;

  const exactPattern = escapeIlikePattern(norm);
  const { data: exactRows, error: exactErr } = await supabase
    .from("profiles")
    .select("id, username")
    .not("username", "is", null)
    .ilike("username", exactPattern)
    .limit(2);

  if (exactErr) return null;

  const exactOk = (exactRows ?? []).filter(
    (r) => r && typeof r.username === "string" && getProfileLinkSlug(r.username),
  );
  if (exactOk.length === 1) {
    const row = exactOk[0]!;
    return { id: row.id as string, username: row.username as string };
  }

  if (multiToken) return null;

  const prefixPattern = `${escapeIlikePattern(norm)}%`;
  const { data: prefRows, error: prefErr } = await supabase
    .from("profiles")
    .select("id, username")
    .not("username", "is", null)
    .ilike("username", prefixPattern)
    .order("username", { ascending: true })
    .limit(2);

  if (prefErr) return null;

  const prefOk = (prefRows ?? []).filter(
    (r) => r && typeof r.username === "string" && getProfileLinkSlug(r.username),
  );
  if (prefOk.length !== 1) return null;

  const row = prefOk[0]!;
  return { id: row.id as string, username: row.username as string };
}
