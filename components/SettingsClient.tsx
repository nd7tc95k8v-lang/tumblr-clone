"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeUsername } from "@/lib/username";
import ProfileUsernameLink from "./ProfileUsernameLink";
import ThemeAppearanceSettings from "./ThemeAppearanceSettings";
import ContentSafetySettings from "./ContentSafetySettings";
import FollowedTagsSettings from "./FollowedTagsSettings";

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
      <div className="w-full max-w-2xl md:max-w-3xl rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="font-medium">Supabase is not configured.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl md:max-w-3xl flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <ThemeAppearanceSettings />
        </div>
        {user ? <ContentSafetySettings supabase={supabase} user={user} /> : null}
        {user ? <FollowedTagsSettings supabase={supabase} user={user} /> : null}
        <section className={user ? "qrtz-card" : "qrtz-card md:col-span-2"}>
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
                  className="text-sm font-medium text-link hover:text-link-hover hover:underline w-fit transition-colors"
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
                className="qrtz-btn-secondary w-fit px-4 py-2 text-sm"
              >
                {loading ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              You&apos;re not signed in.{" "}
              <Link
                href="/"
                className="text-link font-medium hover:text-link-hover hover:underline transition-colors"
              >
                Go to Home
              </Link>{" "}
              to sign in.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
