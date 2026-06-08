import type { AttachReblogEditorImagesResult, PublishContext } from "./types";
import { clearReblogCopiedImages } from "./clear-reblog-copied-images";
import { uploadAndLinkPostImages } from "./upload-and-link-post-images";

export async function attachReblogEditorImages(
  input: PublishContext & { files: readonly File[] },
): Promise<AttachReblogEditorImagesResult> {
  const clearResult = await clearReblogCopiedImages(input);
  if (!clearResult.ok) {
    return clearResult;
  }

  return uploadAndLinkPostImages(input);
}
