"use client";

import Link from "next/link";
import React, { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/constants";
import { AUTH_FORGOT_PASSWORD_PATH } from "@/lib/auth/password-reset";

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
  const [signupSuccessEmail, setSignupSuccessEmail] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        const submittedEmail = email;
        setEmail("");
        setPassword("");
        setSignupSuccessEmail(submittedEmail);
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

  if (signupSuccessEmail) {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold text-text">Check your email</h2>
        <div className="flex flex-col gap-2 text-sm text-text-secondary">
          <p className="text-success" role="status" aria-live="polite">
            A verification email has been sent to{" "}
            <span className="font-medium text-text">{signupSuccessEmail}</span>.
          </p>
          <p>Click the link in that email to verify your account.</p>
          <p>After verification, you&apos;ll choose a username.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSignupSuccessEmail(null);
            setMode("signin");
            setMessage(null);
          }}
          className="qrtz-btn-primary px-4 py-2"
        >
          Back to sign in
        </button>
      </div>
    );
  }

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
      {mode === "signin" ? (
        <Link
          href={AUTH_FORGOT_PASSWORD_PATH}
          className="-mt-1 text-sm text-link transition-colors hover:text-link-hover hover:underline"
        >
          Forgot password?
        </Link>
      ) : null}
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
          setSignupSuccessEmail(null);
        }}
        className="text-sm text-link transition-colors hover:text-link-hover hover:underline"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
