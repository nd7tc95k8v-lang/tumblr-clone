import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function trimNonempty(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Server-side client using the public anon key (respects RLS as anon). */
export function createAnonServerClient(): SupabaseClient | null {
  const url = trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key =
    trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) return null;
  return createClient(url, key);
}
