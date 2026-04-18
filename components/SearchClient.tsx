"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  fetchFollowedTagStringsForUser,
  followNormalizedTagForUser,
  unfollowNormalizedTagForUser,
} from "@/lib/supabase/followed-tags";
import { fetchSearchPosts, normalizeSearchTagList } from "@/lib/supabase/fetch-search-posts";
import { reblogInsertFields } from "@/lib/reblog";
import { normalizeTagSegment, parseCommaSeparatedTags } from "@/lib/tags";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import Feed from "./Feed";

type Props = {
  initialPosts: FeedPost[];
  initialLoadError: string | null;
};

/** Match PostCard tag chips: small bordered pills, not loud CTAs. */
const RELATED_TAG_LINK_CLASS =
  "inline-block max-w-[min(100%,12rem)] truncate rounded-full border border-border bg-bg-secondary px-2 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:border-accent-purple/45 hover:text-link focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0";

const RELATED_FOLLOW_BTN_CLASS =
  "inline-flex shrink-0 items-center justify-center rounded-full border border-border/80 bg-bg-secondary/40 px-2 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:border-accent-purple/45 hover:bg-bg-secondary hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-55";

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

  /** Normalized tag strings from `followed_tags`; empty when signed out. */
  const [followedNormSet, setFollowedNormSet] = useState<Set<string>>(() => new Set());
  const [followedTagsLoading, setFollowedTagsLoading] = useState(false);
  /** Normalized tags with an in-flight follow/unfollow mutation (re-render + disabled UI). */
  const [followMutationPending, setFollowMutationPending] = useState<Set<string>>(() => new Set());
  const followMutationPendingRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!supabase || !user?.id) {
      setFollowedNormSet(new Set());
      setFollowedTagsLoading(false);
      return;
    }
    let cancelled = false;
    setFollowedTagsLoading(true);
    void (async () => {
      const { tags, error: loadErr } = await fetchFollowedTagStringsForUser(supabase, user.id);
      if (cancelled) return;
      setFollowedTagsLoading(false);
      if (loadErr) {
        console.error(loadErr);
        setFollowedNormSet(new Set());
        return;
      }
      setFollowedNormSet(new Set(tags));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user?.id]);

  const handleRelatedTagFollowToggle = useCallback(
    async (normalizedTag: string, isFollowing: boolean) => {
      if (!supabase || !user?.id || !normalizedTag.length) return;
      if (followMutationPendingRef.current.has(normalizedTag)) return;
      followMutationPendingRef.current.add(normalizedTag);
      setFollowMutationPending((prev) => new Set(prev).add(normalizedTag));
      try {
        if (isFollowing) {
          const { error: unfollowErr } = await unfollowNormalizedTagForUser(supabase, user.id, normalizedTag);
          if (unfollowErr) {
            console.error(unfollowErr);
            return;
          }
          setFollowedNormSet((prev) => {
            const next = new Set(prev);
            next.delete(normalizedTag);
            return next;
          });
        } else {
          const { error: followErr } = await followNormalizedTagForUser(supabase, user.id, normalizedTag);
          if (followErr) {
            console.error(followErr);
            return;
          }
          setFollowedNormSet((prev) => new Set(prev).add(normalizedTag));
        }
      } finally {
        followMutationPendingRef.current.delete(normalizedTag);
        setFollowMutationPending((prev) => {
          const next = new Set(prev);
          next.delete(normalizedTag);
          return next;
        });
      }
    },
    [supabase, user?.id],
  );

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

  const relatedTagRows = useMemo(
    () =>
      relatedTags.map((displayTag) => ({
        displayTag,
        normalized: normalizeTagSegment(displayTag),
      })),
    [relatedTags],
  );

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
          <ul className="flex list-none flex-wrap gap-x-2 gap-y-2 p-0">
            {relatedTagRows.map(({ displayTag, normalized }) => {
              const rowKey = normalized.length > 0 ? normalized : displayTag;
              const isFollowing = normalized.length > 0 && followedNormSet.has(normalized);
              const busy =
                Boolean(user && (followedTagsLoading || followMutationPending.has(normalized)));
              const followDisabled =
                !user || !normalized.length || followedTagsLoading || followMutationPending.has(normalized);

              return (
                <li key={rowKey} className="flex max-w-full min-w-0 items-center gap-1.5">
                  <Link href={`/tag/${encodeURIComponent(displayTag)}`} className={RELATED_TAG_LINK_CLASS}>
                    #{displayTag}
                  </Link>
                  {user ? (
                    <button
                      type="button"
                      disabled={followDisabled}
                      onClick={() => void handleRelatedTagFollowToggle(normalized, isFollowing)}
                      className={RELATED_FOLLOW_BTN_CLASS}
                      aria-busy={busy}
                      aria-label={
                        isFollowing ? `Stop following tag ${displayTag}` : `Follow tag ${displayTag}`
                      }
                    >
                      {followedTagsLoading ? (
                        "…"
                      ) : followMutationPending.has(normalized) ? (
                        "…"
                      ) : isFollowing ? (
                        "Following"
                      ) : (
                        "Follow"
                      )}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!user ? (
            <p className="mt-2 text-meta text-text-muted">
              <Link href="/" className="text-link hover:text-link-hover hover:underline transition-colors">
                Sign in
              </Link>{" "}
              to follow tags.
            </p>
          ) : null}
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
          onPostDeleted={loadPosts}
          onPostUpdated={loadPosts}
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
