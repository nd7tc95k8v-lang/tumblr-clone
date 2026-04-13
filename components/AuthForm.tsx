"use client";

import React, { useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/constants";
import ProfileUsernameLink from "./ProfileUsernameLink";

type Props = {
  supabase: SupabaseClient;
  user: User | null;
  onAuthChange: () => void;
  /** Public @handle when onboarding is complete (email is never shown). */
  publicUsername?: string | null;
  /** When true, prompt to finish username setup instead of showing a handle. */
  needsProfileSetup?: boolean;
};

export default function AuthForm({
  supabase,
  user,
  onAuthChange,
  publicUsername = null,
  needsProfileSetup = false,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (user) {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-3">
        <p className="text-text text-sm">
          {needsProfileSetup ? (
            <>
              Welcome to {APP_NAME}! <span className="font-medium">Choose a username below</span> to finish signup — you
              can add a photo and bio there too, or skip for now.
            </>
          ) : publicUsername ? (
            <>
              Signed in as{" "}
              <ProfileUsernameLink usernameRaw={publicUsername} className="font-medium text-inherit">
                @{publicUsername}
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
          className="qrtz-btn-secondary px-4 py-2"
        >
          Sign out
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage(
          "Check your email to confirm, or sign in if confirmations are disabled. After you sign in, you'll choose a username.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuthChange();
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-4"
    >
      <h2 className="font-heading text-lg font-semibold text-text">
        {mode === "signin" ? `Welcome to ${APP_NAME}` : `Join ${APP_NAME}`}
      </h2>
      <p className="text-sm text-text-secondary -mt-1">
        {mode === "signin"
          ? "Sign in with your email and password."
          : "Create an account with your email and password."}
      </p>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="qrtz-field"
      />
      <input
        type="password"
        required
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="qrtz-field"
      />
      {message && (
        <p className="text-sm text-warning">{message}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="qrtz-btn-primary px-4 py-2"
      >
        {loading ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
        className="text-sm text-link hover:text-link-hover hover:underline transition-colors"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
