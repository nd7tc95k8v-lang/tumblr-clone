import React from "react";
import ComposeClient from "../../../components/ComposeClient";

export default function ComposePage() {
  return (
    <div className="min-h-full flex flex-col items-center py-8 px-4 md:py-10">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100">Create post</h1>
        <ComposeClient />
      </div>
    </div>
  );
}
