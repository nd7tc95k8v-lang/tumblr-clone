"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isAdultAccessExpiringSoon } from "@/lib/adult-access-expiry-window";
import {
  readAdultAccessExpiryNoticeDismissed,
  writeAdultAccessExpiryNoticeDismissed,
} from "@/lib/adult-access-expiry-notice-dismiss";

type Props = {
  userId: string;
  adultContentStatus: string | null;
  adultContentAccessExpiresAt: string | null;
};

export default function AdultAccessExpiryNotice({
  userId,
  adultContentStatus,
  adultContentAccessExpiresAt,
}: Props) {
  const pathname = usePathname();
  const expiresRaw = adultContentAccessExpiresAt?.trim() ?? "";

  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!expiresRaw) {
      setDismissed(false);
      return;
    }
    setDismissed(readAdultAccessExpiryNoticeDismissed(userId, expiresRaw));
  }, [userId, expiresRaw]);

  const onDismiss = useCallback(() => {
    if (!expiresRaw) return;
    writeAdultAccessExpiryNoticeDismissed(userId, expiresRaw);
    setDismissed(true);
  }, [userId, expiresRaw]);

  if (pathname === "/settings") return null;

  if (!isAdultAccessExpiringSoon(adultContentStatus, adultContentAccessExpiresAt)) return null;
  if (!expiresRaw) return null;
  if (dismissed) return null;

  const expiresLabel = new Date(expiresRaw).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div
      className="shrink-0 border-b border-border/50 bg-surface-blue/25 px-3 py-2.5 sm:px-4 dark:bg-surface-blue/15"
      role="status"
    >
      <div className="mx-auto flex w-full max-w-3xl items-start gap-2 sm:gap-3">
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-text-secondary sm:text-sm">
          Your mature content access expires soon. Renew access in{" "}
          <Link href="/settings" className="font-medium text-accent-purple underline-offset-2 hover:underline">
            Settings
          </Link>{" "}
          to avoid interruption.
          <span className="mt-1 block text-meta text-text-muted">Access ends {expiresLabel}.</span>
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg px-2 py-1 text-meta text-text-muted transition-colors hover:bg-bg-secondary/60 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/70 focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
          aria-label="Dismiss mature content access renewal notice"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
