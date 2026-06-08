import type { SupabaseClient } from "@supabase/supabase-js";
import { POST_IMAGES_BUCKET } from "./constants";

export async function rollbackPublishedPost(input: {
  supabase: SupabaseClient;
  postId: string;
  uploadedStoragePaths: readonly string[];
  /** Console label prefix; PostForm uses default, reblog uses "Reblog images rollback". */
  logPrefix?: string;
}): Promise<void> {
  const prefix = input.logPrefix ?? "Rollback";

  for (const p of input.uploadedStoragePaths) {
    const { error: rmErr } = await input.supabase.storage.from(POST_IMAGES_BUCKET).remove([p]);
    if (rmErr) console.error(`${prefix}: storage remove failed`, rmErr);
  }

  const { error: delErr } = await input.supabase.from("posts").delete().eq("id", input.postId);
  if (delErr) console.error(`${prefix}: post delete failed`, delErr);
}
