"use client";

import React, { useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
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
      <div className="w-full max-w-md mx-auto p-6 bg-bg-secondary rounded-lg shadow-md border border-border flex flex-col gap-3">
        <p className="text-text text-sm">
          {needsProfileSetup ? (
            <>
              Welcome! <span className="font-medium">Choose a username below</span> to finish signup — you can add a
              photo and bio there too, or skip for now.
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
          className="py-2 px-4 bg-text text-bg font-semibold rounded hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity"
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
      className="flex flex-col gap-4 w-full max-w-md mx-auto p-6 bg-bg-secondary rounded-lg shadow-md border border-border"
    >
      <h2 className="text-lg font-semibold text-text">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h2>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus"
      />
      <input
        type="password"
        required
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus"
      />
      {message && (
        <p className="text-sm text-warning">{message}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="py-2 px-4 bg-primary text-white font-semibold rounded hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50 transition-colors"
      >
        {loading ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
        className="text-sm text-primary hover:text-primary-hover hover:underline transition-colors"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
