import { NextResponse } from "next/server";
import { parseAdminUserAllowlist, isUserInAdminAllowlist } from "@/lib/admin-allowlist";
import {
  adminTagWindowToInterval,
  fetchAdminTopTagEngagement,
  parseAdminTagEngagementWindowParam,
  parseAdminTagWindowParam,
} from "@/lib/supabase/fetch-admin-tag-engagement";
import { createAnonServerClient } from "@/lib/supabase/server-anon";
import { createServiceRoleServerClient } from "@/lib/supabase/server-service-role";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const allowlist = parseAdminUserAllowlist(process.env.ADMIN_USER_IDS);
  if (allowlist.size === 0) {
    return NextResponse.json(
      { error: "Admin access is not configured (set ADMIN_USER_IDS)." },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing session." }, { status: 401 });
  }

  const anon = createAnonServerClient();
  if (!anon) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  const {
    data: { user },
    error: authErr,
  } = await anon.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isUserInAdminAllowlist(user.id, allowlist)) {
    return NextResponse.json({ error: "You do not have access to this page." }, { status: 403 });
  }

  const service = createServiceRoleServerClient();
  if (!service) {
    return NextResponse.json(
      { error: "Admin data access is not configured (set SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 500 },
    );
  }

  const sp = new URL(request.url).searchParams;
  const windowParsed = parseAdminTagWindowParam(sp.get("window"));
  if (!windowParsed.ok) {
    return NextResponse.json({ error: windowParsed.error }, { status: 400 });
  }
  const engagementParsed = parseAdminTagEngagementWindowParam(sp.get("engagement_window"));
  if (!engagementParsed.ok) {
    return NextResponse.json({ error: engagementParsed.error }, { status: 400 });
  }

  const discoveryInterval = adminTagWindowToInterval(windowParsed.value);
  const engagementInterval = adminTagWindowToInterval(engagementParsed.value);

  const { data, error } = await fetchAdminTopTagEngagement(
    service,
    50,
    discoveryInterval,
    engagementInterval,
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
