/** Comma-separated Supabase auth user UUIDs allowed to access internal admin tools. */
export function parseAdminUserAllowlist(raw: string | undefined | null): Set<string> {
  if (typeof raw !== "string") return new Set();
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id.length > 0) out.add(id);
  }
  return out;
}

export function isUserInAdminAllowlist(userId: string | undefined | null, allowlist: Set<string>): boolean {
  if (!userId || allowlist.size === 0) return false;
  return allowlist.has(userId);
}
