"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidUsernameFormat,
  normalizeUsername,
  usernameLooksLikeEmail,
} from "@/lib/username";
import type { ProfilePublic } from "@/types/profile";
import ProfileAvatar from "./ProfileAvatar";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

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
      let nextAvatarUrl: string | null | undefined;
      if (removeAvatar) {
        nextAvatarUrl = null;
      } else if (avatarFile) {
        if (!avatarFile.type.startsWith("image/")) {
          setSaveError("Avatar must be an image file.");
          return;
        }
        if (avatarFile.size > AVATAR_MAX_BYTES) {
          setSaveError("Avatar must be 2 MB or smaller.");
          return;
        }
        const rawExt = avatarFile.name.split(".").pop();
        const fileExt =
          rawExt && /^[a-z0-9]+$/i.test(rawExt) && rawExt.length <= 8 ? rawExt.toLowerCase() : "jpg";
        const filePath = `${user.id}/avatar.${fileExt}`;

        const { error: uploadError } = await supabase.storage.from("avatars").upload(filePath, avatarFile, {
          contentType: avatarFile.type || `image/${fileExt}`,
          upsert: true,
        });

        if (uploadError) {
          console.error(uploadError);
          setSaveError(uploadError.message || "Avatar upload failed.");
          return;
        }

        const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
        nextAvatarUrl = publicUrlData.publicUrl;
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
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Profile photo</span>
            <div className="flex flex-wrap items-center gap-4">
              <ProfileAvatar url={avatarDisplayUrl} label={avatarLabel} size="lg" />
              <div className="flex flex-col gap-2">
                <input
                  ref={avatarInputRef}
                  id="edit-avatar"
                  type="file"
                  accept="image/*"
                  disabled={saving}
                  className="text-sm text-zinc-700 dark:text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-300 dark:file:bg-zinc-700 dark:file:text-zinc-100 dark:hover:file:bg-zinc-600"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setAvatarFile(f);
                    if (f) setRemoveAvatar(false);
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
                    className="text-left text-xs text-red-700 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    Remove photo
                  </button>
                ) : null}
              </div>
            </div>
          </div>

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
