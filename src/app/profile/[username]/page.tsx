import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import ProfilePageClient from "../../../../components/ProfilePageClient";
import type { ProfilePublic } from "@/types/profile";
import { normalizeRouteUsername } from "@/lib/username";
import { fetchProfileFollowCounts } from "@/lib/supabase/follow-counts";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { createAnonServerClient } from "@/lib/supabase/server-anon";

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
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-16">
        <p className="text-text-secondary text-sm">Supabase is not configured.</p>
      </main>
    );
  }

  if (!normalized) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-16">
        <p className="text-text-secondary text-sm mb-4">Invalid username.</p>
        <Link href="/" className="text-sm text-primary hover:text-primary-hover hover:underline transition-colors">
          Back to home
        </Link>
      </main>
    );
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_url")
    .eq("username", normalized)
    .maybeSingle();

  if (profileError) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-16">
        <p className="text-error text-sm">{profileError.message}</p>
        <Link href="/" className="mt-4 text-sm text-primary hover:text-primary-hover hover:underline transition-colors">
          Back to home
        </Link>
      </main>
    );
  }

  if (!profileRow?.username) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-16">
        <p className="text-text-secondary text-sm mb-1">No user named @{normalized}.</p>
        <p className="text-text-muted text-xs mb-6">That profile does not exist.</p>
        <Link href="/" className="text-sm text-primary hover:text-primary-hover hover:underline transition-colors">
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
    avatar_url: profileRow.avatar_url?.trim() ? profileRow.avatar_url : null,
  };

  const [{ data: postsData }, { data: followStats }] = await Promise.all([
    fetchFeedPosts(supabase, { filterUserIds: [profile.id] }),
    fetchProfileFollowCounts(supabase, profile.id),
  ]);

  return (
    <ProfilePageClient
      profile={profile}
      initialPosts={postsData ?? []}
      initialFollowStats={followStats}
    />
  );
}
