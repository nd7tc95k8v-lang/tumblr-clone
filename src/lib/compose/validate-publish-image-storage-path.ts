/** Reject traversal and paths outside the author's post-images prefix. */
export function isAllowedPublishImageStoragePath(userId: string, storagePath: string): boolean {
  const uid = userId.trim();
  const p = storagePath.trim();
  if (!uid || !p || p.includes("..")) return false;

  const prefix = `${uid}/`;
  if (!p.startsWith(prefix)) return false;

  const rest = p.slice(prefix.length);
  if (!rest) return false;

  if (rest.startsWith("drafts/")) {
    const parts = rest.split("/");
    return parts.length >= 3 && parts[0] === "drafts" && Boolean(parts[1]) && Boolean(parts[2]);
  }

  if (rest.startsWith("queue/")) {
    const parts = rest.split("/");
    return parts.length >= 3 && parts[0] === "queue" && Boolean(parts[1]) && Boolean(parts[2]);
  }

  return !rest.includes("/");
}

/** True when the path is a flat live post object under `{userId}/`. */
export function isCanonicalPostImageStoragePath(userId: string, storagePath: string): boolean {
  const uid = userId.trim();
  const p = storagePath.trim();
  if (!uid || !p || p.includes("..")) return false;

  const prefix = `${uid}/`;
  if (!p.startsWith(prefix)) return false;

  const rest = p.slice(prefix.length);
  return Boolean(rest) && !rest.includes("/");
}

export function validatePublishImageStoragePaths(
  userId: string,
  paths: readonly string[],
): { ok: true } | { ok: false; message: string } {
  for (const path of paths) {
    if (!isAllowedPublishImageStoragePath(userId, path)) {
      return { ok: false, message: "One or more saved images could not be attached to this post." };
    }
  }
  return { ok: true };
}
