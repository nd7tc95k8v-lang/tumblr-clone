"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchFeedPosts } from "@/lib/supabase/fetch-feed-posts";
import PostForm from "./PostForm";

/** Must match `HomeClient` — sessionStorage handoff for optimistic feed merge after compose. */
const PENDING_FEED_POST_STORAGE_KEY = "qrtz:pendingFeedPost";

export default function ComposeClient() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [defaultMarkNsfw, setDefaultMarkNsfw] = useState(false);
  const [profilePrefsReady, setProfilePrefsReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setProfilePrefsReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancelled) setProfilePrefsReady(true);
        return;
      }
      const { data: row, error } = await supabase
        .from("profiles")
        .select("default_posts_nsfw")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) console.error(error);
      setDefaultMarkNsfw(Boolean(row?.default_posts_nsfw));
      setProfilePrefsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (!supabase) {
    return (
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
        <p className="text-meta">
          Add <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_URL</code> and a publishable key to{" "}
          <code className="qrtz-code-inline">.env.local</code>.
        </p>
      </div>
    );
  }

  if (!profilePrefsReady) {
    return (
      <div
        className="qrtz-card mx-auto flex w-full max-w-md min-h-[12rem] flex-col items-center justify-center gap-1 border border-border-soft px-4 py-8 text-center"
        aria-busy="true"
        aria-label="Loading composer"
      >
        <p className="text-meta font-medium text-text">Loading composer…</p>
        <p className="text-meta text-text-muted">Checking your posting settings.</p>
      </div>
    );
  }

  return (
    <PostForm
      supabase={supabase}
      defaultMarkNsfw={defaultMarkNsfw}
      onPosted={async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: idRow } = await supabase
            .from("posts")
            .select("id")
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (idRow?.id) {
            const { data: feed } = await fetchFeedPosts(supabase, {
              viewerUserId: session.user.id,
            });
            const post = feed?.find((p) => p.id === idRow.id);
            if (post) {
              try {
                sessionStorage.setItem(PENDING_FEED_POST_STORAGE_KEY, JSON.stringify(post));
              } catch {
                /* storage full or disabled */
              }
            }
          }
        }
        router.push("/");
      }}
    />
  );
}
