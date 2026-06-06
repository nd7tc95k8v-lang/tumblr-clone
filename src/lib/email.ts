import { Resend } from "resend";

function requireResendApiKey(): string {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Set RESEND_API_KEY in your environment.",
    );
  }
  return apiKey;
}

/** Server-only Resend client. Do not import from client components. */
export const resend = new Resend(requireResendApiKey());
