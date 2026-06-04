/** Minimum password length (matches Supabase Auth default). Sign-up has no stricter app rule. */
export const AUTH_MIN_PASSWORD_LENGTH = 6;

export const AUTH_FORGOT_PASSWORD_PATH = "/auth/forgot-password";
export const AUTH_RESET_PASSWORD_PATH = "/auth/reset-password";

export const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  "If an account exists for that email, you'll receive password reset instructions shortly.";

/**
 * Dashboard checklist (required for reset links to land on the reset page):
 * - Supabase → Authentication → URL Configuration → Redirect URLs:
 *   - http://localhost:3000/auth/reset-password
 *   - https://<production-domain>/auth/reset-password
 * - Vercel: set NEXT_PUBLIC_SITE_URL to the production origin (no trailing slash).
 */

export function hashLooksLikePasswordRecovery(hash: string): boolean {
  if (!hash || hash.length < 2) return false;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return params.get("type") === "recovery";
}

/** Redirect `/` recovery hash landings to the dedicated reset page (hash preserved). */
export function redirectRecoveryHashFromHomeIfNeeded(): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, hash } = window.location;
  if (pathname !== "/" || !hashLooksLikePasswordRecovery(hash)) return false;
  window.location.replace(`${AUTH_RESET_PASSWORD_PATH}${hash}`);
  return true;
}
