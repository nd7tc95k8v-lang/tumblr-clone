import type { PublishContext, ClearReblogCopiedImagesResult } from "./types";

/**
 * Remove `post_images_copy_for_reblog` rows before editor attachments.
 * RPC first (migration 038), then client delete fallback when RPC fails.
 */
export async function clearReblogCopiedImages(input: PublishContext): Promise<ClearReblogCopiedImagesResult> {
  const { error: rpcErr } = await input.supabase.rpc("clear_post_images_for_reblog_attachment", {
    p_post_id: input.postId,
  });
  if (rpcErr) {
    const { error: delCopyErr } = await input.supabase.from("post_images").delete().eq("post_id", input.postId);
    if (delCopyErr) {
      console.error(delCopyErr);
      const m = delCopyErr.message?.trim() || delCopyErr.code || "Could not prepare image attachments.";
      return {
        ok: false,
        stage: "reblog_image_clear",
        message: `Saving image records failed: ${m}`,
        error: { message: delCopyErr.message, code: delCopyErr.code },
      };
    }
  }
  return { ok: true };
}
