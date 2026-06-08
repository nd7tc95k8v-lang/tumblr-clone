/** Reject traversal; allow reuse only from the author's drafts or queue folders. */
export function isAllowedQueueImageReusePath(userId: string, storagePath: string): boolean {
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

  return false;
}

export function validateQueueImageReusePaths(
  userId: string,
  paths: readonly string[],
): { ok: true } | { ok: false; message: string } {
  for (const path of paths) {
    if (!isAllowedQueueImageReusePath(userId, path)) {
      return {
        ok: false,
        message: "One or more saved images could not be attached to this queue item.",
      };
    }
  }
  return { ok: true };
}

/** True when the path already satisfies post_queue_images storage_path_prefix. */
export function isQueueFolderStoragePath(userId: string, storagePath: string): boolean {
  const uid = userId.trim();
  const p = storagePath.trim();
  return Boolean(uid && p && p.startsWith(`${uid}/queue/`));
}
