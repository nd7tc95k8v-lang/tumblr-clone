"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchSearchPosts, normalizeSearchTagList } from "@/lib/supabase/fetch-search-posts";
import { reblogInsertFields } from "@/lib/reblog";
import { parseCommaSeparatedTags } from "@/lib/tags";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import Feed from "./Feed";

type Props = {
  initialPosts: FeedPost[];
  initialLoadError: string | null;
};

function uniqueSortedTagsFromPosts(posts: FeedPost[]): string[] {
  const seen = new Set<string>();
  for (const p of posts) {
    for (const t of p.tags) {
      seen.add(t);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export default function SearchClient({ initialPosts, initialLoadError }: Props) {
  const { runProtectedAction } = useActionGuard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const qFromUrl = searchParams.get("q")?.trim() ?? "";
  const tagsFromUrl = searchParams.get("tags") ?? "";
  const tagsListFromUrl = useMemo(
    () => normalizeSearchTagList(tagsFromUrl.split(",").map((t) => t.trim()).filter(Boolean)),
    [tagsFromUrl],
  );

  const hasQuery = qFromUrl.length > 0 || tagsListFromUrl.length > 0;

  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialLoadError);

  const [textQ, setTextQ] = useState(qFromUrl);
  const [tagDraft, setTagDraft] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>(tagsListFromUrl);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  useEffect(() => {
    setError(initialLoadError);
  }, [initialLoadError]);

  useEffect(() => {
    setTextQ(qFromUrl);
    setSelectedTags(tagsListFromUrl);
  }, [qFromUrl, tagsListFromUrl]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    if (!hasQuery) {
      setPosts([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await fetchSearchPosts(supabase, {
        contentSubstring: qFromUrl || null,
        tagsAny: tagsListFromUrl,
        viewerUserId: user?.id ?? null,
      });
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [supabase, hasQuery, qFromUrl, tagsListFromUrl, user?.id]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, loadPosts]);

  const submitSearch = useCallback(() => {
    const nextQ = textQ.trim();
    const tags = normalizeSearchTagList(selectedTags);
    const params = new URLSearchParams();
    if (nextQ.length > 0) params.set("q", nextQ);
    if (tags.length > 0) params.set("tags", tags.join(","));
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }, [router, textQ, selectedTags]);

  const addTagFromDraft = useCallback(() => {
    const parsed = parseCommaSeparatedTags(tagDraft);
    if (parsed.length === 0) return;
    setSelectedTags((prev) => normalizeSearchTagList([...prev, ...parsed]));
    setTagDraft("");
  }, [tagDraft]);

  const removeTag = useCallback((t: string) => {
    setSelectedTags((prev) => prev.filter((x) => x !== t));
  }, []);

  const relatedTags = useMemo(() => {
    if (!hasQuery || posts.length === 0) return [];
    const inResults = uniqueSortedTagsFromPosts(posts);
    const selected = new Set(tagsListFromUrl);
    return inResults.filter((t) => !selected.has(t)).slice(0, 24);
  }, [hasQuery, posts, tagsListFromUrl]);

  const handleReblog = useCallback(
    async (original: FeedPost, commentary?: string | null) => {
      if (!supabase) return false;
      const {
        data: { user: u },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !u) {
        alert("You must be logged in to reblog.");
        return false;
      }
      let succeeded = false;
      await runProtectedAction(supabase, { kind: "reblog" }, async () => {
        const { error: insertError } = await supabase.from("posts").insert({
          user_id: u.id,
          ...reblogInsertFields(original, { commentary }),
        });
        if (insertError) {
          console.error(insertError);
          await alertIfLikelyRateOrGuardFailure(supabase, insertError, { kind: "reblog" });
          return;
        }
        succeeded = true;
        await loadPosts();
      });
      return succeeded;
    },
    [supabase, loadPosts, runProtectedAction],
  );

  if (!supabase) {
    return (
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
      </div>
    );
  }

  return (
    <>
      <div className="w-full max-w-3xl space-y-3 rounded-xl border border-border/60 bg-bg-secondary/20 p-4 sm:p-5">
        <div className="space-y-2">
          <label htmlFor="search-q" className="block text-meta font-medium text-text-secondary">
            Search posts
          </label>
          <input
            id="search-q"
            type="search"
            value={textQ}
            onChange={(e) => setTextQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
            placeholder="Words in post body…"
            className="qrtz-field w-full"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <span className="block text-meta font-medium text-text-secondary">Tags (any match)</span>
          {selectedTags.length > 0 ? (
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {selectedTags.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-secondary px-2 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:border-accent-purple/45 hover:text-text"
                  >
                    #{t}
                    <span className="sr-only">Remove</span>
                    <span aria-hidden className="text-text-muted">
                      ×
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTagFromDraft();
                }
              }}
              placeholder="Add tag (comma-separated ok)"
              className="qrtz-field min-w-0 flex-1"
              autoComplete="off"
            />
            <button type="button" onClick={addTagFromDraft} className="qrtz-btn-secondary shrink-0 px-4 py-2 text-sm">
              Add tags
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={submitSearch} className="qrtz-btn-primary px-4 py-2 text-sm">
            Search
          </button>
          {(qFromUrl || tagsListFromUrl.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setTextQ("");
                setSelectedTags([]);
                router.push("/search");
              }}
              className="qrtz-btn-secondary px-4 py-2 text-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {hasQuery && relatedTags.length > 0 ? (
        <div className="w-full max-w-3xl">
          <p className="mb-2 text-meta font-medium text-text-secondary">Tags in these results</p>
          <ul className="flex list-none flex-wrap gap-1.5 p-0">
            {relatedTags.map((t) => (
              <li key={t}>
                <Link
                  href={`/tag/${encodeURIComponent(t)}`}
                  className="inline-block rounded-full border border-border/80 bg-bg-secondary/80 px-2 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:border-accent-purple/45 hover:text-link"
                >
                  #{t}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasQuery ? (
        <Feed
          posts={posts}
          loading={loading}
          error={error}
          onRetry={loadPosts}
          onReblog={handleReblog}
          showReblog={Boolean(user)}
          supabase={supabase}
          currentUserId={user?.id ?? null}
          emptyTitle="No matching posts"
          emptyDescription="Try different words, fewer tags, or check spelling."
          postSearchHighlightTags={tagsListFromUrl}
        />
      ) : (
        <p className="max-w-md text-center text-sm leading-relaxed text-text-secondary">
          Enter text, pick one or more tags, or both. Multiple tags match posts that include{" "}
          <span className="font-medium text-text">any</span> of them.
        </p>
      )}

      {!user ? (
        <p className="text-center text-meta text-text-muted">
          <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
            Sign in
          </Link>{" "}
          to reblog.
        </p>
      ) : null}
    </>
  );
}
