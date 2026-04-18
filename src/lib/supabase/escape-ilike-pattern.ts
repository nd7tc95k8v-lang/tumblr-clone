/** Escape `%`, `_`, and `\` for use inside a PostgreSQL `ILIKE` pattern (default escape is `\`). */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
