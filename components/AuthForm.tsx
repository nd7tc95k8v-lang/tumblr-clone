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
      <div className="w-full max-w-md mx-auto p-6 bg-zinc-100 dark:bg-zinc-900 rounded-lg shadow-md flex flex-col gap-3">
        <p className="text-zinc-800 dark:text-zinc-100 text-sm">
          {needsProfileSetup ? (
            <>Signed in. <span className="font-medium">Choose a username below</span> to finish.</>
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
          className="py-2 px-4 bg-zinc-700 text-white font-semibold rounded hover:bg-zinc-800 disabled:opacity-50"
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
        setMessage("Check your email to confirm, or sign in if confirmations are disabled.");
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
      className="flex flex-col gap-4 w-full max-w-md mx-auto p-6 bg-zinc-100 dark:bg-zinc-900 rounded-lg shadow-md"
    >
      <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h2>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <input
        type="password"
        required
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {message && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{message}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="py-2 px-4 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
