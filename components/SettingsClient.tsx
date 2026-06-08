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
import QueueSettings from "./QueueSettings";

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface shadow-sm">
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
        <div className="mt-4 flex flex-col gap-4 sm:mt-5">{children}</div>
      </div>
    </section>
  );
}

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
      <div className="w-full max-w-4xl rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="font-medium">Supabase is not configured.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 sm:gap-10">
      <SettingsSection title="Appearance">
        <ThemeAppearanceSettings />
      </SettingsSection>

      {user ? (
        <SettingsSection title="Followed Tags">
          <FollowedTagsSettings supabase={supabase} user={user} />
        </SettingsSection>
      ) : null}

      {user ? (
        <SettingsSection title="Queue">
          <QueueSettings supabase={supabase} user={user} />
        </SettingsSection>
      ) : null}

      {user ? (
        <SettingsSection title="Content & Safety">
          <ContentSafetySettings supabase={supabase} user={user} />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Account">
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
                className="w-fit text-sm font-medium text-link transition-colors hover:text-link-hover hover:underline"
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
              className="font-medium text-link transition-colors hover:text-link-hover hover:underline"
            >
              Go to Home
            </Link>{" "}
            to sign in.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
