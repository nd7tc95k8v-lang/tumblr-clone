import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProfileFollowStats } from "@/types/follows";

export async function fetchProfileFollowCounts(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ data: ProfileFollowStats; error: { message: string } | null }> {
  const [followersRes, followingRes] = await Promise.all([
    supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", profileId),
    supabase.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", profileId),
  ]);

  if (followersRes.error) {
    return { data: { followers: 0, following: 0 }, error: followersRes.error };
  }
  if (followingRes.error) {
    return { data: { followers: 0, following: 0 }, error: followingRes.error };
  }

  return {
    data: {
      followers: followersRes.count ?? 0,
      following: followingRes.count ?? 0,
    },
    error: null,
  };
}
