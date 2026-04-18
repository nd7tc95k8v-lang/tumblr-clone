"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type {
  AdminTagEngagementRow,
  AdminTagEngagementWindow,
} from "@/lib/supabase/fetch-admin-tag-engagement";

type LoadState = "idle" | "loading" | "done";

type Props = {
  allowlistConfigured: boolean;
};

const DISCOVERY_OPTIONS: { value: AdminTagEngagementWindow; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

const ENGAGEMENT_OPTIONS: { value: AdminTagEngagementWindow; label: string }[] = [
  { value: "all", label: "All engagement" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export default function AdminTagEngagementClient({ allowlistConfigured }: Props) {
  const [state, setState] = useState<LoadState>("idle");
  const [timeWindow, setTimeWindow] = useState<AdminTagEngagementWindow>("all");
  const [engagementWindow, setEngagementWindow] = useState<AdminTagEngagementWindow>("all");
  const [rows, setRows] = useState<AdminTagEngagementRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setForbiddenMessage(null);
    setErrorMessage(null);

    if (!allowlistConfigured) {
      setState("done");
      setRows([]);
      return;
    }

    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setState("done");
      setErrorMessage("App is not configured for Supabase.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setState("done");
      setForbiddenMessage("Sign in to view this page.");
      setRows(null);
      return;
    }

    setState("loading");
    const params = new URLSearchParams();
    if (timeWindow !== "all") params.set("window", timeWindow);
    if (engagementWindow !== "all") params.set("engagement_window", engagementWindow);
    const qs = params.size > 0 ? `?${params.toString()}` : "";

    const res = await fetch(`/api/admin/tag-engagement${qs}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = (await res.json().catch(() => ({}))) as { data?: AdminTagEngagementRow[]; error?: string };

    if (!res.ok) {
      setState("done");
      setRows([]);
      if (res.status === 403) {
        setForbiddenMessage(body.error ?? "You do not have access to this page.");
      } else {
        setErrorMessage(body.error ?? `Request failed (${res.status}).`);
      }
      return;
    }

    setRows(Array.isArray(body.data) ? body.data : []);
    setState("done");
  }, [allowlistConfigured, timeWindow, engagementWindow]);

  useEffect(() => {
    void load();
  }, [load]);

  const windowToolbar =
    allowlistConfigured ? (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Posts in window (discovery)">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Posts</span>
          <div className="flex flex-wrap gap-1.5">
            {DISCOVERY_OPTIONS.map(({ value, label }) => {
              const selected = timeWindow === value;
              const busy = state === "loading";
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => setTimeWindow(value)}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
                    selected
                      ? "border-border bg-surface text-text shadow-sm"
                      : "border-transparent bg-bg-secondary text-text-secondary hover:bg-bg-secondary/80 hover:text-text",
                    busy ? "cursor-wait opacity-70" : "",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Engagement counting">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Engagement</span>
          <div className="flex flex-wrap gap-1.5">
            {ENGAGEMENT_OPTIONS.map(({ value, label }) => {
              const selected = engagementWindow === value;
              const busy = state === "loading";
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => setEngagementWindow(value)}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
                    selected
                      ? "border-border bg-surface text-text shadow-sm"
                      : "border-transparent bg-bg-secondary text-text-secondary hover:bg-bg-secondary/80 hover:text-text",
                    busy ? "cursor-wait opacity-70" : "",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    ) : null;

  if (state === "idle" || state === "loading") {
    return (
      <div className="flex flex-col gap-4">
        {windowToolbar}
        <p className="text-sm text-text-muted" role="status">
          Loading tag analytics…
        </p>
      </div>
    );
  }

  if (!allowlistConfigured) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
        Set the <span className="font-mono text-text">ADMIN_USER_IDS</span> environment variable to a comma-separated
        list of Supabase user IDs to enable this page.
      </p>
    );
  }

  if (forbiddenMessage) {
    return (
      <div className="flex flex-col gap-4">
        {windowToolbar}
        <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
          {forbiddenMessage}
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex flex-col gap-4">
        {windowToolbar}
        <div
          className="rounded-lg border border-error/40 bg-surface px-4 py-3 text-sm text-error"
          role="alert"
        >
          {errorMessage}
        </div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {windowToolbar}
        <p className="text-sm text-text-muted">
          {timeWindow === "all"
            ? "No tag engagement data yet. Tags must be stored on posts to appear here."
            : "No posts with tags in this post window yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {windowToolbar}
      <div className="w-full overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/80 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">Tag</th>
              <th className="px-4 py-3 font-medium text-right">Posts</th>
              <th className="px-4 py-3 font-medium text-right">Likes</th>
              <th className="px-4 py-3 font-medium text-right">Reblogs</th>
              <th className="px-4 py-3 font-medium text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tag} className="border-b border-border/70 last:border-0 hover:bg-bg-secondary/40">
                <td className="px-4 py-2.5 font-medium text-text">#{r.tag}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{r.post_count}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{r.total_likes}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{r.total_reblogs}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-text">{r.engagement_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
