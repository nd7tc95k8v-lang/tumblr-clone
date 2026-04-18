import React, { Suspense } from "react";
import ExploreClient from "../../../components/ExploreClient";
import { TrendingTagsSkeleton } from "../../../components/TrendingTags";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { createAnonServerClient } from "@/lib/supabase/server-anon";
import ExploreTrendingTags from "./ExploreTrendingTags";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const supabase = createAnonServerClient();
  if (!supabase) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-6 pb-10 md:px-6 md:py-10">
        <h1 className="mb-2 text-3xl font-bold text-text md:text-4xl">Explore</h1>
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <ExploreClient initialPosts={[]} initialLoadError={null} />
        </div>
      </main>
    );
  }

  const { data, error } = await fetchFeedPosts(supabase, {});

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-6 pb-10 md:px-6 md:py-10">
      <h1 className="mb-2 text-3xl font-bold text-text md:text-4xl">Explore</h1>
      <section className="flex w-full justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <Suspense fallback={<TrendingTagsSkeleton />}>
            <ExploreTrendingTags />
          </Suspense>
          <ExploreClient initialPosts={data ?? []} initialLoadError={error?.message ?? null} />
        </div>
      </section>
    </main>
  );
}
