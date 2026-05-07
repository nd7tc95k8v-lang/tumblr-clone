"use client";

import Link from "next/link";

const DISMISS_PREFIX = "qrtz:contentSafetyOnboardingDismissed:";

export function contentSafetyOnboardingDismissStorageKey(userId: string): string {
  return `${DISMISS_PREFIX}${userId}`;
}

export function readContentSafetyOnboardingDismissed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(contentSafetyOnboardingDismissStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeContentSafetyOnboardingDismissed(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(contentSafetyOnboardingDismissStorageKey(userId), "1");
  } catch {
    /* ignore quota / private mode / storage denied */
  }
}

type Props = {
  userId: string;
  onKeepHidden: () => void;
};

export default function ContentSafetyOnboarding({ userId, onKeepHidden }: Props) {
  return (
    <div className="qrtz-card mx-auto flex w-full max-w-md flex-col gap-5">
      <div>
        <h2 className="mb-1 font-heading text-lg font-semibold text-text">Content safety on Qrtz</h2>
        <div className="space-y-3 text-sm leading-relaxed text-text-secondary">
          <p>Some creators on Qrtz share mature content. This content is hidden by default.</p>
          <p>
            If you’re 18 or older, you can enable mature-content access by clicking Review Adult Access below.
          </p>
          <p>You can also keep it hidden and continue using Qrtz normally.</p>
          <p>These settings can be changed at any time in your settings.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => {
            writeContentSafetyOnboardingDismissed(userId);
            onKeepHidden();
          }}
          className="qrtz-btn-primary px-4 py-2 text-sm sm:min-w-0"
        >
          Keep mature content hidden
        </button>
        <Link
          href="/settings"
          className="qrtz-btn-secondary inline-flex items-center justify-center px-4 py-2 text-sm text-center no-underline"
        >
          Review Adult Access
        </Link>
      </div>
    </div>
  );
}
