import React, { Suspense } from "react";
import ComposeClient from "../../../components/ComposeClient";

export default function ComposePage() {
  return (
    <div className="min-h-full flex flex-col pt-5 pb-8 px-3 sm:px-4 md:px-8 md:pt-7 md:pb-10">
      <div className="w-full md:max-w-xl md:mx-auto flex flex-col gap-4 md:gap-6">
        <h1 className="text-lg sm:text-xl md:text-2xl font-medium text-text tracking-tight">Create post</h1>
        <Suspense
          fallback={
            <div
              className="qrtz-card mx-auto flex w-full max-w-md min-h-[12rem] flex-col items-center justify-center gap-1 border border-border-soft px-4 py-8 text-center"
              aria-busy="true"
            >
              <p className="text-meta font-medium text-text">Loading composer…</p>
            </div>
          }
        >
          <ComposeClient />
        </Suspense>
      </div>
    </div>
  );
}
