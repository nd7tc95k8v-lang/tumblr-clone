import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTagSegment } from "@/lib/tags";

/** Load stored tag strings for the user (`followed_tags.tag` is already normalized at insert time). */
export async function fetchFollowedTagStringsForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tags: string[]; error: { message: string } | null }> {
  const { data, error } = await supabase.from("followed_tags").select("tag").eq("user_id", userId);
  if (error) {
    return { tags: [], error };
  }
  const tags = (data ?? [])
    .map((r: { tag: unknown }) => (typeof r.tag === "string" ? r.tag : ""))
    .filter((t) => t.length > 0);
  return { tags, error: null };
}

/** Stored `followed_tags.tag` value — same normalization as `posts.tags`. */
export function normalizedTagForFollowStore(raw: string): string {
  return normalizeTagSegment(raw);
}

export async function userFollowsNormalizedTag(
  supabase: SupabaseClient,
  userId: string,
  tagInput: string,
): Promise<{ follows: boolean; error: { message: string } | null }> {
  const tag = normalizedTagForFollowStore(tagInput);
  if (!tag) {
    return { follows: false, error: { message: "Invalid tag" } };
  }
  const { data, error } = await supabase
    .from("followed_tags")
    .select("id")
    .eq("user_id", userId)
    .eq("tag", tag)
    .maybeSingle();
  if (error) {
    return { follows: false, error };
  }
  return { follows: Boolean(data), error: null };
}

export async function followNormalizedTagForUser(
  supabase: SupabaseClient,
  userId: string,
  tagInput: string,
): Promise<{ followed: boolean; error: { message: string; code?: string } | null }> {
  const tag = normalizedTagForFollowStore(tagInput);
  if (!tag) {
    return { followed: false, error: { message: "Invalid tag" } };
  }
  const { error } = await supabase.from("followed_tags").insert({ user_id: userId, tag });
  if (!error) {
    return { followed: true, error: null };
  }
  // Unique (user_id, tag): treat as idempotent success.
  if (error.code === "23505") {
    return { followed: true, error: null };
  }
  return { followed: false, error };
}

export async function unfollowNormalizedTagForUser(
  supabase: SupabaseClient,
  userId: string,
  tagInput: string,
): Promise<{ unfollowed: boolean; error: { message: string } | null }> {
  const tag = normalizedTagForFollowStore(tagInput);
  if (!tag) {
    return { unfollowed: false, error: { message: "Invalid tag" } };
  }
  const { error } = await supabase.from("followed_tags").delete().eq("user_id", userId).eq("tag", tag);
  if (error) {
    return { unfollowed: false, error };
  }
  return { unfollowed: true, error: null };
}
