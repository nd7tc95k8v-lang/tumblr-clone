import React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TagPageClient from "../../../../components/TagPageClient";
import { tagFromRouteParam } from "@/lib/tags";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { createAnonServerClient } from "@/lib/supabase/server-anon";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ tag: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tag: raw } = await params;
  const tag = tagFromRouteParam(raw);
  if (!tag) {
    return { title: "Tag" };
  }
  return { title: `#${tag}` };
}

export default async function TagPage({ params }: PageProps) {
  const { tag: raw } = await params;
  const tag = tagFromRouteParam(raw);
  if (!tag) {
    notFound();
  }

  const supabase = createAnonServerClient();
  if (!supabase) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-10 md:px-6">
        <h1 className="mb-2 text-3xl font-bold text-text md:text-4xl">#{tag}</h1>
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <TagPageClient tag={tag} initialPosts={[]} initialLoadError={null} />
        </div>
      </main>
    );
  }

  const { data, error } = await fetchFeedPosts(supabase, { filterTag: tag });

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-10 md:px-6">
      <h1 className="mb-2 text-3xl font-bold text-text md:text-4xl">#{tag}</h1>
      <section className="flex w-full justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <TagPageClient tag={tag} initialPosts={data ?? []} initialLoadError={error?.message ?? null} />
        </div>
      </section>
    </main>
  );
}
