import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function trimNonempty(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export function createBrowserSupabaseClient(): SupabaseClient | null {
  // Use static process.env.NEXT_PUBLIC_* only. Next inlines these at build time;
  // dynamic access like process.env[name] stays undefined in the browser bundle.
  const url = trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key =
    trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    trimNonempty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) return null;
  return createClient(url, key);
}
