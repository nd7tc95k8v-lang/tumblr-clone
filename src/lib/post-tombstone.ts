export const ORIGINAL_POST_DELETED_LABEL = "Original post deleted";

export type ThreadRootTombstoneRef = {
  id: string;
  deleted_at?: string | null;
} | null;

export function isPostTombstoned(row: { deleted_at?: string | null } | null | undefined): boolean {
  const at = row?.deleted_at?.trim();
  return Boolean(at);
}

export function isThreadRootTombstoned(root: ThreadRootTombstoneRef): boolean {
  return isPostTombstoned(root);
}
