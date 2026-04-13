"use client";

import React, { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentHumanChallenge } from "@/lib/action-guard/challenges";

type Props = {
  open: boolean;
  supabase: SupabaseClient | null;
  onClose: () => void;
  /** Called after RPC succeeds and modal can close. */
  onComplete: () => void;
};

type MarkHumanResult = { ok?: boolean; error?: string };

export default function HumanCheckModal({ open, supabase, onClose, onComplete }: Props) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const challenge = getCurrentHumanChallenge();

  useEffect(() => {
    if (!open) return;
    setAnswer("");
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalized = answer.trim().toLowerCase();
    if (!challenge.validate(normalized)) {
      setError("That doesn't match. Check the prompt and try again.");
      return;
    }
    if (!supabase) {
      setError("Not connected.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("mark_human_check_passed");
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const row = data as MarkHumanResult | null;
      if (!row?.ok) {
        setError(row?.error === "not_authenticated" ? "Sign in again." : "Could not verify. Try again.");
        return;
      }
      onComplete();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="human-check-title"
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-surface-elevated shadow-xl border border-border p-6"
      >
        <h2 id="human-check-title" className="text-lg font-semibold text-text mb-2">
          Quick human check
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Once a day we ask for this before you post, reblog, or follow. No third-party CAPTCHA.
        </p>
        <p className="text-sm text-text mb-3">{challenge.prompt}</p>
        <form onSubmit={(ev) => void handleSubmit(ev)} className="flex flex-col gap-3">
          <input
            type="text"
            autoComplete="off"
            value={answer}
            onChange={(ev) => setAnswer(ev.target.value)}
            disabled={busy}
            className="w-full p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus"
            placeholder="Your answer"
          />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="py-2 px-4 rounded border border-border bg-surface text-text text-sm font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="py-2 px-4 rounded bg-primary text-white text-sm font-semibold hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50 transition-colors"
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
