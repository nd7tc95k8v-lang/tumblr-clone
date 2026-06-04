import React, { Suspense } from "react";
import type { Metadata } from "next";
import SearchClient from "../../../components/SearchClient";
import {
  fetchSearchPostsWithTwoTokenFallback,
  normalizeSearchTagList,
  parseSearchTagMatchMode,
} from "@/lib/supabase/fetch-search-posts";
import { DEFAULT_FEED_PAGE_SIZE } from "@/lib/supabase/fetch-feed-posts";
import { fetchSearchUsers, type SearchUserResult } from "@/lib/supabase/fetch-search-users";
import { createAnonServerClient } from "@/lib/supabase/server-anon";
import type { FeedPost } from "@/types/post";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
};

function parseTagsParam(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  return normalizeSearchTagList(raw.split(",").map((t) => t.trim()).filter(Boolean));
}

type PageProps = {
  searchParams: Promise<{ q?: string; tags?: string; tagMode?: string }>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const tagsList = parseTagsParam(sp.tags);
  const tagMatchMode = parseSearchTagMatchMode(typeof sp.tagMode === "string" ? sp.tagMode : null);
  const hasQuery = q.length > 0 || tagsList.length > 0;

  const supabase = createAnonServerClient();
  let initialPosts: FeedPost[] = [];
  let initialLoadError: string | null = null;
  let initialUsers: SearchUserResult[] = [];

  let initialHasMore = false;
  let initialEffectiveContentSubstring: string | null = null;

  if (supabase && hasQuery) {
    const postPromise = fetchSearchPostsWithTwoTokenFallback(supabase, {
      rawQ: q,
      tagsAny: tagsList,
      tagMatchMode,
      viewerUserId: null,
      limit: DEFAULT_FEED_PAGE_SIZE,
    });
    const userPromise = q.length > 0 ? fetchSearchUsers(supabase, q) : Promise.resolve({ data: [], error: null });

    const [postResult, { data: usersData }] = await Promise.all([postPromise, userPromise]);

    initialPosts = postResult.data ?? [];
    initialLoadError = postResult.error?.message ?? null;
    initialHasMore = postResult.hasMore;
    initialEffectiveContentSubstring = postResult.effectiveContentSubstring;
    initialUsers = usersData ?? [];
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-6 pb-10 md:px-6 md:py-10">
      <h1 className="mb-2 text-3xl font-bold text-text md:text-4xl">Search</h1>
      <section className="flex w-full justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <Suspense
            fallback={
              <p className="text-sm text-text-secondary" role="status">
                Loading search…
              </p>
            }
          >
            <SearchClient
              initialPosts={initialPosts ?? []}
              initialLoadError={initialLoadError}
              initialUsers={initialUsers}
              initialHasMore={initialHasMore}
              initialEffectiveContentSubstring={initialEffectiveContentSubstring}
            />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
