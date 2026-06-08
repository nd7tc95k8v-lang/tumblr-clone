/** Allowed values for `profiles.queue_interval_minutes`. */
export type QueueIntervalMinutes = 60 | 120 | 240 | 480 | 1440;

export type QueueSettings = {
  queue_enabled: boolean;
  queue_interval_minutes: QueueIntervalMinutes;
  queue_next_run_at: string | null;
};

export const QUEUE_INTERVAL_OPTIONS: ReadonlyArray<{
  minutes: QueueIntervalMinutes;
  label: string;
}> = [
  { minutes: 60, label: "Every hour" },
  { minutes: 120, label: "Every 2 hours" },
  { minutes: 240, label: "Every 4 hours" },
  { minutes: 480, label: "Every 8 hours" },
  { minutes: 1440, label: "Daily" },
];

const ALLOWED_INTERVALS = new Set<number>(QUEUE_INTERVAL_OPTIONS.map((o) => o.minutes));

export function coerceQueueIntervalMinutes(raw: unknown): QueueIntervalMinutes {
  const n = Number(raw);
  if (ALLOWED_INTERVALS.has(n)) return n as QueueIntervalMinutes;
  return 240;
}

export type SaveQueueSettingsInput = {
  queueEnabled: boolean;
  queueIntervalMinutes: QueueIntervalMinutes;
};
