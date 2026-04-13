"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidUsernameFormat,
  normalizeUsername,
  usernameLooksLikeEmail,
} from "@/lib/username";
import type { ProfilePublic } from "@/types/profile";

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  profile: ProfilePublic;
  /** Must equal profile.id; updates are scoped to this id only. */
  userId: string;
  onSaved: (next: ProfilePublic) => void;
};

type Availability = "idle" | "checking" | "available" | "taken" | "invalid" | "yours";

export default function EditProfileModal({
  open,
  onClose,
  supabase,
  profile,
  userId,
  onSaved,
}: Props) {
  const [usernameRaw, setUsernameRaw] = useState(profile.username);
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsernameRaw(profile.username);
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setSaveError(null);
    setAvailability("idle");
  }, [open, profile]);

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
      if (normalized === normalizeUsername(profile.username)) {
        setAvailability("yours");
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
    [supabase, userId, profile.username],
  );

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      void checkAvailability(usernameRaw);
    }, 450);
    return () => window.clearTimeout(t);
  }, [usernameRaw, checkAvailability, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    if (userId !== profile.id) {
      setSaveError("You can only edit your own profile.");
      return;
    }

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user || user.id !== profile.id) {
      setSaveError("You can only edit your own profile.");
      return;
    }

    const normalized = normalizeUsername(usernameRaw);
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

    const displayTrim = displayName.trim();
    const bioTrim = bio.trim();

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: normalized,
          display_name: displayTrim.length > 0 ? displayTrim : null,
          bio: bioTrim.length > 0 ? bioTrim : null,
        })
        .eq("id", userId);

      if (error) {
        if (String(error.code) === "23505") {
          setSaveError("That username is already taken.");
        } else {
          setSaveError(error.message);
        }
        return;
      }

      onSaved({
        id: profile.id,
        username: normalized,
        display_name: displayTrim.length > 0 ? displayTrim : null,
        bio: bioTrim.length > 0 ? bioTrim : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const hint =
    availability === "invalid"
      ? "Use 3–20 characters: letters, numbers, or underscore."
      : availability === "taken"
        ? "That username is taken."
        : availability === "available"
          ? "This username is available."
          : availability === "yours"
            ? "Current username."
            : availability === "checking"
              ? "Checking…"
              : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        aria-modal="true"
        aria-labelledby="edit-profile-title"
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-700 p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="edit-profile-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Edit profile
        </h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-username" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Username
            </label>
            <input
              id="edit-username"
              type="text"
              autoComplete="username"
              value={usernameRaw}
              onChange={(e) => setUsernameRaw(e.target.value)}
              disabled={saving}
              className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {hint ? (
              <p
                className={
                  availability === "available" || availability === "yours"
                    ? "text-xs text-emerald-700 dark:text-emerald-400"
                    : availability === "taken" || availability === "invalid"
                      ? "text-xs text-red-700 dark:text-red-400"
                      : "text-xs text-zinc-500 dark:text-zinc-400"
                }
              >
                {hint}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="edit-display" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Display name <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              id="edit-display"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={saving}
              maxLength={80}
              className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="edit-bio" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Bio <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              id="edit-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={saving}
              rows={4}
              maxLength={500}
              className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y min-h-[80px]"
            />
          </div>

          {saveError ? <p className="text-sm text-red-700 dark:text-red-400">{saveError}</p> : null}

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="py-2 px-4 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="py-2 px-4 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
