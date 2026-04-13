"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeUsername } from "@/lib/username";
import ProfileUsernameLink from "./ProfileUsernameLink";
import ThemeAppearanceSettings from "./ThemeAppearanceSettings";

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
      <div className="w-full max-w-md p-6 rounded-lg border border-warning/40 bg-warning/10 text-text text-sm">
        <p className="font-medium">Supabase is not configured.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-6">
      <ThemeAppearanceSettings />
      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted mb-3">Account</h2>
        {user ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
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
                className="text-sm font-medium text-primary hover:text-primary-hover hover:underline w-fit transition-colors"
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
              className="w-fit py-2 px-4 rounded-md bg-text text-bg text-sm font-semibold hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            You&apos;re not signed in.{" "}
            <Link
              href="/"
              className="text-primary font-medium hover:text-primary-hover hover:underline transition-colors"
            >
              Go to Home
            </Link>{" "}
            to sign in.
          </p>
        )}
      </section>
    </div>
  );
}
