import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PostPermalinkClient from "../../../../components/PostPermalinkClient";
import { fetchFeedPostById } from "@/lib/supabase/fetch-feed-posts";
import { createAnonServerClient } from "@/lib/supabase/server-anon";

export const dynamic = "force-dynamic";

/** Route param must look like a UUID before we hit the database. */
function isLikelyUuid(raw: string): boolean {
  const s = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: raw } = await params;
  if (!isLikelyUuid(raw)) {
    return { title: "Post" };
  }
  const supabase = createAnonServerClient();
  if (!supabase) {
    return { title: "Post" };
  }
  const { data } = await fetchFeedPostById(supabase, raw, null);
  if (!data) {
    return { title: "Post" };
  }
  const rawPreview = data.content?.trim().replace(/\s+/g, " ") || "Post";
  const preview = rawPreview.slice(0, 72);
  const suffix = preview.length < rawPreview.length ? "…" : "";
  return { title: `${preview}${suffix} · Qrtz` };
}

export default async function PostPermalinkPage({ params }: PageProps) {
  const { id: raw } = await params;
  if (!isLikelyUuid(raw)) {
    notFound();
  }

  const supabase = createAnonServerClient();
  if (!supabase) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-6 pb-10 md:px-6 md:py-10">
        <p className="text-sm text-text-secondary">Supabase is not configured.</p>
        <Link href="/" className="mt-4 text-sm text-link hover:text-link-hover hover:underline transition-colors">
          Back to home
        </Link>
      </main>
    );
  }

  const { data, error } = await fetchFeedPostById(supabase, raw, null);
  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-6 pb-10 md:px-6 md:py-10">
        <p className="text-sm text-error" role="alert">
          {error.message}
        </p>
        <Link href="/" className="mt-4 text-sm text-link hover:text-link-hover hover:underline transition-colors">
          Back to home
        </Link>
      </main>
    );
  }

  if (!data) {
    notFound();
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-5 pb-10 md:px-6 md:py-10">
      <div className="mb-4 flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-0 sm:px-0">
        <h1 className="font-heading text-lg font-semibold text-text">Post</h1>
        <Link
          href="/"
          className="text-sm font-medium text-link hover:text-link-hover hover:underline transition-colors"
        >
          ← Home
        </Link>
      </div>
      <PostPermalinkClient postId={raw.trim()} initialPost={data} />
    </main>
  );
}
