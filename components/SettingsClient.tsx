"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeUsername } from "@/lib/username";
import ProfileUsernameLink from "./ProfileUsernameLink";

export default function SettingsClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    setUser(u ?? null);
    if (!u) {
      setUsername(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("username").eq("id", u.id).maybeSingle();
    const un = data?.username?.trim();
    setUsername(un && un.length > 0 ? un : null);
  }, [supabase]);

  useEffect(() => {
    void refresh();
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
      <div className="w-full max-w-md p-6 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-900 dark:text-amber-100 text-sm">
        <p className="font-medium">Supabase is not configured.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-6">
      <section className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
          Account
        </h2>
        {user ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {username ? (
                <>
                  Signed in as{" "}
                  <ProfileUsernameLink usernameRaw={username} className="font-medium text-inherit">
                    @{username}
                  </ProfileUsernameLink>
                </>
              ) : (
                <>Signed in.</>
              )}
            </p>
            {username ? (
              <Link
                href={`/profile/${encodeURIComponent(normalizeUsername(username))}`}
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline w-fit"
              >
                Open your profile
              </Link>
            ) : null}
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                await supabase.auth.signOut();
                setLoading(false);
                void refresh();
              }}
              className="w-fit py-2 px-4 rounded-md bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You&apos;re not signed in.{" "}
            <Link href="/" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
              Go to Home
            </Link>{" "}
            to sign in.
          </p>
        )}
      </section>
    </div>
  );
}
