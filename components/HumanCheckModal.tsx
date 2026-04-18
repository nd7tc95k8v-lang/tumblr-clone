"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickRandomHumanChallenge,
  type HumanMcqChallengeInstance,
} from "@/lib/action-guard/challenges";

type Props = {
  open: boolean;
  supabase: SupabaseClient | null;
  onClose: () => void;
  /** Called after RPC succeeds and modal can close. */
  onComplete: () => void;
};

type MarkHumanResult = { ok?: boolean; error?: string };

export default function HumanCheckModal({ open, supabase, onClose, onComplete }: Props) {
  const [challenge, setChallenge] = useState<HumanMcqChallengeInstance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setChallenge(null);
      return;
    }
    setChallenge(pickRandomHumanChallenge());
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (open && firstButtonRef.current) {
      firstButtonRef.current.focus({ preventScroll: true });
    }
  }, [open, challenge]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const passHumanCheck = useCallback(async () => {
    if (!supabase) {
      setError("Not connected.");
      return;
    }
    setBusy(true);
    setError(null);
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
  }, [supabase, onComplete]);

  const handleChoice = useCallback(
    (option: string) => {
      if (busy || !challenge) return;
      if (option !== challenge.correct) {
        setError("Not quite — here's another one.");
        setChallenge(pickRandomHumanChallenge());
        return;
      }
      void passHumanCheck();
    },
    [busy, challenge, passHumanCheck],
  );

  if (!open || !challenge) return null;

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
        <h2 id="human-check-title" className="mb-2 font-heading text-lg font-semibold text-text">
          Quick check
        </h2>
        <p className="mb-1 text-base text-text-secondary">Answer one short question to continue.</p>
        <p className="mb-4 text-meta leading-relaxed text-text-muted">
          We ask once a day before you post, reblog, or follow — no third-party CAPTCHA.
        </p>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-3 w-full text-base font-medium text-text">{challenge.prompt}</legend>
          <div className="flex flex-col gap-2">
            {challenge.options.map((opt, i) => (
              <button
                key={`${challenge.instanceKey}-${i}`}
                ref={i === 0 ? firstButtonRef : undefined}
                type="button"
                disabled={busy}
                onClick={() => handleChoice(opt)}
                className="qrtz-btn-secondary w-full justify-start px-4 py-3 text-sm"
              >
                {opt}
              </button>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p className="mt-3 text-sm text-error" role="status" aria-live="polite">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="qrtz-btn-secondary px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
