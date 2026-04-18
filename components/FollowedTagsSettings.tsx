"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  fetchFollowedTagStringsForUser,
  unfollowNormalizedTagForUser,
} from "@/lib/supabase/followed-tags";

type Props = {
  supabase: SupabaseClient;
  user: User;
};

function tagHref(tag: string): string {
  return `/tag/${encodeURIComponent(tag)}`;
}

export default function FollowedTagsSettings({ supabase, user }: Props) {
  const userId = user.id;
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unfollowError, setUnfollowError] = useState<string | null>(null);
  const [unfollowingTag, setUnfollowingTag] = useState<string | null>(null);

  const loadTags = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { tags: raw, error } = await fetchFollowedTagStringsForUser(supabase, userId);
    if (error) {
      setLoadError(error.message);
      setTags([]);
      setLoading(false);
      return;
    }
    const sorted = [...raw].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    setTags(sorted);
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadTags();
    });
  }, [loadTags]);

  const handleUnfollow = useCallback(
    async (tag: string) => {
      setUnfollowError(null);
      setUnfollowingTag(tag);
      const { error } = await unfollowNormalizedTagForUser(supabase, userId, tag);
      setUnfollowingTag(null);
      if (error) {
        setUnfollowError(error.message);
        return;
      }
      setTags((prev) => prev.filter((t) => t !== tag));
    },
    [supabase, userId],
  );

  return (
    <section className="qrtz-card md:col-span-2">
      <h2 className="mb-1 text-meta font-semibold uppercase tracking-wide text-text-muted">Followed tags</h2>
      <p className="mb-4 text-meta text-text-secondary">
        Tags you follow appear in your Home feed. You can follow more from tag pages or when browsing search.
      </p>

      {loadError ? <p className="mb-3 text-meta text-error">{loadError}</p> : null}
      {unfollowError ? <p className="mb-3 text-meta text-error">{unfollowError}</p> : null}

      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-text-secondary">
          You aren&apos;t following any tags yet. Follow tags from tag pages or search to see matching posts in your Home
          feed.
        </p>
      ) : (
        <ul
          className="flex max-h-[min(24rem,55vh)] flex-col gap-1.5 overflow-y-auto rounded-btn border border-border/80 bg-bg-secondary/40 py-2 pl-2 pr-1"
          aria-label="Followed tags"
        >
          {tags.map((tag) => {
            const busy = unfollowingTag === tag;
            return (
              <li
                key={tag}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-bg-secondary/60"
              >
                <Link
                  href={tagHref(tag)}
                  className="min-w-0 truncate rounded px-1.5 py-0.5 text-sm font-medium text-link hover:bg-bg hover:text-link-hover hover:underline"
                >
                  #{tag}
                </Link>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleUnfollow(tag)}
                  className="qrtz-btn-secondary shrink-0 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                >
                  {busy ? "…" : "Unfollow"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
