"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import PostForm from "./PostForm";

export default function ComposeClient() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  if (!supabase) {
    return (
      <div className="mx-auto w-full max-w-md rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <p className="mb-2 font-medium">Supabase is not configured</p>
        <p className="text-meta">
          Add <code className="qrtz-code-inline">NEXT_PUBLIC_SUPABASE_URL</code> and a publishable key to{" "}
          <code className="qrtz-code-inline">.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <PostForm
      supabase={supabase}
      onPosted={async () => {
        router.push("/");
        router.refresh();
      }}
    />
  );
}
