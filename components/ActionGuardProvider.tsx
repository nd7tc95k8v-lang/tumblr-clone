"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTION_GUARD_GENERIC_MESSAGE,
  FOLLOW_RATE_LIMIT_MESSAGE,
  POSTING_TOO_QUICK_MESSAGE,
} from "@/lib/action-guard/constants";
import { fetchActionGuardStatus } from "@/lib/action-guard/fetch-action-guard-status";
import type { ProtectedActionSpec, RunProtectedAction } from "@/lib/action-guard/types";
import HumanCheckModal from "./HumanCheckModal";
import { InlineErrorBanner } from "./InlineErrorBanner";

type Pending = {
  spec: ProtectedActionSpec;
  run: () => Promise<void>;
  supabase: SupabaseClient;
  onResume: () => void;
};

type ActionGuardContextValue = {
  runProtectedAction: RunProtectedAction;
};

const ActionGuardContext = createContext<ActionGuardContextValue | null>(null);

export function useActionGuard(): ActionGuardContextValue {
  const ctx = useContext(ActionGuardContext);
  if (!ctx) {
    throw new Error("useActionGuard must be used within ActionGuardProvider");
  }
  return ctx;
}

export default function ActionGuardProvider({ children }: { children: React.ReactNode }) {
  const [humanOpen, setHumanOpen] = useState(false);
  const [humanSupabase, setHumanSupabase] = useState<SupabaseClient | null>(null);
  const [guardNotice, setGuardNotice] = useState<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const clearGuardNotice = useCallback(() => {
    setGuardNotice(null);
  }, []);

  /** Avoid re-setting state when the same notice is already visible. */
  const showGuardNotice = useCallback((message: string) => {
    setGuardNotice((prev) => (prev === message ? prev : message));
  }, []);

  const flushAfterHumanCheck = useCallback(async () => {
    setHumanOpen(false);
    setHumanSupabase(null);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;

    try {
      const status = await fetchActionGuardStatus(pending.supabase);
      if (!status?.authenticated) {
        showGuardNotice("You must be signed in.");
        return;
      }
      if (!status.human_check_ok) {
        showGuardNotice(ACTION_GUARD_GENERIC_MESSAGE);
        return;
      }
      if (pending.spec.kind === "post" || pending.spec.kind === "reblog") {
        if (!status.post_rate_ok) {
          showGuardNotice(POSTING_TOO_QUICK_MESSAGE);
          return;
        }
      }
      if (pending.spec.kind === "follow" && pending.spec.followMode === "insert") {
        if (!status.follow_insert_rate_ok) {
          showGuardNotice(FOLLOW_RATE_LIMIT_MESSAGE);
          return;
        }
      }
      await pending.run();
      clearGuardNotice();
    } finally {
      pending.onResume();
    }
  }, [showGuardNotice, clearGuardNotice]);

  const runProtectedAction = useCallback<RunProtectedAction>(
    async (supabase, spec, run) => {
      clearGuardNotice();

      const status = await fetchActionGuardStatus(supabase);
      if (!status) {
        showGuardNotice(ACTION_GUARD_GENERIC_MESSAGE);
        return;
      }
      if (!status.authenticated) {
        showGuardNotice("You must be signed in.");
        return;
      }

      if (spec.kind === "post" || spec.kind === "reblog") {
        if (!status.post_rate_ok) {
          showGuardNotice(POSTING_TOO_QUICK_MESSAGE);
          return;
        }
      }
      if (spec.kind === "follow" && spec.followMode === "insert") {
        if (!status.follow_insert_rate_ok) {
          showGuardNotice(FOLLOW_RATE_LIMIT_MESSAGE);
          return;
        }
      }

      if (!status.human_check_ok) {
        await new Promise<void>((resolve) => {
          pendingRef.current = { spec, run, supabase, onResume: resolve };
          setHumanSupabase(supabase);
          setHumanOpen(true);
        });
        return;
      }

      await run();
      clearGuardNotice();
    },
    [clearGuardNotice, showGuardNotice],
  );

  const value = useMemo(() => ({ runProtectedAction }), [runProtectedAction]);

  return (
    <ActionGuardContext.Provider value={value}>
      {guardNotice ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
          role="presentation"
        >
          <div className="pointer-events-auto w-full max-w-3xl">
            <InlineErrorBanner message={guardNotice} onDismiss={clearGuardNotice} />
          </div>
        </div>
      ) : null}
      {children}
      <HumanCheckModal
        open={humanOpen}
        supabase={humanSupabase}
        onClose={() => {
          const p = pendingRef.current;
          pendingRef.current = null;
          setHumanOpen(false);
          setHumanSupabase(null);
          p?.onResume();
        }}
        onComplete={() => void flushAfterHumanCheck()}
      />
    </ActionGuardContext.Provider>
  );
}
