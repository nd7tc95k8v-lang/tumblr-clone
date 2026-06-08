import type { Metadata } from "next";
import React from "react";
import DraftsClient from "../../../components/DraftsClient";

export const metadata: Metadata = {
  title: "Drafts",
};

export default function DraftsPage() {
  return (
    <div className="min-h-full flex flex-col items-center py-8 px-4 md:py-10">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <DraftsClient />
      </div>
    </div>
  );
}
