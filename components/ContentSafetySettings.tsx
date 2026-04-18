"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  ADULT_CONTENT_ATTESTATION_PROMPT,
  ADULT_CONTENT_POLICY_VERSION,
} from "@/lib/adult-content-policy";
import { DEFAULT_NSFW_FEED_MODE, parseNsfwFeedMode, type NsfwFeedMode } from "@/lib/nsfw-feed-preference";
import { recordAdultContentSelfAttestation } from "@/lib/supabase/record-adult-attestation";

type Props = {
  supabase: SupabaseClient;
  user: User;
};

const FEED_NSFW_CHOICES: {
  id: NsfwFeedMode;
  title: string;
  description: string;
}[] = [
  {
    id: "show",
    title: "Show normally",
    description: "Mature posts can appear in feeds without a warning gate.",
  },
  {
    id: "warn",
    title: "Show with warning",
    description: "Mature posts can appear in feeds, but require tap to view.",
  },
  {
    id: "hide",
    title: "Hide from feed",
    description: "Mature posts are excluded from feeds and discovery.",
  },
];

export default function ContentSafetySettings({ supabase, user }: Props) {
  const userId = user.id;

  const [profileIsNsfw, setProfileIsNsfw] = useState(false);
  const [defaultPostsNsfw, setDefaultPostsNsfw] = useState(false);
  const [profileFieldsLoading, setProfileFieldsLoading] = useState(true);
  const [contentSaveBusy, setContentSaveBusy] = useState(false);
  const [contentSaveError, setContentSaveError] = useState<string | null>(null);
  const [contentSaveMessage, setContentSaveMessage] = useState<string | null>(null);

  const [feedMode, setFeedMode] = useState<NsfwFeedMode>(DEFAULT_NSFW_FEED_MODE);
  const [feedSaveBusy, setFeedSaveBusy] = useState(false);
  const [feedSaveError, setFeedSaveError] = useState<string | null>(null);
  const [feedSaveMessage, setFeedSaveMessage] = useState<string | null>(null);

  const [adultStatus, setAdultStatus] = useState<string>("unknown");
  const [adultExpiresAt, setAdultExpiresAt] = useState<string | null>(null);
  const [attestAdultConfirm, setAttestAdultConfirm] = useState(false);
  const [attestLoggingUnderstand, setAttestLoggingUnderstand] = useState(false);
  const [attestBusy, setAttestBusy] = useState(false);
  const [attestMessage, setAttestMessage] = useState<string | null>(null);
  const [attestError, setAttestError] = useState<string | null>(null);

  const loadProfileContentFields = useCallback(async () => {
    setProfileFieldsLoading(true);
    setContentSaveError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "profile_is_nsfw, default_posts_nsfw, nsfw_feed_mode, adult_content_status, adult_content_access_expires_at",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      setProfileFieldsLoading(false);
      return;
    }
    setProfileIsNsfw(Boolean(data.profile_is_nsfw));
    setDefaultPostsNsfw(Boolean(data.default_posts_nsfw));
    setFeedMode(parseNsfwFeedMode(data.nsfw_feed_mode));
    setAdultStatus(data.adult_content_status ?? "unknown");
    setAdultExpiresAt(data.adult_content_access_expires_at ?? null);
    setProfileFieldsLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProfileContentFields();
    });
  }, [loadProfileContentFields]);

  const accessActive = adultStatus === "granted" && Boolean(adultExpiresAt);

  const handleSaveFeedMode = () => {
    void (async () => {
      setFeedSaveBusy(true);
      setFeedSaveError(null);
      setFeedSaveMessage(null);
      const {
        data: { user: authUser },
        error: authErr,
      } = await supabase.auth.getUser();
      if (authErr || !authUser || authUser.id !== userId) {
        setFeedSaveError("You can only update your own settings.");
        setFeedSaveBusy(false);
        return;
      }

      const { error } = await supabase.from("profiles").update({ nsfw_feed_mode: feedMode }).eq("id", userId);

      if (error) {
        setFeedSaveError(error.message);
        setFeedSaveBusy(false);
        return;
      }
      setFeedSaveMessage("Saved.");
      setFeedSaveBusy(false);
    })();
  };

  const handleSaveProfileAndPosting = () => {
    void (async () => {
      setContentSaveBusy(true);
      setContentSaveError(null);
      setContentSaveMessage(null);
      const {
        data: { user: authUser },
        error: authErr,
      } = await supabase.auth.getUser();
      if (authErr || !authUser || authUser.id !== userId) {
        setContentSaveError("You can only update your own settings.");
        setContentSaveBusy(false);
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          profile_is_nsfw: profileIsNsfw,
          default_posts_nsfw: defaultPostsNsfw,
        })
        .eq("id", userId);

      if (error) {
        setContentSaveError(error.message);
        setContentSaveBusy(false);
        return;
      }
      setContentSaveMessage("Saved.");
      setContentSaveBusy(false);
    })();
  };

  const attestReady = attestAdultConfirm && attestLoggingUnderstand;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-meta font-semibold uppercase tracking-wide text-text-muted">Content &amp; Safety</h2>
      <p className="-mt-2 text-meta text-text-muted">These settings are independent.</p>

      <div className="rounded-card border border-border bg-bg-secondary/80 p-4 flex flex-col gap-3">
        <p className="font-heading text-sm font-semibold text-text">Profile</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            checked={profileIsNsfw}
            onChange={(e) => {
              setContentSaveMessage(null);
              setProfileIsNsfw(e.target.checked);
            }}
            disabled={profileFieldsLoading || contentSaveBusy}
            className="qrtz-checkbox"
          />
          <span>
            <span className="font-medium">My profile is NSFW</span>
            <span className="mt-1 block text-meta text-text-muted">
              Public label only. Does not change existing posts or defaults.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-card border border-border bg-bg-secondary/80 p-4 flex flex-col gap-3">
        <p className="font-heading text-sm font-semibold text-text">Posting</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            checked={defaultPostsNsfw}
            onChange={(e) => {
              setContentSaveMessage(null);
              setDefaultPostsNsfw(e.target.checked);
            }}
            disabled={profileFieldsLoading || contentSaveBusy}
            className="qrtz-checkbox"
          />
          <span>
            <span className="font-medium">Mark my posts as NSFW by default</span>
            <span className="mt-1 block text-meta text-text-muted">Applies to new posts you create.</span>
          </span>
        </label>
        <p className="text-meta text-text-muted">
          Saves both the profile label and posting default in the sections above.
        </p>
        {contentSaveError ? <p className="text-meta text-error">{contentSaveError}</p> : null}
        {contentSaveMessage ? <p className="text-meta text-success">{contentSaveMessage}</p> : null}
        <button
          type="button"
          disabled={profileFieldsLoading || contentSaveBusy}
          onClick={handleSaveProfileAndPosting}
          className="qrtz-btn-primary self-start px-4 py-2 text-sm"
        >
          {contentSaveBusy ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className="rounded-card border border-border/80 bg-bg-secondary/90 p-4 shadow-sm ring-1 ring-black/[0.04] dark:border-border/60 dark:bg-bg-secondary/95 dark:ring-white/[0.06] sm:p-5 flex flex-col gap-4">
        <header className="border-b border-border/50 pb-3 dark:border-border/40">
          <h3 className="font-heading text-base font-semibold tracking-tight text-text">Content preferences</h3>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-text-secondary">
            Choose how mature posts appear in your feeds and discovery surfaces.
          </p>
        </header>
        <fieldset className="flex flex-col gap-2.5 p-0">
          <legend className="sr-only">Mature posts in feeds and discovery</legend>
          {FEED_NSFW_CHOICES.map((c) => {
            const selected = feedMode === c.id;
            return (
              <label
                key={c.id}
                className={`group flex cursor-pointer items-stretch gap-3 rounded-xl border px-3.5 py-3 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out focus-within:outline-none focus-within:ring-2 focus-within:ring-border-focus/50 focus-within:ring-offset-2 focus-within:ring-offset-bg dark:focus-within:ring-offset-bg-secondary ${
                  selected
                    ? "border-accent-purple/70 bg-accent-purple/[0.14] shadow-md ring-2 ring-accent-purple/35 dark:border-accent-purple/60 dark:bg-accent-purple/20 dark:ring-accent-purple/30"
                    : "border-border/70 bg-bg-secondary/50 shadow-sm hover:border-accent-purple/40 hover:bg-surface-blue/30 dark:border-border/55 dark:bg-bg-secondary/40 dark:hover:bg-bg-secondary/55"
                } ${profileFieldsLoading || feedSaveBusy ? "pointer-events-none opacity-60" : "active:scale-[0.99]"}`}
              >
                <input
                  type="radio"
                  name="qrtz-nsfw-feed-mode"
                  value={c.id}
                  checked={selected}
                  onChange={() => {
                    setFeedSaveMessage(null);
                    setFeedMode(c.id);
                  }}
                  disabled={profileFieldsLoading || feedSaveBusy}
                  className="sr-only"
                />
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    selected
                      ? "border-accent-purple bg-accent-purple text-white shadow-sm dark:border-accent-purple dark:bg-accent-purple"
                      : "border-border/80 bg-bg-secondary group-hover:border-accent-purple/45 dark:border-border/60 dark:bg-bg-secondary/80"
                  }`}
                  aria-hidden
                >
                  {selected ? <span className="block h-2 w-2 rounded-full bg-white" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text">{c.title}</span>
                  <span className="mt-1 block text-meta leading-snug text-text-secondary">{c.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <p className="text-meta leading-snug text-text-muted">
          This setting currently applies to Home, Explore, and Search.
        </p>
        {feedSaveError ? <p className="text-meta text-error">{feedSaveError}</p> : null}
        {feedSaveMessage ? <p className="text-meta text-success">{feedSaveMessage}</p> : null}
        <button
          type="button"
          disabled={profileFieldsLoading || feedSaveBusy}
          onClick={handleSaveFeedMode}
          className="qrtz-btn-primary self-start px-4 py-2 text-sm"
        >
          {feedSaveBusy ? "Saving…" : "Save feed preference"}
        </button>
      </div>

      <div className="rounded-card border border-border p-4 flex flex-col gap-3">
        <p className="font-heading text-sm font-semibold text-text">Adult Content Access</p>
        {accessActive && adultExpiresAt ? (
          <p className="text-meta text-text-secondary">
            Access active until{" "}
            {new Date(adultExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
          </p>
        ) : (
          <p className="text-meta text-text-muted">No active adult access on this account.</p>
        )}
        <label className="flex cursor-pointer items-start gap-2.5 text-meta text-text">
          <input
            type="checkbox"
            checked={attestAdultConfirm}
            onChange={(e) => setAttestAdultConfirm(e.target.checked)}
            disabled={attestBusy}
            className="qrtz-checkbox"
          />
          <span className="pt-0.5">I confirm I am 18+ and want to view mature content</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-meta text-text">
          <input
            type="checkbox"
            checked={attestLoggingUnderstand}
            onChange={(e) => setAttestLoggingUnderstand(e.target.checked)}
            disabled={attestBusy}
            className="qrtz-checkbox"
          />
          <span className="pt-0.5">I understand access is logged and expires every 6 months</span>
        </label>
        {attestError ? <p className="text-meta text-error">{attestError}</p> : null}
        {attestMessage ? <p className="text-meta text-success">{attestMessage}</p> : null}
        <button
          type="button"
          disabled={attestBusy || !attestReady}
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
              setAttestMessage("Access updated.");
              setAdultStatus("granted");
              setAdultExpiresAt(res.expires_at);
            })();
          }}
          className="qrtz-btn-primary self-start px-4 py-2 text-sm"
        >
          {attestBusy ? "…" : accessActive ? "Renew access" : "Enable access"}
        </button>
      </div>
    </section>
  );
}
