import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { PostDraft } from "@/types/draft";

export type SaveDraftInput = {
  /** When set, updates an existing draft owned by `userId`. When omitted, inserts a new row. */
  id?: string;
  userId: string;
  content: string;
  tags: string[];
  isNsfw: boolean;
};

const POST_DRAFT_ROW_SELECT = `
  id,
  user_id,
  content,
  tags,
  is_nsfw,
  created_at,
  updated_at
`;

function hydrateSavedDraftRow(row: Record<string, unknown>): PostDraft {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    content: String(row.content ?? ""),
    tags: coercePostTags(row.tags),
    is_nsfw: Boolean(row.is_nsfw),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    post_draft_images: null,
  };
}

/** Upsert draft metadata only (no image upload in this phase). */
export async function saveDraft(
  supabase: SupabaseClient,
  input: SaveDraftInput,
): Promise<{ data: PostDraft | null; error: { message: string; code?: string } | null }> {
  const userId = input.userId?.trim() ?? "";
  if (!userId) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const payload = {
    user_id: userId,
    content: input.content,
    tags: coercePostTags(input.tags),
    is_nsfw: Boolean(input.isNsfw),
  };

  const draftId = input.id?.trim() ?? "";

  if (draftId) {
    const { data, error } = await supabase
      .from("post_drafts")
      .update(payload)
      .eq("id", draftId)
      .eq("user_id", userId)
      .select(POST_DRAFT_ROW_SELECT)
      .maybeSingle();

    if (error) {
      return { data: null, error };
    }
    if (!data) {
      return { data: null, error: { message: "Draft not found" } };
    }
    return { data: hydrateSavedDraftRow(data as Record<string, unknown>), error: null };
  }

  const { data, error } = await supabase
    .from("post_drafts")
    .insert(payload)
    .select(POST_DRAFT_ROW_SELECT)
    .single();

  if (error) {
    return { data: null, error };
  }

  return { data: hydrateSavedDraftRow(data as Record<string, unknown>), error: null };
}
