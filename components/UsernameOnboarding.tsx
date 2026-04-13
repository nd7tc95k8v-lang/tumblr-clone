"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidUsernameFormat, normalizeUsername, usernameLooksLikeEmail } from "@/lib/username";

type Props = {
  supabase: SupabaseClient;
  userId: string;
  onComplete: () => void | Promise<void>;
};

type Availability = "idle" | "checking" | "available" | "taken" | "invalid" | "yours";

export default function UsernameOnboarding({ supabase, userId, onComplete }: Props) {
  const [raw, setRaw] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const checkAvailability = useCallback(
    async (value: string) => {
      const normalized = normalizeUsername(value);
      if (!normalized) {
        setAvailability("idle");
        return;
      }
      if (usernameLooksLikeEmail(normalized) || !isValidUsernameFormat(normalized)) {
        setAvailability("invalid");
        return;
      }
      setAvailability("checking");
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", normalized)
        .maybeSingle();
      if (error) {
        setAvailability("idle");
        return;
      }
      if (!data) {
        setAvailability("available");
        return;
      }
      setAvailability(data.id === userId ? "yours" : "taken");
    },
    [supabase, userId],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void checkAvailability(raw);
    }, 450);
    return () => window.clearTimeout(t);
  }, [raw, checkAvailability]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    const normalized = normalizeUsername(raw);
    if (!normalized) {
      setSaveError("Enter a username.");
      return;
    }
    if (usernameLooksLikeEmail(normalized) || !isValidUsernameFormat(normalized)) {
      setSaveError("Choose a valid username (3–20 letters, numbers, or _).");
      return;
    }
    const { data: row } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", normalized)
      .maybeSingle();
    if (row && row.id !== userId) {
      setSaveError("That username is already taken.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({ username: normalized }).eq("id", userId);
      if (error) {
        if (String(error.code) === "23505") {
          setSaveError("That username is already taken.");
        } else {
          setSaveError(error.message);
        }
        return;
      }
      await onComplete();
    } finally {
      setSaving(false);
    }
  };

  const hint =
    availability === "invalid"
      ? "Use 3–20 characters: letters, numbers, or underscore. No email addresses."
      : availability === "taken"
        ? "That username is taken."
        : availability === "available"
          ? "This username is available."
          : availability === "yours"
            ? "This is already your username — save to continue."
            : availability === "checking"
              ? "Checking…"
              : null;

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-zinc-100 dark:bg-zinc-900 rounded-lg shadow-md">
      <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-1">Choose your username</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        This is how you appear on posts. It is public and must be unique.
      </p>
      <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-3">
        <label htmlFor="onboard-username" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Username
        </label>
        <input
          id="onboard-username"
          type="text"
          autoComplete="username"
          placeholder="your_name"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          disabled={saving}
          className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {hint ? (
          <p
            className={
              availability === "available" || availability === "yours"
                ? "text-sm text-emerald-700 dark:text-emerald-400"
                : availability === "taken" || availability === "invalid"
                  ? "text-sm text-red-700 dark:text-red-400"
                  : "text-sm text-zinc-500 dark:text-zinc-400"
            }
          >
            {hint}
          </p>
        ) : null}
        {saveError ? <p className="text-sm text-red-700 dark:text-red-400">{saveError}</p> : null}
        <button
          type="submit"
          disabled={saving || !normalizeUsername(raw)}
          className="py-2 px-4 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
