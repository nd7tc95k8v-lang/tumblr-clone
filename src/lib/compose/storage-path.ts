/** Same rules as legacy PostForm / useReblogAction (ext from name, fallback "jpg"). */
export function fileExtensionFromFileName(fileName: string): string {
  const rawExt = fileName.split(".").pop();
  if (rawExt && /^[a-z0-9]+$/i.test(rawExt) && rawExt.length <= 8) {
    return rawExt.toLowerCase();
  }
  return "jpg";
}

/** `{userId}/{uuid}.{ext}` — existing post-images path convention. */
export function buildPostImageStoragePath(userId: string, fileName: string): string {
  const fileExt = fileExtensionFromFileName(fileName);
  return `${userId}/${crypto.randomUUID()}.${fileExt}`;
}
