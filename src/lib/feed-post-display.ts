import { usernameLooksLikeEmail } from "@/lib/username";
import type { EmbeddedPostWithAuthor, FeedPost } from "@/types/post";
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

function authorUsername(row: FeedPost): string | null | undefined {
  return unwrapEmbed(row.author)?.username ?? undefined;
}

function embedAuthorUsername(embed: EmbeddedPostWithAuthor): string | null | undefined {
  return unwrapEmbed(embed.author)?.username ?? undefined;
}

function authorAvatarUrl(row: FeedPost): string | null {
  const u = unwrapEmbed(row.author)?.avatar_url?.trim();
  return u || null;
}

function embedAuthorAvatarUrl(embed: EmbeddedPostWithAuthor): string | null {
  const u = unwrapEmbed(embed.author)?.avatar_url?.trim();
  return u || null;
}

/** Chain root for reblogs (merged `original_post`). */
function chainRootEmbed(row: FeedPost): EmbeddedPostWithAuthor | null {
  if (!row.reblog_of?.trim()) return null;
  return row.original_post;
}

export function usernameFromEmbed(
  row: FeedPost,
): { primary: string; rebloggedBy: string | null; isReblog: boolean } {
  const rebloggerName = displayUsername(authorUsername(row));
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);

  if (reblogOf && root) {
    return {
      primary: displayUsername(embedAuthorUsername(root)),
      rebloggedBy: rebloggerName,
      isReblog: true,
    };
  }

  if (reblogOf) {
    return {
      primary: "Unknown",
      rebloggedBy: rebloggerName,
      isReblog: true,
    };
  }

  return {
    primary: rebloggerName,
    rebloggedBy: null,
    isReblog: false,
  };
}

export function postProfileLinkRaw(row: FeedPost): {
  primaryRaw: string | null;
  rebloggerRaw: string | null;
} {
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);
  const r = authorUsername(row);
  const rebloggerRaw = r?.trim() ? r : null;

  if (reblogOf && root) {
    const o = embedAuthorUsername(root);
    return {
      primaryRaw: o?.trim() ? o : null,
      rebloggerRaw,
    };
  }

  if (reblogOf) {
    return {
      primaryRaw: null,
      rebloggerRaw,
    };
  }

  return {
    primaryRaw: rebloggerRaw,
    rebloggerRaw: null,
  };
}

export function postProfileAvatars(row: FeedPost): {
  primaryAvatarUrl: string | null;
  rebloggerAvatarUrl: string | null;
} {
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);
  const rebloggerAv = authorAvatarUrl(row);

  if (reblogOf && root) {
    return {
      primaryAvatarUrl: embedAuthorAvatarUrl(root),
      rebloggerAvatarUrl: rebloggerAv,
    };
  }

  if (reblogOf) {
    return { primaryAvatarUrl: null, rebloggerAvatarUrl: rebloggerAv };
  }

  return {
    primaryAvatarUrl: rebloggerAv,
    rebloggerAvatarUrl: null,
  };
}

export function bodyFromPost(row: FeedPost): { content: string; imageSrc: string | null } {
  const reblogOf = row.reblog_of?.trim();
  const root = chainRootEmbed(row);

  if (reblogOf && root) {
    const img = root.image_url?.trim() || null;
    return { content: root.content, imageSrc: img };
  }

  const img = row.image_url?.trim() || null;
  return { content: row.content, imageSrc: img };
}
