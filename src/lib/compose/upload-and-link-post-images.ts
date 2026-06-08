import type { PublishContext, UploadAndLinkPostImagesResult } from "./types";
import { linkPostImageSources } from "./link-post-image-sources";

export async function uploadAndLinkPostImages(
  input: PublishContext & { files: readonly File[] },
): Promise<UploadAndLinkPostImagesResult> {
  return linkPostImageSources({
    supabase: input.supabase,
    userId: input.userId,
    postId: input.postId,
    sources: input.files.map((file) => ({ kind: "file", file })),
  });
}
