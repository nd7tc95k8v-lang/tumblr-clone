"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { alertIfLikelyRateOrGuardFailure } from "@/lib/action-guard/alert-insert-blocked";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  DEFAULT_NSFW_FEED_MODE,
  excludeNsfwPostsFromFeedQuery,
  resolveNsfwFeedModeFromProfileRow,
  type NsfwFeedMode,
} from "@/lib/nsfw-feed-preference";
import { fetchSearchPostsWithTwoTokenFallback, normalizeSearchTagList } from "@/lib/supabase/fetch-search-posts";
import { fetchSearchUsers, type SearchUserResult } from "@/lib/supabase/fetch-search-users";
import { getProfileLinkSlug } from "@/lib/username";
import { reblogInsertFields } from "@/lib/reblog";
import { normalizeTagSegment, parseCommaSeparatedTags } from "@/lib/tags";
import type { FeedPost } from "@/types/post";
import { useActionGuard } from "./ActionGuardProvider";
import Feed from "./Feed";
import ProfileAvatar from "./ProfileAvatar";

type Props = {
  initialPosts: FeedPost[];
  initialLoadError: string | null;
  initialUsers: SearchUserResult[];
};

/** Match PostCard tag chips: small bordered pills, not loud CTAs. */
const RELATED_TAG_LINK_CLASS =
  "inline-block max-w-[min(100%,12rem)] truncate rounded-full border border-border bg-bg-secondary px-2 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:border-accent-purple/45 hover:text-link focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0";

function uniqueSortedTagsFromPosts(posts: FeedPost[]): string[] {
  const seen = new Set<string>();
  for (const p of posts) {
    for (const t of p.tags) {
      seen.add(t);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export default function SearchClient({ initialPosts, initialLoadError, initialUsers }: Props) {
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

  const initialPostsRef = useRef(initialPosts);
  const initialLoadErrorRef = useRef(initialLoadError);
  useEffect(() => {
    initialPostsRef.current = initialPosts;
    initialLoadErrorRef.current = initialLoadError;
  }, [initialPosts, initialLoadError]);

  const [user, setUser] = useState<User | null>(null);
  const [nsfwFeedMode, setNsfwFeedMode] = useState<NsfwFeedMode>(DEFAULT_NSFW_FEED_MODE);
  const [viewerDefaultPostsNsfw, setViewerDefaultPostsNsfw] = useState(false);
  /** Signed-in: empty until session + `nsfw_feed_mode` resolved so SSR anon hits never flash for `hide`. */
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [users, setUsers] = useState<SearchUserResult[]>(initialUsers);
  const [loading, setLoading] = useState(() => hasQuery);
  const [error, setError] = useState<string | null>(initialLoadError);
  const [sessionChecked, setSessionChecked] = useState(false);
  /** False only while a signed-in viewer’s `nsfw_feed_mode` row is being read. */
  const [signedInFeedPrefsReady, setSignedInFeedPrefsReady] = useState(true);

  const [textQ, setTextQ] = useState(qFromUrl);
  const [tagDraft, setTagDraft] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>(tagsListFromUrl);

  useEffect(() => {
    if (!user?.id) {
      setPosts(initialPosts);
    }
  }, [initialPosts, user?.id]);

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  useEffect(() => {
    setError(initialLoadError);
  }, [initialLoadError]);

  useEffect(() => {
    setTextQ(qFromUrl);
    setSelectedTags(tagsListFromUrl);
  }, [qFromUrl, tagsListFromUrl]);

  const searchBootstrapSeq = useRef(0);

  useEffect(() => {
    if (!supabase) return;

    const runSessionAndFeedPrefs = async () => {
      const seq = ++searchBootstrapSeq.current;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (seq !== searchBootstrapSeq.current) return;

      const u = session?.user ?? null;
      setUser(u);

      if (!u) {
        setNsfwFeedMode(DEFAULT_NSFW_FEED_MODE);
        setViewerDefaultPostsNsfw(false);
        setSignedInFeedPrefsReady(true);
        setPosts(initialPostsRef.current);
        setError(initialLoadErrorRef.current);
        setSessionChecked(true);
        return;
      }

      setSignedInFeedPrefsReady(false);
      setPosts([]);
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("nsfw_feed_mode, default_posts_nsfw")
        .eq("id", u.id)
        .maybeSingle();
      if (seq !== searchBootstrapSeq.current) return;
      if (profErr) console.error(profErr);
      setNsfwFeedMode(resolveNsfwFeedModeFromProfileRow(prof));
      setViewerDefaultPostsNsfw(Boolean(prof?.default_posts_nsfw));
      setSignedInFeedPrefsReady(true);
      setSessionChecked(true);
    };

    void runSessionAndFeedPrefs();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void runSessionAndFeedPrefs();
    });

    return () => {
      searchBootstrapSeq.current += 1;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    if (!hasQuery) {
      setPosts([]);
      setUsers([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (!sessionChecked) return;
    if (user?.id && !signedInFeedPrefsReady) return;
    setLoading(true);
    setError(null);
    try {
      const postPromise = fetchSearchPostsWithTwoTokenFallback(supabase, {
        rawQ: qFromUrl,
        tagsAny: tagsListFromUrl,
        viewerUserId: user?.id ?? null,
        excludeNsfwFromFeed: excludeNsfwPostsFromFeedQuery(nsfwFeedMode),
      });
      const userText = qFromUrl.trim();
      const userPromise =
        userText.length > 0 ? fetchSearchUsers(supabase, qFromUrl) : Promise.resolve({ data: [], error: null });

      const [{ data, error: fetchError }, { data: userRows, error: userFetchError }] = await Promise.all([
        postPromise,
        userPromise,
      ]);

      if (userFetchError) {
        console.error(userFetchError);
        setUsers([]);
      } else {
        setUsers(userRows ?? []);
      }

      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setPosts(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [
    supabase,
    hasQuery,
    qFromUrl,
    tagsListFromUrl,
    user?.id,
    nsfwFeedMode,
    sessionChecked,
    signedInFeedPrefsReady,
  ]);

  useEffect(() => {
    if (!supabase) return;
    void loadPosts();
  }, [supabase, loadPosts, sessionChecked, signedInFeedPrefsReady]);

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
    async (original: FeedPost, commentary?: string | null, tags?: string[], editorMarksMature?: boolean) => {
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
          ...reblogInsertFields(original, {
            commentary,
            tags: tags ?? [],
            editorMarksMature: commentary === null ? undefined : editorMarksMature,
          }),
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
            {relatedTags.map((displayTag) => {
              const normalized = normalizeTagSegment(displayTag);
              const rowKey = normalized.length > 0 ? normalized : displayTag;
              return (
                <li key={rowKey} className="max-w-full min-w-0">
                  <Link href={`/tag/${encodeURIComponent(displayTag)}`} className={RELATED_TAG_LINK_CLASS}>
                    #{displayTag}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hasQuery && qFromUrl.trim().length > 0 && users.length > 0 ? (
        <div className="w-full max-w-3xl">
          <p className="mb-2 text-meta font-medium text-text-secondary">Users</p>
          <ul className="list-none divide-y divide-border/35 rounded-xl border border-border/50 bg-bg-secondary/15 p-0 dark:bg-bg-secondary/25">
            {users.map((u) => {
              const slug = getProfileLinkSlug(u.username);
              if (!slug) return null;
              const avatarLabel = u.display_name?.trim() || u.username;
              const showName = Boolean(u.display_name?.trim());
              return (
                <li key={u.id}>
                  <Link
                    href={`/profile/${encodeURIComponent(slug)}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-focus/45"
                  >
                    <ProfileAvatar url={u.avatar_url} label={avatarLabel} size="md" className="shrink-0" />
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate font-semibold text-text">@{u.username}</p>
                      {showName ? (
                        <p className="truncate text-meta text-text-secondary">{u.display_name}</p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
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
          onPostDeleted={loadPosts}
          onPostUpdated={loadPosts}
          nsfwFeedMode={nsfwFeedMode}
          viewerDefaultPostsNsfw={viewerDefaultPostsNsfw}
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
