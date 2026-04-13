"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_IMAGE_MIME_TYPES, validateImageFile } from "@/lib/image-upload-validation";
import {
  describeUsernameFieldError,
  normalizeUsername,
  validateUsernameNormalized,
} from "@/lib/username";
import {
  ADULT_CONTENT_ATTESTATION_PROMPT,
  ADULT_CONTENT_POLICY_VERSION,
} from "@/lib/adult-content-policy";
import { recordAdultContentSelfAttestation } from "@/lib/supabase/record-adult-attestation";
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
  "qrtz-field";

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
  const [profileIsNsfw, setProfileIsNsfw] = useState(profile.profile_is_nsfw);
  const [defaultPostsNsfw, setDefaultPostsNsfw] = useState(profile.default_posts_nsfw);
  const [adultStatus, setAdultStatus] = useState<string>("unknown");
  const [adultExpiresAt, setAdultExpiresAt] = useState<string | null>(null);
  const [attestAgreed, setAttestAgreed] = useState(false);
  const [attestBusy, setAttestBusy] = useState(false);
  const [attestMessage, setAttestMessage] = useState<string | null>(null);
  const [attestError, setAttestError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsernameRaw(profile.username);
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setProfileIsNsfw(profile.profile_is_nsfw);
    setDefaultPostsNsfw(profile.default_posts_nsfw);
    setSaveError(null);
    setAvailability("idle");
    setAvatarFile(null);
    setRemoveAvatar(false);
    setAttestAgreed(false);
    setAttestMessage(null);
    setAttestError(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }, [open, profile]);

  useEffect(() => {
    if (!open || !supabase) return;
    void supabase
      .from("profiles")
      .select("adult_content_status, adult_content_access_expires_at")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return;
        setAdultStatus(data.adult_content_status ?? "unknown");
        setAdultExpiresAt(data.adult_content_access_expires_at ?? null);
      });
  }, [open, supabase, userId]);

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
        profile_is_nsfw: boolean;
        default_posts_nsfw: boolean;
        avatar_url?: string | null;
      } = {
        username: normalized,
        display_name: displayTrim.length > 0 ? displayTrim : null,
        bio: bioTrim.length > 0 ? bioTrim : null,
        profile_is_nsfw: profileIsNsfw,
        default_posts_nsfw: defaultPostsNsfw,
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
        profile_is_nsfw: profileIsNsfw,
        default_posts_nsfw: defaultPostsNsfw,
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
    <div className="qrtz-modal-overlay" onClick={onClose} role="presentation">
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        aria-modal="true"
        aria-labelledby="edit-profile-title"
        className="qrtz-modal-panel"
      >
        <h2 id="edit-profile-title" className="mb-5 font-heading text-lg font-semibold text-text">
          Edit profile
        </h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <span className="text-meta font-medium text-text-secondary">Profile photo</span>
            <div className="flex flex-wrap items-center gap-4">
              <ProfileAvatar url={avatarDisplayUrl} label={avatarLabel} size="lg" />
              <div className="flex flex-col gap-2">
                <input
                  ref={avatarInputRef}
                  id="edit-avatar"
                  type="file"
                  accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                  disabled={saving}
                  className="text-meta text-text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-bg-secondary file:px-3 file:py-2 file:font-medium file:text-text hover:file:bg-border-soft"
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
                    className="text-left text-meta text-error hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-elevated disabled:opacity-50"
                  >
                    Remove photo
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-username" className="text-meta font-medium text-text-secondary">
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
                    ? "text-meta text-success"
                    : availability === "taken" || availability === "invalid"
                      ? "text-meta text-error"
                      : "text-meta text-text-muted"
                }
              >
                {hint}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-display" className="text-meta font-medium text-text-secondary">
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

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-bio" className="text-meta font-medium text-text-secondary">
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

          <div className="flex flex-col gap-3 rounded-card border border-border bg-bg-secondary/80 p-4">
            <p className="font-heading text-sm font-semibold text-text">Mature content settings</p>
            <p className="text-meta text-text-muted">
              “Profile is NSFW” is a public label only. “Default posts NSFW” is what auto-marks <span className="font-medium">new</span> posts you create (database enforced). They stay independent.
            </p>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text">
              <input
                type="checkbox"
                checked={profileIsNsfw}
                onChange={(e) => setProfileIsNsfw(e.target.checked)}
                disabled={saving}
                className="qrtz-checkbox"
              />
              <span>
                <span className="font-medium">My profile is NSFW</span>
                <span className="mt-1 block text-meta text-text-muted">
                  Signals that your blog may contain mature material. Does not change existing posts or turn on default
                  post marking.
                </span>
              </span>
            </label>
            {profileIsNsfw && !defaultPostsNsfw ? (
              <div
                role="note"
                className="rounded-card border border-warning/40 bg-warning/10 px-3 py-2.5 text-meta leading-relaxed text-text"
              >
                <span className="font-semibold text-text">Recommendation: </span>
                If this blog regularly posts mature content, consider also enabling{" "}
                <span className="font-medium">Mark all my posts as NSFW by default</span> so new originals are labeled
                consistently. This is optional — we won&apos;t change it for you.
              </div>
            ) : null}
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text">
              <input
                type="checkbox"
                checked={defaultPostsNsfw}
                onChange={(e) => setDefaultPostsNsfw(e.target.checked)}
                disabled={saving}
                className="qrtz-checkbox"
              />
              <span>
                <span className="font-medium">Mark all my posts as NSFW by default</span>
                <span className="mt-1 block text-meta text-text-muted">
                  New originals you publish are stored as NSFW (reblogs still inherit from the parent chain when
                  applicable).
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-3 rounded-card border border-border p-4">
            <p className="font-heading text-sm font-semibold text-text">Adult access (view NSFW in feeds)</p>
            <p className="text-meta text-text-muted">
              Required to load mature posts over the API. Renewed every 6 months; each confirmation is logged for audit.
            </p>
            {adultStatus === "granted" && adultExpiresAt ? (
              <p className="text-meta text-text-secondary">
                Access active until{" "}
                {new Date(adultExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
              </p>
            ) : (
              <p className="text-meta text-text-muted">No active adult access on this account.</p>
            )}
            <div className="qrtz-field max-h-28 overflow-y-auto whitespace-pre-wrap text-meta text-text">
              {ADULT_CONTENT_ATTESTATION_PROMPT}
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 text-meta text-text">
              <input
                type="checkbox"
                checked={attestAgreed}
                onChange={(e) => setAttestAgreed(e.target.checked)}
                disabled={attestBusy || saving}
                className="qrtz-checkbox"
              />
              <span className="pt-0.5">I have read and agree with the statement above.</span>
            </label>
            {attestError ? <p className="text-meta text-error">{attestError}</p> : null}
            {attestMessage ? <p className="text-meta text-success">{attestMessage}</p> : null}
            <button
              type="button"
              disabled={attestBusy || saving || !attestAgreed}
              onClick={() => {
                void (async () => {
                  setAttestBusy(true);
                  setAttestMessage(null);
                  setAttestError(null);
                  const res = await recordAdultContentSelfAttestation(supabase, {
                    isAdult: true,
                    policyVersion: ADULT_CONTENT_POLICY_VERSION,
                    promptText: ADULT_CONTENT_ATTESTATION_PROMPT,
                  });
                  setAttestBusy(false);
                  if (!res.ok) {
                    setAttestError(res.error);
                    return;
                  }
                  setAttestMessage("Access updated. You can close this dialog or keep editing.");
                  setAdultStatus("granted");
                  setAdultExpiresAt(res.expires_at);
                })();
              }}
              className="qrtz-btn-primary self-start px-3 py-1.5 text-xs"
            >
              {attestBusy ? "Recording…" : "Confirm & renew 6-month access"}
            </button>
          </div>

          {saveError ? <p className="text-sm text-error">{saveError}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="qrtz-btn-secondary px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="qrtz-btn-primary px-4 py-2 text-sm"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
