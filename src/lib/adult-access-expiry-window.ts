/** Access is considered “expiring soon” when it ends within this window from now. */
export const ADULT_ACCESS_RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Granted with a future expiry (expired or missing expiry → false). */
export function isAdultAccessActive(
  adultContentStatus: string | null | undefined,
  adultContentAccessExpiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (adultContentStatus !== "granted") return false;
  const raw = adultContentAccessExpiresAt?.trim();
  if (!raw) return false;
  const exp = new Date(raw).getTime();
  if (!Number.isFinite(exp)) return false;
  return exp > nowMs;
}

/** Active access whose end date falls within the next 30 days. */
export function isAdultAccessExpiringSoon(
  adultContentStatus: string | null | undefined,
  adultContentAccessExpiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!isAdultAccessActive(adultContentStatus, adultContentAccessExpiresAt, nowMs)) return false;
  const raw = adultContentAccessExpiresAt?.trim();
  if (!raw) return false;
  const exp = new Date(raw).getTime();
  return exp <= nowMs + ADULT_ACCESS_RENEWAL_WINDOW_MS;
}
