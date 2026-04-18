import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function trimNonempty(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Server-only client with the service role key. Do not import from client components. */
export function createServiceRoleServerClient(): SupabaseClient | null {
  const url = trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = trimNonempty(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
