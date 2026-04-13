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
      <div className="w-full max-w-md mx-auto p-6 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-900 dark:text-amber-100 text-sm">
        <p className="font-medium mb-2">Supabase is not configured</p>
        <p className="text-xs">
          Add <code className="rounded bg-amber-100 dark:bg-amber-900/50 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and a
          publishable key to <code className="rounded bg-amber-100 dark:bg-amber-900/50 px-1">.env.local</code>.
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
