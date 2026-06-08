import type { SupabaseClient } from "@supabase/supabase-js";

/** Deletes a queue row; `post_queue_images` cascade via FK. Storage objects are not removed in this phase. */
export async function deleteQueueItem(
  supabase: SupabaseClient,
  queueId: string,
): Promise<{ deleted: boolean; error: { message: string; code?: string } | null }> {
  const id = queueId?.trim() ?? "";
  if (!id) {
    return { deleted: false, error: { message: "Missing queue id" } };
  }

  const { data, error } = await supabase.from("post_queue").delete().eq("id", id).select("id").maybeSingle();

  if (error) {
    return { deleted: false, error };
  }

  return { deleted: Boolean(data), error: null };
}
