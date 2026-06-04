"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  AUTH_RESET_PASSWORD_PATH,
  FORGOT_PASSWORD_SUCCESS_MESSAGE,
} from "@/lib/auth/password-reset";
import { getAuthSiteOrigin } from "@/lib/auth/site-origin";
import { InlineErrorBanner } from "./InlineErrorBanner";

export default function ForgotPasswordForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!supabase) {
      setFormError("Sign-in is unavailable because Supabase is not configured.");
      return;
    }
    const trimmed = email.trim();
    if (!trimmed) {
      setFormError("Enter your email address.");
      return;
    }

    setLoading(true);
    try {
      const origin = getAuthSiteOrigin();
      const redirectTo = origin
        ? `${origin}${AUTH_RESET_PASSWORD_PATH}`
        : `${window.location.origin}${AUTH_RESET_PASSWORD_PATH}`;

      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo });
      if (error) {
        setFormError(
          error.message?.trim() || "Could not send reset email. Check your connection and try again.",
        );
        return;
      }
      setSubmitted(true);
    } catch {
      setFormError("Could not send reset email. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!supabase) {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-4 p-4 sm:p-6">
        <InlineErrorBanner message="Supabase is not configured." onDismiss={() => {}} />
        <Link
          href="/"
          className="text-sm font-medium text-link transition-colors hover:text-link-hover hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-4"
      noValidate
    >
      <div>
        <h1 className="font-heading text-lg font-semibold text-text">Reset your password</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Enter the email address for your account. We&apos;ll send reset instructions if an account
          exists.
        </p>
      </div>

      {formError ? (
        <InlineErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      ) : null}

      {submitted ? (
        <p className="text-sm text-success" role="status" aria-live="polite">
          {FORGOT_PASSWORD_SUCCESS_MESSAGE}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="forgot-password-email" className="text-sm font-medium text-text">
            Email
          </label>
          <input
            id="forgot-password-email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="qrtz-field"
            disabled={loading}
          />
        </div>
      )}

      {!submitted ? (
        <button type="submit" disabled={loading} className="qrtz-btn-primary px-4 py-2">
          {loading ? "Sending…" : "Send reset link"}
        </button>
      ) : null}

      <Link
        href="/"
        className="text-sm text-link transition-colors hover:text-link-hover hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}
