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
  const pendingRef = useRef<Pending | null>(null);

  const flushAfterHumanCheck = useCallback(async () => {
    setHumanOpen(false);
    setHumanSupabase(null);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;

    try {
      const status = await fetchActionGuardStatus(pending.supabase);
      if (!status?.authenticated) {
        alert("You must be signed in.");
        return;
      }
      if (!status.human_check_ok) {
        alert(ACTION_GUARD_GENERIC_MESSAGE);
        return;
      }
      if (pending.spec.kind === "post" || pending.spec.kind === "reblog") {
        if (!status.post_rate_ok) {
          alert(POSTING_TOO_QUICK_MESSAGE);
          return;
        }
      }
      if (pending.spec.kind === "follow" && pending.spec.followMode === "insert") {
        if (!status.follow_insert_rate_ok) {
          alert(FOLLOW_RATE_LIMIT_MESSAGE);
          return;
        }
      }
      await pending.run();
    } finally {
      pending.onResume();
    }
  }, []);

  const runProtectedAction = useCallback<RunProtectedAction>(async (supabase, spec, run) => {
    const status = await fetchActionGuardStatus(supabase);
    if (!status) {
      alert(ACTION_GUARD_GENERIC_MESSAGE);
      return;
    }
    if (!status.authenticated) {
      alert("You must be signed in.");
      return;
    }

    if (spec.kind === "post" || spec.kind === "reblog") {
      if (!status.post_rate_ok) {
        alert(POSTING_TOO_QUICK_MESSAGE);
        return;
      }
    }
    if (spec.kind === "follow" && spec.followMode === "insert") {
      if (!status.follow_insert_rate_ok) {
        alert(FOLLOW_RATE_LIMIT_MESSAGE);
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
  }, []);

  const value = useMemo(() => ({ runProtectedAction }), [runProtectedAction]);

  return (
    <ActionGuardContext.Provider value={value}>
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
