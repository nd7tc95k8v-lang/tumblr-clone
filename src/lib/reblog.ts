import { bodyFromPost } from "@/lib/feed-post-display";
import { tagsForReblogFromSource } from "@/lib/tags";
import type { FeedPost } from "@/types/post";

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
