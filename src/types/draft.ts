/** Row from `post_draft_images` (ordered gallery). */
export type PostDraftImageRow = {
  id: string;
  draft_id: string;
  user_id: string;
  storage_path: string;
  position: number;
  created_at: string;
};

/** Row from `post_drafts` with optional embedded images. */
export type PostDraft = {
  id: string;
  user_id: string;
  content: string;
  tags: string[];
  is_nsfw: boolean;
  created_at: string;
  updated_at: string;
  post_draft_images?: PostDraftImageRow[] | null;
};
