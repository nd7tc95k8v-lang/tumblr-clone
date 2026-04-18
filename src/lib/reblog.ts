import { bodyFromPost } from "@/lib/feed-post-display";
import { threadRootPostId } from "@/lib/post-thread-root";
import { buildQuotedPostChain, type ChainPostRow } from "@/lib/quote-chain";
import { tagsForReblogFromSource } from "@/lib/tags";
import type { FeedPost, PostAuthorEmbed, QuotedPostNode } from "@/types/post";

export type ReblogInsertOptions = {
  /** Optional commentary shown above the quoted post on the reblog card. */
  commentary?: string | null;
};

/** Fields for inserting a reblog of `source` (immediate parent = source row). */
export function reblogInsertFields(source: FeedPost, options?: ReblogInsertOptions) {
  const { content, imageSrc, image_storage_path } = bodyFromPost(source);
  const rootId =
    source.original_post_id?.trim() && source.original_post_id.length > 0
      ? source.original_post_id
      : source.id;
  const commentaryTrim = options?.commentary?.trim() ?? "";
  return {
    content,
    image_url: imageSrc ?? source.image_url ?? null,
    image_storage_path: image_storage_path ?? source.image_storage_path?.trim() ?? null,
    reblog_of: source.id,
    original_post_id: rootId,
    tags: tagsForReblogFromSource(source),
    reblog_commentary: commentaryTrim.length > 0 ? commentaryTrim : null,
    /** Hint only; DB trigger forces true if parent `is_nsfw` (inheritance). */
    is_nsfw: Boolean(source.is_nsfw),
  };
}

function feedPostToChainRow(p: FeedPost, threadRootId: string): ChainPostRow {
  return {
    id: p.id,
    content: p.content,
    created_at: p.created_at,
    user_id: p.user_id,
    image_url: p.image_url,
    image_storage_path: p.image_storage_path ?? null,
    post_images: p.post_images ?? null,
    reblog_of: p.reblog_of ?? null,
    reblog_commentary: p.reblog_commentary ?? null,
    original_post_id: threadRootId,
    is_nsfw: p.is_nsfw,
    tags: p.tags,
    author: p.author,
  };
}

function quotedNodeToChainRow(node: QuotedPostNode, threadRootId: string): ChainPostRow {
  return {
    id: node.id,
    content: node.content,
    created_at: node.created_at,
    user_id: node.user_id,
    image_url: node.image_url,
    image_storage_path: node.image_storage_path ?? null,
    post_images: node.post_images ?? null,
    reblog_of: node.reblog_of ?? null,
    reblog_commentary: node.reblog_commentary ?? null,
    original_post_id: threadRootId,
    is_nsfw: Boolean(node.is_nsfw),
    tags: node.tags,
    author: node.author,
  };
}

/** Parent rows reachable from `source` for {@link buildQuotedPostChain} (no network). */
export function collectChainLookupFromFeedPost(source: FeedPost): Map<string, ChainPostRow> {
  const threadRootId = threadRootPostId(source);
  const map = new Map<string, ChainPostRow>();
  map.set(source.id, feedPostToChainRow(source, threadRootId));
  const walk = (node: QuotedPostNode | null) => {
    if (!node) return;
    map.set(node.id, quotedNodeToChainRow(node, threadRootId));
    walk(node.quoted_post);
  };
  walk(source.quoted_post);
  return map;
}

/**
 * Client-only row matching a successful reblog insert (same id as DB when the insert uses that id).
 * Uses `source` plus {@link reblogInsertFields}; no extra fetches.
 */
export function buildOptimisticReblogFeedPost(input: {
  newId: string;
  viewerUserId: string;
  viewerAuthor: PostAuthorEmbed | null;
  source: FeedPost;
  commentary?: string | null;
}): FeedPost {
  const { newId, viewerUserId, viewerAuthor, source, commentary } = input;
  const insertFields = reblogInsertFields(source, { commentary });
  const chainLookup = collectChainLookupFromFeedPost(source);
  const created_at = new Date().toISOString();
  const quoted_post = buildQuotedPostChain({ id: newId, reblog_of: source.id }, chainLookup);

  return {
    id: newId,
    content: insertFields.content,
    created_at,
    user_id: viewerUserId,
    image_url: insertFields.image_url,
    image_storage_path: insertFields.image_storage_path,
    post_images: source.post_images ?? null,
    reblog_of: source.id,
    reblog_commentary: insertFields.reblog_commentary,
    original_post_id: insertFields.original_post_id,
    is_nsfw: insertFields.is_nsfw,
    nsfw_source: source.nsfw_source ?? null,
    tags: insertFields.tags,
    author: viewerAuthor ?? { username: null, avatar_url: null },
    original_post: source.original_post,
    quoted_post,
    like_count: source.like_count,
    reblog_count: source.reblog_count + 1,
    note_comment_count: source.note_comment_count,
    liked_by_me: false,
  };
}
