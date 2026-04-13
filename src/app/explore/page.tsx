import React from "react";
import ExploreClient from "../../../components/ExploreClient";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import { createAnonServerClient } from "@/lib/supabase/server-anon";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const supabase = createAnonServerClient();
  if (!supabase) {
    return (
      <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center py-10 px-4">
        <h1 className="text-3xl md:text-4xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">Explore</h1>
        <div className="w-full max-w-xl flex flex-col items-center gap-6">
          <ExploreClient initialPosts={[]} initialLoadError={null} />
        </div>
      </main>
    );
  }

  const { data, error } = await fetchFeedPosts(supabase, {});

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl md:text-4xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">Explore</h1>
      <section className="w-full flex justify-center">
        <div className="w-full max-w-xl flex flex-col items-center gap-6">
          <ExploreClient initialPosts={data ?? []} initialLoadError={error?.message ?? null} />
        </div>
      </section>
    </main>
  );
}
