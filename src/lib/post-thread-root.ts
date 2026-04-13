/** Stable thread root id for RPCs and likes; falls back to the row id when legacy rows lack `original_post_id`. */
export function threadRootPostId(row: { id: string; original_post_id?: string | null }): string {
  const t = row.original_post_id?.trim();
  return t && t.length > 0 ? t : row.id;
}
