import React from "react";
import type { Metadata } from "next";
import { parseAdminUserAllowlist } from "@/lib/admin-allowlist";
import AdminTagEngagementClient from "./AdminTagEngagementClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · Tag analytics",
};

export default function AdminTagsPage() {
  const allowlistConfigured = parseAdminUserAllowlist(process.env.ADMIN_USER_IDS).size > 0;

  return (
    <main className="flex min-h-full flex-col items-center bg-bg px-4 py-10 md:px-6">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-text md:text-3xl">Tag analytics</h1>
          <p className="text-sm text-text-muted">
            Read-only internal view. Top tags by engagement (likes and reblogs on thread roots).
          </p>
        </header>
        <AdminTagEngagementClient allowlistConfigured={allowlistConfigured} />
      </div>
    </main>
  );
}
