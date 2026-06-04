"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import {
  AUTH_FORGOT_PASSWORD_PATH,
  AUTH_MIN_PASSWORD_LENGTH,
  hashLooksLikePasswordRecovery,
} from "@/lib/auth/password-reset";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { InlineErrorBanner } from "./InlineErrorBanner";

type ResetPhase = "verifying" | "ready" | "invalid";

const RECOVERY_VERIFY_TIMEOUT_MS = 8_000;

const INVALID_LINK_MESSAGE =
  "This reset link is invalid, expired, or has already been used. Request a new link and try again.";

function recoveryLandingContext(initialHash: string): boolean {
  if (typeof window === "undefined") return hashLooksLikePasswordRecovery(initialHash);
  return hashLooksLikePasswordRecovery(initialHash || window.location.hash);
}

export default function ResetPasswordForm() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const initialHashRef = useRef(
    typeof window !== "undefined" ? window.location.hash : "",
  );
  const [phase, setPhase] = useState<ResetPhase>("verifying");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const recoveryReadyRef = useRef(false);

  const markReady = useCallback(() => {
    if (recoveryReadyRef.current) return;
    recoveryReadyRef.current = true;
    setPhase("ready");
  }, []);

  const markInvalid = useCallback(() => {
    if (recoveryReadyRef.current) return;
    setPhase("invalid");
  }, []);

  useEffect(() => {
    if (!supabase) {
      markInvalid();
      return;
    }

    if (typeof window !== "undefined" && window.location.hash) {
      initialHashRef.current = window.location.hash;
    }

    let cancelled = false;

    const evaluateSession = async (event?: AuthChangeEvent) => {
      if (cancelled || recoveryReadyRef.current) return;

      if (event === "PASSWORD_RECOVERY") {
        markReady();
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled || recoveryReadyRef.current) return;

      if (data.session && recoveryLandingContext(initialHashRef.current)) {
        markReady();
      }
    };

    void evaluateSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled || recoveryReadyRef.current) return;
      if (event === "PASSWORD_RECOVERY") {
        markReady();
        return;
      }
      if (session && recoveryLandingContext(initialHashRef.current)) {
        markReady();
      }
    });

    const timeoutId = window.setTimeout(() => {
      if (!recoveryReadyRef.current) markInvalid();
    }, RECOVERY_VERIFY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [supabase, markReady, markInvalid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!supabase || phase !== "ready") return;

    const next = password;
    if (!next) {
      setFormError("Enter a new password.");
      return;
    }
    if (next.length < AUTH_MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${AUTH_MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      router.replace("/");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Could not update your password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!supabase) {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-4">
        <InlineErrorBanner message="Supabase is not configured." onDismiss={() => {}} />
        <Link
          href={AUTH_FORGOT_PASSWORD_PATH}
          className="text-sm font-medium text-link transition-colors hover:text-link-hover hover:underline"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (phase === "verifying") {
    return (
      <div
        className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-3"
        aria-busy="true"
        aria-live="polite"
      >
        <h1 className="font-heading text-lg font-semibold text-text">Choose a new password</h1>
        <p className="text-sm text-text-secondary">Verifying your reset link…</p>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-4">
        <h1 className="font-heading text-lg font-semibold text-text">Reset link problem</h1>
        <InlineErrorBanner message={INVALID_LINK_MESSAGE} onDismiss={() => {}} />
        <Link
          href={AUTH_FORGOT_PASSWORD_PATH}
          className="qrtz-btn-primary px-4 py-2 text-center text-sm font-medium"
        >
          Request a new reset link
        </Link>
        <Link
          href="/"
          className="text-center text-sm text-link transition-colors hover:text-link-hover hover:underline"
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
        <h1 className="font-heading text-lg font-semibold text-text">Choose a new password</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Enter and confirm your new password below.
        </p>
      </div>

      {formError ? (
        <InlineErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password-new" className="text-sm font-medium text-text">
          New password
        </label>
        <input
          id="reset-password-new"
          type="password"
          required
          autoComplete="new-password"
          minLength={AUTH_MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="qrtz-field"
          disabled={loading}
        />
        <p className="text-meta text-text-muted">
          At least {AUTH_MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password-confirm" className="text-sm font-medium text-text">
          Confirm new password
        </label>
        <input
          id="reset-password-confirm"
          type="password"
          required
          autoComplete="new-password"
          minLength={AUTH_MIN_PASSWORD_LENGTH}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="qrtz-field"
          disabled={loading}
        />
      </div>

      <button type="submit" disabled={loading} className="qrtz-btn-primary px-4 py-2">
        {loading ? "Updating…" : "Update password"}
      </button>

      <Link
        href={AUTH_FORGOT_PASSWORD_PATH}
        className="text-sm text-link transition-colors hover:text-link-hover hover:underline"
      >
        Request a new reset link
      </Link>
    </form>
  );
}
