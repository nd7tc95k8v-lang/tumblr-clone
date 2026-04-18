"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  fetchNotificationInboxList,
  fetchNotificationLastReadAt,
  markNotificationInboxRead,
} from "@/lib/supabase/notifications-inbox";
import { displayUsername, formatRelativePostTime } from "@/lib/feed-post-display";
import { notificationActionLabel } from "@/lib/notification-copy";
import { NOTIFICATION_INBOX_MARKED_READ_EVENT } from "@/lib/constants";
import { postElementDomId } from "@/lib/post-anchor";
import { getProfileLinkSlug } from "@/lib/username";
import type { InboxNotificationRow } from "@/types/notification";
import ProfileAvatar from "./ProfileAvatar";
import ProfileUsernameLink from "./ProfileUsernameLink";

const FEED_OUTER = "mx-auto w-full max-w-3xl px-3 sm:px-6";
const LIST_WRAP = "rounded-2xl bg-bg-secondary/20 p-0.5 sm:p-1.5 dark:bg-bg-secondary/30";

function dispatchMarkedRead() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTIFICATION_INBOX_MARKED_READ_EVENT));
}

function rowHref(row: InboxNotificationRow, viewerUsername: string | null): string {
  const viewerSlug = getProfileLinkSlug(viewerUsername);
  const actorSlug = getProfileLinkSlug(row.actor_username);
  const threadRoot = row.thread_root_post_id?.trim();
  const related = row.related_post_id?.trim();
  const hashToRoot = threadRoot ? `#${postElementDomId(threadRoot)}` : "";
  const hashToReblog = related ? `#${postElementDomId(related)}` : "";

  if (row.kind === "follow") {
    if (actorSlug) return `/profile/${encodeURIComponent(actorSlug)}`;
    return "/";
  }
  if (row.kind === "reblog") {
    if (actorSlug && hashToReblog) return `/profile/${encodeURIComponent(actorSlug)}${hashToReblog}`;
    if (actorSlug) return `/profile/${encodeURIComponent(actorSlug)}`;
    return "/";
  }
  if (row.kind === "like" || row.kind === "comment") {
    if (viewerSlug && hashToRoot) return `/profile/${encodeURIComponent(viewerSlug)}${hashToRoot}`;
    if (viewerSlug) return `/profile/${encodeURIComponent(viewerSlug)}`;
    return "/";
  }
  return "/";
}

function isUnreadRow(row: InboxNotificationRow, lastReadAt: string | null): boolean {
  if (!lastReadAt?.trim()) return true;
  try {
    const t = new Date(row.created_at).getTime();
    const r = new Date(lastReadAt).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(r)) return true;
    return t > r;
  } catch {
    return true;
  }
}

export default function NotificationsClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [items, setItems] = useState<InboxNotificationRow[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumps on every successful inbox fetch so mark-read can run even when `items.length` is unchanged. */
  const [listGeneration, setListGeneration] = useState(0);
  const markReadGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    setUser(u ?? null);
    if (!u) {
      setUsername(null);
      setItems([]);
      setLastReadAt(null);
      setLoading(false);
      setError(null);
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("username").eq("id", u.id).maybeSingle();
    const un = prof?.username?.trim();
    setUsername(un && un.length > 0 ? un : null);

    setLoading(true);
    setError(null);

    const [listRes, readRes] = await Promise.all([
      fetchNotificationInboxList(supabase, 80),
      fetchNotificationLastReadAt(supabase, u.id),
    ]);

    if (listRes.error) {
      setItems([]);
      setLastReadAt(null);
      setError(listRes.error.message);
      setLoading(false);
      return;
    }

    setItems(listRes.data ?? []);
    setLastReadAt(readRes.error ? null : readRes.lastReadAt);
    setLoading(false);
    markReadGenerationRef.current += 1;
    setListGeneration((g) => g + 1);
  }, [supabase]);

  /** After the inbox list (or empty state) has committed and the browser has painted, advance the read watermark. */
  useEffect(() => {
    if (!supabase || !user || loading || error !== null) return;

    const generation = markReadGenerationRef.current;
    let cancelled = false;
    let rafOuter = 0;
    let rafInner = 0;

    rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(() => {
        if (cancelled || generation !== markReadGenerationRef.current) return;
        void (async () => {
          const mark = await markNotificationInboxRead(supabase, user.id);
          if (cancelled || mark.error || generation !== markReadGenerationRef.current) return;
          setLastReadAt(new Date().toISOString());
          dispatchMarkedRead();
        })();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
    };
  }, [supabase, user, loading, error, listGeneration]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => subscription.unsubscribe();
  }, [supabase, refresh]);

  if (!supabase) {
    return (
      <div className="w-full rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="font-medium">Supabase is not configured.</p>
      </div>
    );
  }

  if (!loading && !user) {
    return (
      <div className={`${FEED_OUTER} rounded-xl border border-border/60 bg-bg-secondary/25 px-5 py-8 text-center`}>
        <p className="text-sm font-medium text-text">Sign in to see activity</p>
        <p className="mt-2 text-sm text-text-secondary">Follows, likes, reblogs, and note comments show up here.</p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium text-link hover:text-link-hover hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className={`${FEED_OUTER} flex flex-col gap-2`} role="status" aria-busy="true" aria-label="Loading notifications">
        <div className={`flex flex-col gap-2 ${LIST_WRAP}`}>
          {["n-sk-0", "n-sk-1", "n-sk-2"].map((key) => (
            <div key={key} className="qrtz-card max-md:p-3 animate-pulse">
              <div className="flex gap-2 sm:gap-3">
                <div className="mt-px h-10 w-10 shrink-0 rounded-full bg-bg-secondary ring-1 ring-border/40" aria-hidden />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-40 max-w-[60%] rounded-md bg-bg-secondary" aria-hidden />
                  <div className="h-3 w-24 rounded-md bg-bg-secondary/75" aria-hidden />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${FEED_OUTER} flex flex-col gap-2 rounded-card border border-error/30 bg-error/10 p-4 text-sm text-text`}>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-left font-medium text-link underline hover:text-link-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`${FEED_OUTER} rounded-xl border border-border/60 bg-bg-secondary/25 px-5 py-8 text-center`}>
        <p className="text-sm font-medium text-text">All quiet</p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          When people follow you or engage with your posts, it lands here. Refresh the page to check for new activity.
        </p>
      </div>
    );
  }

  return (
    <div className={`${FEED_OUTER} flex flex-col gap-2`}>
      <div className={`flex flex-col gap-2 ${LIST_WRAP}`}>
        {items.map((row) => {
          const actorLabel = displayUsername(row.actor_username);
          const rel = formatRelativePostTime(row.created_at);
          const unread = isUnreadRow(row, lastReadAt);
          const href = rowHref(row, username);
          return (
            <Link
              key={`${row.kind}-${row.created_at}-${row.actor_id}-${row.thread_root_post_id ?? ""}-${row.related_post_id ?? ""}`}
              href={href}
              className={`qrtz-card block max-md:p-3 transition-colors hover:bg-bg-secondary/40 ${
                unread ? "border-l-2 border-l-accent-aqua/80 pl-[calc(0.75rem-2px)] sm:pl-[calc(1rem-2px)]" : ""
              }`}
            >
              <div className="flex gap-2 sm:gap-3">
                <ProfileAvatar url={row.actor_avatar} label={actorLabel} size="md" className="mt-px" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-text">
                    <ProfileUsernameLink usernameRaw={row.actor_username} className="font-semibold text-text">
                      @{actorLabel}
                    </ProfileUsernameLink>{" "}
                    <span className="text-text-secondary">{notificationActionLabel(row.kind)}</span>
                  </p>
                  <p className="mt-1 text-meta text-text-muted" title={rel.full}>
                    {rel.label}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
