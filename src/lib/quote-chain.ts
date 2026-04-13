import type { SupabaseClient } from "@supabase/supabase-js";
import { threadRootPostId } from "@/lib/post-thread-root";
import { coercePostTags } from "@/lib/tags";
import type { PostAuthorEmbed, QuotedPostNode } from "@/types/post";

/** Fields needed to walk `reblog_of` and render nested quotes (no engagement fields). */
export type ChainPostRow = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  image_url?: string | null;
  image_storage_path?: string | null;
  reblog_of?: string | null;
  reblog_commentary?: string | null;
  original_post_id: string;
  is_nsfw: boolean;
  tags: string[];
  author?: PostAuthorEmbed | PostAuthorEmbed[] | null;
};

type ChainQueryRow = Omit<ChainPostRow, "original_post_id" | "tags"> & {
  original_post_id?: string | null;
  tags?: unknown;
};

export const POST_CHAIN_SELECT = `
  id,
  content,
  created_at,
  user_id,
  image_url,
  image_storage_path,
  reblog_of,
  reblog_commentary,
  original_post_id,
  is_nsfw,
  tags,
  author:profiles!posts_user_id_fkey ( username, avatar_url )
`;

const IN_CHUNK = 100;

function normalizeChainQueryRow(row: ChainQueryRow): ChainPostRow {
  const path = row.image_storage_path?.trim() || null;
  return {
    ...row,
    original_post_id: threadRootPostId(row),
    is_nsfw: Boolean(row.is_nsfw),
    image_storage_path: path,
    tags: coercePostTags(row.tags),
  };
}

/**
 * Load every post row reachable by following `reblog_of` from the feed until the frontier is empty.
 * Skips ids already in `seedById`. Missing rows are recorded in `failedIds` so we do not loop forever.
 */
export async function fetchReblogParentClosure(
  supabase: SupabaseClient,
  seedById: Map<string, ChainPostRow>,
  feedSeeds: Array<{ id: string; reblog_of?: string | null }>,
): Promise<{ byId: Map<string, ChainPostRow>; failedIds: Set<string> }> {
  const byId = new Map<string, ChainPostRow>(seedById);
  const failedIds = new Set<string>();

  const frontier = new Set<string>();
  for (const r of feedSeeds) {
    const p = r.reblog_of?.trim();
    if (p) frontier.add(p);
  }

  while (frontier.size > 0) {
    const ids = [...frontier].filter(
      (id) => id.length > 0 && !failedIds.has(id) && !byId.has(id),
    );
    frontier.clear();
    if (ids.length === 0) break;

    const requested = new Set(ids);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const { data, error } = await supabase.from("posts").select(POST_CHAIN_SELECT).in("id", chunk);
      if (error) {
        for (const id of chunk) failedIds.add(id);
        continue;
      }
      for (const raw of data ?? []) {
        const row = normalizeChainQueryRow(raw as ChainQueryRow);
        byId.set(row.id, row);
        requested.delete(row.id);
        const next = row.reblog_of?.trim();
        if (next && !byId.has(next) && !failedIds.has(next)) frontier.add(next);
      }
    }
    for (const id of requested) failedIds.add(id);
  }

  return { byId, failedIds };
}

/**
 * Immediate-parent quote tree for a feed row. Originals → null. Uses `reblog_of` only.
 * Loop-safe: repeats or missing parents truncate the chain.
 */
export function buildQuotedPostChain(
  feedRow: { id: string; reblog_of?: string | null },
  lookup: Map<string, ChainPostRow>,
): QuotedPostNode | null {
  const pid = feedRow.reblog_of?.trim();
  if (!pid || pid === feedRow.id) return null;
  return embedParentNode(pid, lookup, new Set([feedRow.id]));
}

function embedParentNode(
  parentId: string,
  lookup: Map<string, ChainPostRow>,
  path: Set<string>,
): QuotedPostNode | null {
  if (path.has(parentId)) return null;
  const row = lookup.get(parentId);
  if (!row) return null;

  path.add(parentId);
  const gp = row.reblog_of?.trim();
  const quoted = gp && gp !== row.id ? embedParentNode(gp, lookup, path) : null;
  path.delete(parentId);

  return {
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    user_id: row.user_id,
    image_url: row.image_url,
    image_storage_path: row.image_storage_path ?? null,
    reblog_of: row.reblog_of ?? null,
    reblog_commentary: row.reblog_commentary ?? null,
    is_nsfw: row.is_nsfw,
    tags: row.tags,
    author: row.author,
    quoted_post: quoted,
  };
}
