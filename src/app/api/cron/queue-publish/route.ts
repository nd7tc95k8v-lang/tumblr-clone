import { NextResponse } from "next/server";
import { runQueueSchedulerTick } from "@/lib/queue/run-queue-scheduler-tick";
import { createServiceRoleServerClient } from "@/lib/supabase/server-service-role";

export const dynamic = "force-dynamic";

function unauthorizedResponse() {
  return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
}

function verifyCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return false;

  return token === expected;
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  if (process.env.QUEUE_SCHEDULER_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });
  }

  const service = createServiceRoleServerClient();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 503 });
  }

  try {
    const summary = await runQueueSchedulerTick(service, { userLimit: 50 });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("Queue scheduler tick failed", err);
    return NextResponse.json({ ok: false, error: "Scheduler tick failed." }, { status: 500 });
  }
}
