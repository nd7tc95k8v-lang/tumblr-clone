import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coerceQueueIntervalMinutes,
  QUEUE_INTERVAL_OPTIONS,
  type QueueIntervalMinutes,
  type QueueSettings,
  type SaveQueueSettingsInput,
} from "@/types/queue-settings";

const QUEUE_SETTINGS_SELECT = "queue_enabled, queue_interval_minutes, queue_next_run_at";

function hydrateQueueSettingsRow(row: Record<string, unknown>): QueueSettings {
  return {
    queue_enabled: Boolean(row.queue_enabled),
    queue_interval_minutes: coerceQueueIntervalMinutes(row.queue_interval_minutes),
    queue_next_run_at: row.queue_next_run_at == null ? null : String(row.queue_next_run_at),
  };
}

export async function fetchQueueSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: QueueSettings | null; error: { message: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(QUEUE_SETTINGS_SELECT)
    .eq("id", uid)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }
  if (!data) {
    return { data: null, error: { message: "Profile not found" } };
  }

  return { data: hydrateQueueSettingsRow(data as Record<string, unknown>), error: null };
}

export async function saveQueueSettings(
  supabase: SupabaseClient,
  userId: string,
  settings: SaveQueueSettingsInput,
): Promise<{ data: QueueSettings | null; error: { message: string; code?: string } | null }> {
  const uid = userId?.trim() ?? "";
  if (!uid) {
    return { data: null, error: { message: "Missing user id" } };
  }

  const interval = settings.queueIntervalMinutes;
  if (!QUEUE_INTERVAL_OPTIONS.some((o) => o.minutes === interval)) {
    return { data: null, error: { message: "Invalid queue interval." } };
  }

  const { data: current, error: fetchError } = await supabase
    .from("profiles")
    .select(QUEUE_SETTINGS_SELECT)
    .eq("id", uid)
    .maybeSingle();

  if (fetchError) {
    return { data: null, error: fetchError };
  }
  if (!current) {
    return { data: null, error: { message: "Profile not found" } };
  }

  const currentSettings = hydrateQueueSettingsRow(current as Record<string, unknown>);
  const wasEnabled = currentSettings.queue_enabled;
  const willEnable = Boolean(settings.queueEnabled);

  let queue_next_run_at: string | null;
  if (!willEnable) {
    queue_next_run_at = null;
  } else if (!wasEnabled) {
    queue_next_run_at = new Date().toISOString();
  } else {
    const existing = currentSettings.queue_next_run_at?.trim();
    queue_next_run_at = existing ? currentSettings.queue_next_run_at : new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      queue_enabled: willEnable,
      queue_interval_minutes: interval as QueueIntervalMinutes,
      queue_next_run_at,
    })
    .eq("id", uid)
    .select(QUEUE_SETTINGS_SELECT)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }
  if (!data) {
    return { data: null, error: { message: "Profile not found" } };
  }

  return { data: hydrateQueueSettingsRow(data as Record<string, unknown>), error: null };
}
