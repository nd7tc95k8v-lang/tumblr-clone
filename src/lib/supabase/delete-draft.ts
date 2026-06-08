import type { SupabaseClient } from "@supabase/supabase-js";

/** Deletes a draft row; `post_draft_images` cascade via FK. Storage objects are not removed in this phase. */
export async function deleteDraft(
  supabase: SupabaseClient,
  draftId: string,
): Promise<{ deleted: boolean; error: { message: string; code?: string } | null }> {
  const id = draftId?.trim() ?? "";
  if (!id) {
    return { deleted: false, error: { message: "Missing draft id" } };
  }

  const { data, error } = await supabase.from("post_drafts").delete().eq("id", id).select("id").maybeSingle();

  if (error) {
    return { deleted: false, error };
  }

  return { deleted: Boolean(data), error: null };
}
