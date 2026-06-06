import { NextResponse } from "next/server";
import { resend } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function GET() {
  const recipient = process.env.TEST_EMAIL_RECIPIENT?.trim();
  if (!recipient) {
    return NextResponse.json(
      { error: "TEST_EMAIL_RECIPIENT is not configured." },
      { status: 503 },
    );
  }

  try {
    const { data, error } = await resend.emails.send({
      from: "QrtzApp <noreply@qrtz.app>",
      to: recipient,
      subject: "QrtzApp Resend Test",
      text: "If you received this email, Resend is configured correctly.",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      message: "Test email sent.",
      id: data?.id,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send test email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
