"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_IMAGE_MIME_TYPES, validateImageFile } from "@/lib/image-upload-validation";
import { APP_NAME } from "@/lib/constants";
import {
  describeUsernameFieldError,
  normalizeUsername,
  validateUsernameNormalized,
} from "@/lib/username";
import { uploadProfileAvatar } from "@/lib/upload-profile-avatar";
import ProfileAvatar from "./ProfileAvatar";

type Props = {
  supabase: SupabaseClient;
  userId: string;
  onComplete: () => void | Promise<void>;
};

type Availability = "idle" | "checking" | "available" | "taken" | "invalid" | "yours";

const inputClass = "qrtz-field";

export default function UsernameOnboarding({ supabase, userId, onComplete }: Props) {
  const [raw, setRaw] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [availability, setAvailability] = useState<Availability>("idle");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarFile) {
      setLocalPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const checkAvailability = useCallback(
    async (value: string) => {
      const normalized = normalizeUsername(value);
      if (!normalized) {
        setAvailability("idle");
        return;
      }
      if (describeUsernameFieldError(normalized)) {
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
    const usernameCheck = validateUsernameNormalized(normalized);
    if (!usernameCheck.ok) {
      setSaveError(usernameCheck.message);
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
      let avatarUrl: string | null = null;
      if (avatarFile) {
        const up = await uploadProfileAvatar(supabase, userId, avatarFile);
        if ("error" in up) {
          setSaveError(up.error);
          return;
        }
        avatarUrl = up.publicUrl;
      }

      const update: {
        username: string;
        display_name: string | null;
        bio: string | null;
        avatar_url?: string | null;
      } = {
        username: normalized,
        display_name: displayTrim.length > 0 ? displayTrim : null,
        bio: bioTrim.length > 0 ? bioTrim : null,
      };
      if (avatarUrl !== null) {
        update.avatar_url = avatarUrl;
      }

      const { error } = await supabase.from("profiles").update(update).eq("id", userId);
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

  const normalizedForHint = normalizeUsername(raw);
  const hint =
    availability === "invalid"
      ? describeUsernameFieldError(normalizedForHint) ?? "That username is not allowed."
      : availability === "taken"
        ? "That username is taken."
        : availability === "available"
          ? "This username is available."
          : availability === "yours"
            ? "This is already your username — save to continue."
            : availability === "checking"
              ? "Checking…"
              : null;

  const previewLabel =
    displayName.trim().length > 0 ? displayName.trim() : normalizeUsername(raw) ? `@${normalizeUsername(raw)}` : "You";

  return (
    <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-6">
      <div>
        <h2 className="mb-1 font-heading text-lg font-semibold text-text">
          Welcome to {APP_NAME} — set up your profile
        </h2>
        <p className="text-sm text-text-secondary">
          Pick a public username (required). You can add a display name, bio, or photo now, or skip and edit later in
          your profile.
        </p>
      </div>

      <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="onboard-username" className="text-sm font-medium text-text-secondary">
            Username <span className="text-error">*</span>
          </label>
          <input
            id="onboard-username"
            type="text"
            autoComplete="username"
            placeholder="your_name"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            disabled={saving}
            className={inputClass}
          />
          {hint ? (
            <p
              className={
                availability === "available" || availability === "yours"
                  ? "text-sm text-success"
                  : availability === "taken" || availability === "invalid"
                    ? "text-sm text-error"
                    : "text-sm text-text-muted"
              }
            >
              {hint}
            </p>
          ) : null}
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">Optional</p>
          <div className="flex flex-wrap items-start gap-4 mb-4">
            <ProfileAvatar url={localPreviewUrl} label={previewLabel} size="lg" className="shrink-0" />
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <label htmlFor="onboard-avatar" className="text-sm font-medium text-text-secondary">
                Profile photo
              </label>
              <input
                ref={avatarInputRef}
                id="onboard-avatar"
                type="file"
                accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                disabled={saving}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (!f) {
                    setAvatarFile(null);
                    return;
                  }
                  const img = validateImageFile(f);
                  if (!img.ok) {
                    alert(img.error);
                    e.target.value = "";
                    return;
                  }
                  setAvatarFile(f);
                }}
                className="text-sm text-text-secondary file:mr-3 file:rounded file:border-0 file:bg-bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text hover:file:bg-border-soft"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 mb-3">
            <label htmlFor="onboard-display" className="text-sm font-medium text-text-secondary">
              Display name
            </label>
            <input
              id="onboard-display"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={saving}
              maxLength={80}
              placeholder="How your name appears"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="onboard-bio" className="text-sm font-medium text-text-secondary">
              Bio
            </label>
            <textarea
              id="onboard-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={saving}
              rows={3}
              maxLength={500}
              placeholder="A short line about you"
              className={`${inputClass} resize-y min-h-[72px]`}
            />
          </div>
        </div>

        {saveError ? <p className="text-sm text-error">{saveError}</p> : null}

        <button
          type="submit"
          disabled={saving || !normalizeUsername(raw)}
          className="qrtz-btn-primary px-4 py-2"
        >
          {saving ? "Saving…" : "Continue to your feed"}
        </button>
      </form>
    </div>
  );
}
