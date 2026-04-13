"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_IMAGE_MIME_TYPES, validateImageFile } from "@/lib/image-upload-validation";
import {
  describeUsernameFieldError,
  normalizeUsername,
  validateUsernameNormalized,
} from "@/lib/username";
import type { ProfilePublic } from "@/types/profile";
import { uploadProfileAvatar } from "@/lib/upload-profile-avatar";
import ProfileAvatar from "./ProfileAvatar";

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

const inputClass =
  "w-full p-2 rounded border border-border bg-input text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus";

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
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setUsernameRaw(profile.username);
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setSaveError(null);
    setAvailability("idle");
    setAvatarFile(null);
    setRemoveAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }, [open, profile]);

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

  const avatarLabel =
    displayName.trim().length > 0 ? displayName.trim() : `@${normalizeUsername(usernameRaw) || profile.username}`;

  const avatarDisplayUrl = localPreviewUrl ?? (removeAvatar ? null : profile.avatar_url?.trim() || null);

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
      let nextAvatarUrl: string | null | undefined;
      if (removeAvatar) {
        nextAvatarUrl = null;
      } else if (avatarFile) {
        const up = await uploadProfileAvatar(supabase, user.id, avatarFile);
        if ("error" in up) {
          setSaveError(up.error);
          return;
        }
        nextAvatarUrl = up.publicUrl;
      }

      const updatePayload: {
        username: string;
        display_name: string | null;
        bio: string | null;
        avatar_url?: string | null;
      } = {
        username: normalized,
        display_name: displayTrim.length > 0 ? displayTrim : null,
        bio: bioTrim.length > 0 ? bioTrim : null,
      };
      if (nextAvatarUrl !== undefined) {
        updatePayload.avatar_url = nextAvatarUrl;
      }

      const { error } = await supabase.from("profiles").update(updatePayload).eq("id", userId);

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
        avatar_url: nextAvatarUrl !== undefined ? nextAvatarUrl : profile.avatar_url,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const normalizedForHint = normalizeUsername(usernameRaw);
  const hint =
    availability === "invalid"
      ? describeUsernameFieldError(normalizedForHint) ?? "That username is not allowed."
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
        className="w-full max-w-md rounded-lg bg-surface-elevated shadow-xl border border-border p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="edit-profile-title" className="text-lg font-semibold text-text mb-4">
          Edit profile
        </h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-text-secondary">Profile photo</span>
            <div className="flex flex-wrap items-center gap-4">
              <ProfileAvatar url={avatarDisplayUrl} label={avatarLabel} size="lg" />
              <div className="flex flex-col gap-2">
                <input
                  ref={avatarInputRef}
                  id="edit-avatar"
                  type="file"
                  accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                  disabled={saving}
                  className="text-sm text-text-secondary file:mr-3 file:rounded file:border-0 file:bg-bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text hover:file:bg-border-soft"
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
                    setRemoveAvatar(false);
                  }}
                />
                {profile.avatar_url || avatarFile ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setAvatarFile(null);
                      setRemoveAvatar(true);
                      if (avatarInputRef.current) avatarInputRef.current.value = "";
                    }}
                    className="text-left text-xs text-error hover:underline disabled:opacity-50"
                  >
                    Remove photo
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="edit-username" className="text-sm font-medium text-text-secondary">
              Username
            </label>
            <input
              id="edit-username"
              type="text"
              autoComplete="username"
              value={usernameRaw}
              onChange={(e) => setUsernameRaw(e.target.value)}
              disabled={saving}
              className={inputClass}
            />
            {hint ? (
              <p
                className={
                  availability === "available" || availability === "yours"
                    ? "text-xs text-success"
                    : availability === "taken" || availability === "invalid"
                      ? "text-xs text-error"
                      : "text-xs text-text-muted"
                }
              >
                {hint}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="edit-display" className="text-sm font-medium text-text-secondary">
              Display name <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <input
              id="edit-display"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={saving}
              maxLength={80}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="edit-bio" className="text-sm font-medium text-text-secondary">
              Bio <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <textarea
              id="edit-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={saving}
              rows={4}
              maxLength={500}
              className={`${inputClass} resize-y min-h-[80px]`}
            />
          </div>

          {saveError ? <p className="text-sm text-error">{saveError}</p> : null}

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="py-2 px-4 rounded border border-border bg-surface text-text text-sm font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="py-2 px-4 rounded bg-primary text-white text-sm font-semibold hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
