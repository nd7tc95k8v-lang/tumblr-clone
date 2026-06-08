export type OriginalPostInsertRow = {
  id: string;
  user_id: string;
  content: string;
  image_url: null;
  image_storage_path: null;
  tags: string[];
  original_post_id: string;
  is_nsfw: boolean;
};

export function buildOriginalPostInsertRow(input: {
  postId: string;
  userId: string;
  content: string;
  tags: string[];
  isNsfw: boolean;
}): OriginalPostInsertRow {
  return {
    id: input.postId,
    user_id: input.userId,
    content: input.content,
    image_url: null,
    image_storage_path: null,
    tags: input.tags,
    original_post_id: input.postId,
    is_nsfw: input.isNsfw,
  };
}
