import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import ProfilePageClient from "../../../../components/ProfilePageClient";
import type { ProfilePublic } from "@/types/profile";
import { normalizeRouteUsername } from "@/lib/username";
import { POST_FEED_SELECT } from "@/lib/supabase/post-feed-select";
import { createAnonServerClient } from "@/lib/supabase/server-anon";
import type { FeedPost } from "@/types/post";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username: raw } = await params;
  const normalized = normalizeRouteUsername(raw);
  const supabase = createAnonServerClient();
  if (!supabase || !normalized) {
    return { title: "Profile" };
  }
  const { data } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("username", normalized)
    .maybeSingle();
  if (!data?.username) {
    return { title: "Profile not found" };
  }
  const label = data.display_name?.trim()
    ? `${data.display_name.trim()} (@${data.username})`
    : `@${data.username}`;
  return { title: label };
}

export default async function ProfilePage({ params }: PageProps) {
  const { username: raw } = await params;
  const normalized = normalizeRouteUsername(raw);
  const supabase = createAnonServerClient();

  if (!supabase) {
    return (
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center px-4 py-16">
        <p className="text-zinc-700 dark:text-zinc-300 text-sm">Supabase is not configured.</p>
      </main>
    );
  }

  if (!normalized) {
    return (
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center px-4 py-16">
        <p className="text-zinc-700 dark:text-zinc-300 text-sm mb-4">Invalid username.</p>
        <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Back to home
        </Link>
      </main>
    );
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio")
    .eq("username", normalized)
    .maybeSingle();

  if (profileError) {
    return (
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center px-4 py-16">
        <p className="text-red-700 dark:text-red-300 text-sm">{profileError.message}</p>
        <Link href="/" className="mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Back to home
        </Link>
      </main>
    );
  }

  if (!profileRow?.username) {
    return (
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center px-4 py-16">
        <p className="text-zinc-700 dark:text-zinc-300 text-sm mb-1">No user named @{normalized}.</p>
        <p className="text-zinc-500 dark:text-zinc-400 text-xs mb-6">That profile does not exist.</p>
        <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Back to home
        </Link>
      </main>
    );
  }

  const profile: ProfilePublic = {
    id: profileRow.id,
    username: profileRow.username,
    display_name: profileRow.display_name,
    bio: profileRow.bio,
  };

  const { data: postsData } = await supabase
    .from("posts")
    .select(POST_FEED_SELECT)
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  return <ProfilePageClient profile={profile} initialPosts={(postsData as FeedPost[]) ?? []} />;
}
