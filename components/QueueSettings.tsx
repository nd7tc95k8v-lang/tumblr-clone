"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { formatPostTime } from "@/lib/feed-post-display";
import { fetchQueueSettings, saveQueueSettings } from "@/lib/supabase/queue-settings";
import {
  QUEUE_INTERVAL_OPTIONS,
  type QueueIntervalMinutes,
  type QueueSettings,
} from "@/types/queue-settings";
import { InlineErrorBanner } from "./InlineErrorBanner";

type Props = {
  supabase: SupabaseClient;
  user: User;
};

export default function QueueSettings({ supabase, user }: Props) {
  const userId = user.id;
  const [loading, setLoading] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [queueEnabled, setQueueEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState<QueueIntervalMinutes>(240);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);

  const applySettings = useCallback((settings: QueueSettings) => {
    setQueueEnabled(settings.queue_enabled);
    setIntervalMinutes(settings.queue_interval_minutes);
    setNextRunAt(settings.queue_next_run_at);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await fetchQueueSettings(supabase, userId);
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    if (data) applySettings(data);
    setLoading(false);
  }, [supabase, userId, applySettings]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadSettings();
    });
  }, [loadSettings]);

  const handleSave = async () => {
    setSaveBusy(true);
    setSaveError(null);
    setSaveMessage(null);

    const {
      data: { user: authUser },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !authUser || authUser.id !== userId) {
      setSaveError("You can only update your own settings.");
      setSaveBusy(false);
      return;
    }

    const { data, error } = await saveQueueSettings(supabase, userId, {
      queueEnabled,
      queueIntervalMinutes: intervalMinutes,
    });

    if (error || !data) {
      setSaveError(error?.message ?? "Could not save queue settings.");
      setSaveBusy(false);
      return;
    }

    applySettings(data);
    setSaveMessage("Queue settings saved.");
    setSaveBusy(false);
  };

  const nextRunLabel =
    queueEnabled && nextRunAt?.trim() ? formatPostTime(nextRunAt) : "Not scheduled";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-snug text-text-secondary">
        When enabled, QrtzApp will publish one queued post at each interval.
      </p>
      <p className="text-meta leading-snug text-text-muted">Actual timing may vary by a few minutes.</p>

      <InlineErrorBanner message={loadError} onDismiss={() => setLoadError(null)} />
      <InlineErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />

      {saveMessage ? (
        <p role="status" className="text-sm text-text-secondary">
          {saveMessage}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-text-muted" aria-busy="true">
          Loading queue settings…
        </p>
      ) : (
        <>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={queueEnabled}
              onChange={(e) => {
                setQueueEnabled(e.target.checked);
                setSaveMessage(null);
              }}
              disabled={saveBusy}
              className="qrtz-checkbox mt-0.5"
            />
            <span>
              <span className="font-medium text-text">Enable queue schedule</span>
              <span className="mt-0.5 block text-meta leading-snug text-text-muted">
                Publishes the next item in your queue on the interval below.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-interval" className="text-sm font-medium text-text">
              Publish interval
            </label>
            <select
              id="queue-interval"
              value={intervalMinutes}
              onChange={(e) => {
                setIntervalMinutes(Number(e.target.value) as QueueIntervalMinutes);
                setSaveMessage(null);
              }}
              disabled={saveBusy || !queueEnabled}
              className="qrtz-field max-w-xs py-2 text-sm disabled:opacity-50"
            >
              {QUEUE_INTERVAL_OPTIONS.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-meta text-text-muted">
            Next run:{" "}
            <span className="text-text-secondary" title={queueEnabled ? (nextRunAt ?? undefined) : undefined}>
              {nextRunLabel}
            </span>
          </p>

          <Link
            href="/queue"
            className="text-sm font-medium text-text-secondary underline-offset-2 hover:text-text hover:underline"
          >
            View queue
          </Link>

          <button
            type="button"
            disabled={saveBusy || loading}
            onClick={() => void handleSave()}
            className="qrtz-btn-secondary w-fit px-4 py-2 text-sm disabled:opacity-50"
          >
            {saveBusy ? "Saving…" : "Save queue settings"}
          </button>
        </>
      )}
    </div>
  );
}
