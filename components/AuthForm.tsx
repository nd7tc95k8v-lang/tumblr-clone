"use client";

import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/constants";

type Props = {
  supabase: SupabaseClient;
  onAuthChange: () => void;
};

/** Sign in / sign up only (signed-in account UI lives in the desktop sidebar). */
export default function AuthForm({ supabase, onAuthChange }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      <p className="-mt-1 text-sm text-text-secondary">
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
        className="text-sm text-link transition-colors hover:text-link-hover hover:underline"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
