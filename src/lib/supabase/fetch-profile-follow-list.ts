import type { SupabaseClient } from "@supabase/supabase-js";
import { getProfileLinkSlug } from "@/lib/username";
import type {
  FollowListCursor,
  FollowListEntry,
  FollowListKind,
} from "@/types/follows";
import { DEFAULT_FOLLOW_LIST_PAGE_SIZE } from "@/types/follows";

export type FetchProfileFollowListResult = {
  data: FollowListEntry[] | null;
  error: { message: string } | null;
  nextCursor: FollowListCursor | null;
  hasMore: boolean;
};

export type FetchProfileFollowListOptions = {
  kind: FollowListKind;
  profileId: string;
  cursor?: FollowListCursor | null;
  limit?: number;
};

type ProfileEmbed = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type FollowRowFollowers = {
  created_at: string;
  follower_id: string;
  profile: ProfileEmbed | ProfileEmbed[] | null;
};

type FollowRowFollowing = {
  created_at: string;
  following_id: string;
  profile: ProfileEmbed | ProfileEmbed[] | null;
};

function postgrestFilterLiteral(value: string): string {
  if (/^[a-zA-Z0-9._:-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function followListKeysetBeforeCursorFilter(
  cursor: FollowListCursor,
  idColumn: "follower_id" | "following_id",
): string {
  const ts = postgrestFilterLiteral(cursor.created_at);
  const uid = cursor.user_id;
  return `created_at.lt.${ts},and(created_at.eq.${ts},${idColumn}.lt.${uid})`;
}

function unwrapProfileEmbed(
  profile: ProfileEmbed | ProfileEmbed[] | null | undefined,
): ProfileEmbed | null {
  if (!profile) return null;
  if (Array.isArray(profile)) return profile[0] ?? null;
  return profile;
}

function rowToEntry(
  userId: string,
  createdAt: string,
  profile: ProfileEmbed | ProfileEmbed[] | null | undefined,
): FollowListEntry | null {
  const row = unwrapProfileEmbed(profile);
  if (!row || typeof row.username !== "string") return null;
  if (!getProfileLinkSlug(row.username)) return null;
  return {
    id: userId,
    username: row.username,
    display_name: row.display_name?.trim() ? row.display_name.trim() : null,
    avatar_url: row.avatar_url?.trim() ? row.avatar_url.trim() : null,
    followed_at: createdAt,
  };
}

/**
 * Linkability filter (`getProfileLinkSlug`) can drop onboarding/email-shaped profiles after fetch.
 * Pages may show fewer than `limit` rows even when counts are higher; cursor still advances on raw rows.
 */
export async function fetchProfileFollowList(
  supabase: SupabaseClient,
  options: FetchProfileFollowListOptions,
): Promise<FetchProfileFollowListResult> {
  const { kind, profileId, cursor = null } = options;
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_FOLLOW_LIST_PAGE_SIZE, 50));
  const fetchLimit = limit + 1;

  if (kind === "followers") {
    let query = supabase
      .from("follows")
      .select(
        `
        created_at,
        follower_id,
        profile:profiles!follows_follower_id_fkey (
          id,
          username,
          display_name,
          avatar_url
        )
      `,
      )
      .eq("following_id", profileId)
      .order("created_at", { ascending: false })
      .order("follower_id", { ascending: false })
      .limit(fetchLimit);

    if (cursor) {
      query = query.or(followListKeysetBeforeCursorFilter(cursor, "follower_id"));
    }

    const { data, error } = await query;
    if (error) {
      return { data: null, error, nextCursor: null, hasMore: false };
    }

    const rawRows = (data ?? []) as FollowRowFollowers[];
    const hasMore = rawRows.length > limit;
    const pageRaw = hasMore ? rawRows.slice(0, limit) : rawRows;

    const entries: FollowListEntry[] = [];
    for (const row of pageRaw) {
      const entry = rowToEntry(row.follower_id, row.created_at, row.profile);
      if (entry) entries.push(entry);
    }

    const last = pageRaw[pageRaw.length - 1];
    return {
      data: entries,
      error: null,
      hasMore,
      nextCursor:
        hasMore && last
          ? { created_at: last.created_at, user_id: last.follower_id }
          : null,
    };
  }

  let query = supabase
    .from("follows")
    .select(
      `
        created_at,
        following_id,
        profile:profiles!follows_following_id_fkey (
          id,
          username,
          display_name,
          avatar_url
        )
      `,
    )
    .eq("follower_id", profileId)
    .order("created_at", { ascending: false })
    .order("following_id", { ascending: false })
    .limit(fetchLimit);

  if (cursor) {
    query = query.or(followListKeysetBeforeCursorFilter(cursor, "following_id"));
  }

  const { data, error } = await query;
  if (error) {
    return { data: null, error, nextCursor: null, hasMore: false };
  }

  const rawRows = (data ?? []) as FollowRowFollowing[];
  const hasMore = rawRows.length > limit;
  const pageRaw = hasMore ? rawRows.slice(0, limit) : rawRows;

  const entries: FollowListEntry[] = [];
  for (const row of pageRaw) {
    const entry = rowToEntry(row.following_id, row.created_at, row.profile);
    if (entry) entries.push(entry);
  }

  const last = pageRaw[pageRaw.length - 1];
  return {
    data: entries,
    error: null,
    hasMore,
    nextCursor:
      hasMore && last ? { created_at: last.created_at, user_id: last.following_id } : null,
  };
}
