"use client";

import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/constants";
import { profileNeedsOnboarding } from "@/lib/username";
import ProfileUsernameLink from "./ProfileUsernameLink";

type Props = {
  supabase: SupabaseClient;
  username: string | null;
  onAuthChange: () => void;
};

/** Desktop sidebar: signed-in identity + sign out (anchored below main nav). */
export default function SidebarAccount({ supabase, username, onAuthChange }: Props) {
  const [loading, setLoading] = useState(false);
  const needsSetup = profileNeedsOnboarding(username);

  return (
    <div className="border-t border-border pt-4">
      <p className="text-meta leading-snug text-text">
        {needsSetup ? (
          <>
            Welcome to {APP_NAME}!{" "}
            <span className="font-medium">Finish setup on the home page</span> — choose a username to continue.
          </>
        ) : username ? (
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
      <button
        type="button"
        onClick={async () => {
          setLoading(true);
          await supabase.auth.signOut();
          setLoading(false);
          onAuthChange();
        }}
        disabled={loading}
        className="qrtz-btn-secondary mt-3 w-full px-3 py-2 text-meta"
      >
        {loading ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
