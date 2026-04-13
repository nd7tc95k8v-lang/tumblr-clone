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
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center py-10 px-4">
        <h1 className="text-3xl md:text-4xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">#{tag}</h1>
        <div className="w-full max-w-xl flex flex-col items-center gap-6">
          <TagPageClient tag={tag} initialPosts={[]} initialLoadError={null} />
        </div>
      </main>
    );
  }

  const { data, error } = await fetchFeedPosts(supabase, { filterTag: tag });

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl md:text-4xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">#{tag}</h1>
      <section className="w-full flex justify-center">
        <div className="w-full max-w-xl flex flex-col items-center gap-6">
          <TagPageClient tag={tag} initialPosts={data ?? []} initialLoadError={error?.message ?? null} />
        </div>
      </section>
    </main>
  );
}
