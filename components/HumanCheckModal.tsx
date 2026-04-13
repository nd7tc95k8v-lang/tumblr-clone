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
      className="qrtz-modal-overlay z-[100]"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="human-check-title"
        onClick={(ev) => ev.stopPropagation()}
        className="qrtz-modal-panel"
      >
        <h2 id="human-check-title" className="mb-3 font-heading text-lg font-semibold text-text">
          Quick human check
        </h2>
        <p className="mb-4 text-meta leading-relaxed text-text-secondary">
          Once a day we ask for this before you post, reblog, or follow. No third-party CAPTCHA.
        </p>
        <p className="mb-4 text-base font-medium text-text">{challenge.prompt}</p>
        <form onSubmit={(ev) => void handleSubmit(ev)} className="flex flex-col gap-4">
          <input
            type="text"
            autoComplete="off"
            value={answer}
            onChange={(ev) => setAnswer(ev.target.value)}
            disabled={busy}
            className="qrtz-field"
            placeholder="Your answer"
          />
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="qrtz-btn-secondary px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="qrtz-btn-primary px-4 py-2 text-sm"
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
