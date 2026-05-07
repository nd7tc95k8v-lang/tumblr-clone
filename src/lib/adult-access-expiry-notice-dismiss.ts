/**
 * Dismissal for the global mature-content access renewal banner.
 * Scoped by user id and the current expiry ISO so a renewed profile shows the notice again when applicable.
 */
export function adultAccessExpiryNoticeDismissStorageKey(userId: string, adultExpiresAtIso: string): string {
  return `qrtz:adultAccessExpiryNoticeDismissed:${userId}:${adultExpiresAtIso}`;
}

export function readAdultAccessExpiryNoticeDismissed(userId: string, adultExpiresAtIso: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(adultAccessExpiryNoticeDismissStorageKey(userId, adultExpiresAtIso)) === "1";
  } catch {
    return false;
  }
}

export function writeAdultAccessExpiryNoticeDismissed(userId: string, adultExpiresAtIso: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(adultAccessExpiryNoticeDismissStorageKey(userId, adultExpiresAtIso), "1");
  } catch {
    /* quota / private mode / storage denied */
  }
}
