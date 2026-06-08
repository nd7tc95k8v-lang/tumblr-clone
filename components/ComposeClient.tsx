"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchDraftById } from "@/lib/supabase/fetch-drafts";
import { fetchFeedPostById } from "@/lib/supabase/fetch-feed-posts";
import type { PostDraft } from "@/types/draft";
import PostForm from "./PostForm";

/** Must match `HomeClient` — sessionStorage handoff for optimistic feed merge after compose. */
const PENDING_FEED_POST_STORAGE_KEY = "qrtz:pendingFeedPost";

export default function ComposeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft")?.trim() ?? "";
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [defaultMarkNsfw, setDefaultMarkNsfw] = useState(false);
  const [profilePrefsReady, setProfilePrefsReady] = useState(false);
  const [draft, setDraft] = useState<PostDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftIdParam));
  const [draftError, setDraftError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!draftIdParam) {
      setDraft(null);
      setDraftLoading(false);
      setDraftError(null);
      return;
    }
    if (!supabase || !profilePrefsReady) return;

    let cancelled = false;
    void (async () => {
      setDraftLoading(true);
      setDraftError(null);
      setDraft(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancelled) {
          setDraftError("Sign in to edit this draft.");
          setDraftLoading(false);
        }
        return;
      }

      const { data, error } = await fetchDraftById(supabase, draftIdParam, session.user.id);
      if (cancelled) return;

      if (error) {
        setDraftError(error.message);
      } else if (!data) {
        setDraftError("Draft not found or you don't have access.");
      } else {
        setDraft(data);
      }
      setDraftLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [draftIdParam, supabase, profilePrefsReady]);

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

  if (!profilePrefsReady || (draftIdParam && draftLoading)) {
    return (
      <div
        className="qrtz-card mx-auto flex w-full max-w-md min-h-[12rem] flex-col items-center justify-center gap-1 border border-border-soft px-4 py-8 text-center"
        aria-busy="true"
        aria-label={draftIdParam ? "Loading draft" : "Loading composer"}
      >
        <p className="text-meta font-medium text-text">
          {draftIdParam ? "Loading draft…" : "Loading composer…"}
        </p>
        <p className="text-meta text-text-muted">
          {draftIdParam ? "Fetching your saved draft." : "Checking your posting settings."}
        </p>
      </div>
    );
  }

  if (draftIdParam && draftError) {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-6 text-center">
        <p className="text-sm font-medium text-text">Could not open draft</p>
        <p className="text-sm text-text-secondary">{draftError}</p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/drafts" className="qrtz-btn-secondary inline-block px-4 py-2 text-sm">
            Back to Drafts
          </Link>
          <Link href="/compose" className="qrtz-btn-primary inline-block px-4 py-2 text-sm">
            New post
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <nav
        className="mx-auto flex w-full max-w-md items-center justify-end gap-2 text-meta text-text-muted"
        aria-label="Drafts and queue shortcuts"
      >
        <Link href="/drafts" className="text-link hover:text-link-hover hover:underline transition-colors">
          Drafts
        </Link>
        <span aria-hidden className="text-text-muted/50">
          ·
        </span>
        <Link href="/queue" className="text-link hover:text-link-hover hover:underline transition-colors">
          Queue
        </Link>
      </nav>
      <PostForm
      key={draftIdParam || "new-compose"}
      supabase={supabase}
      defaultMarkNsfw={defaultMarkNsfw}
      initialDraft={draftIdParam ? draft : null}
      onPosted={async (postId) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: post } = await fetchFeedPostById(supabase, postId, session.user.id);
          if (post) {
            try {
              sessionStorage.setItem(PENDING_FEED_POST_STORAGE_KEY, JSON.stringify(post));
            } catch {
              /* storage full or disabled */
            }
          }
        }
        router.push("/");
      }}
    />
    </div>
  );
}
