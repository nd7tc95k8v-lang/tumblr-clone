import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePostTags } from "@/lib/tags";
import type { PostDraft } from "@/types/draft";
import { coercePostDraftImageRows } from "./draft-images";

const POST_DRAFT_SELECT = `
  id,
  user_id,
  content,
  tags,
  is_nsfw,
  created_at,
  updated_at,
  post_draft_images ( id, draft_id, user_id, storage_path, position, created_at )
`;

type DraftQueryRow = {
  id: string;
  user_id: string;
  content: string;
  tags?: unknown;
  is_nsfw?: boolean | null;
  created_at: string;
  updated_at: string;
  post_draft_images?: unknown;
};

function hydrateDraftRow(row: DraftQueryRow): PostDraft {
  return {
    id: row.id,
    user_id: row.user_id,
    content: row.content,
    tags: coercePostTags(row.tags),
    is_nsfw: Boolean(row.is_nsfw),
    created_at: row.created_at,
    updated_at: row.updated_at,
    post_draft_images: coercePostDraftImageRows(row.post_draft_images, row.id),
  };
}

/** Newest `updated_at` first; includes image rows ordered by `position`. */
export async function fetchDrafts(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: PostDraft[] | null; error: { message: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase
    .from("post_drafts")
    .select(POST_DRAFT_SELECT)
    .eq("user_id", uid)
    .order("updated_at", { ascending: false });

  if (error) {
    return { data: null, error };
  }

  return { data: (data ?? []).map((row) => hydrateDraftRow(row as DraftQueryRow)), error: null };
}

export async function fetchDraftById(
  supabase: SupabaseClient,
  draftId: string,
  userId: string,
): Promise<{ data: PostDraft | null; error: { message: string } | null }> {
  const id = draftId?.trim() ?? "";
  const uid = userId?.trim() ?? "";
  if (!id) {
    return { data: null, error: { message: "Missing draft id" } };
  }
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase
    .from("post_drafts")
    .select(POST_DRAFT_SELECT)
    .eq("id", id)
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }
  if (!data) {
    return { data: null, error: null };
  }

  return { data: hydrateDraftRow(data as DraftQueryRow), error: null };
}
