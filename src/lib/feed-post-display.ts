import { usernameLooksLikeEmail } from "@/lib/username";
import type { FeedPost } from "@/types/post";
import { unwrapEmbed } from "@/types/post";

export function displayUsername(value: string | null | undefined): string {
  const u = value?.trim();
  if (!u) return "Unknown";
  if (usernameLooksLikeEmail(u)) return "Unknown";
  return u;
}

export function formatPostTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function usernameFromEmbed(
  row: FeedPost,
): { primary: string; rebloggedBy: string | null; isReblog: boolean } {
  const poster = unwrapEmbed(row.poster);
  const posterName = displayUsername(poster?.username);
  const reblogOf = row.reblog_of?.trim();
  const original = unwrapEmbed(row.original);

  if (reblogOf && original) {
    const op = unwrapEmbed(original.original_poster);
    return {
      primary: displayUsername(op?.username),
      rebloggedBy: posterName,
      isReblog: true,
    };
  }

  if (reblogOf) {
    return {
      primary: "Unknown",
      rebloggedBy: posterName,
      isReblog: true,
    };
  }

  return {
    primary: posterName,
    rebloggedBy: null,
    isReblog: false,
  };
}

/** Raw `profiles.username` values from embeds for profile links (parallel to `usernameFromEmbed`). */
export function postProfileLinkRaw(row: FeedPost): {
  primaryRaw: string | null;
  rebloggerRaw: string | null;
} {
  const poster = unwrapEmbed(row.poster);
  const reblogOf = row.reblog_of?.trim();
  const original = unwrapEmbed(row.original);

  if (reblogOf && original) {
    const op = unwrapEmbed(original.original_poster);
    return {
      primaryRaw: op?.username?.trim() ? op.username : null,
      rebloggerRaw: poster?.username?.trim() ? poster.username : null,
    };
  }

  if (reblogOf) {
    return {
      primaryRaw: null,
      rebloggerRaw: poster?.username?.trim() ? poster.username : null,
    };
  }

  return {
    primaryRaw: poster?.username?.trim() ? poster.username : null,
    rebloggerRaw: null,
  };
}

export function bodyFromPost(row: FeedPost): { content: string; imageSrc: string | null } {
  const reblogOf = row.reblog_of?.trim();
  const original = unwrapEmbed(row.original);

  if (reblogOf && original) {
    const img = original.image_url?.trim() || null;
    return { content: original.content, imageSrc: img };
  }

  const img = row.image_url?.trim() || null;
  return { content: row.content, imageSrc: img };
}
