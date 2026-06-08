import type { Metadata } from "next";
import React from "react";
import QueueClient from "../../../components/QueueClient";

export const metadata: Metadata = {
  title: "Queue",
};

export default function QueuePage() {
  return (
    <div className="min-h-full flex flex-col items-center py-8 px-4 md:py-10">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <QueueClient />
      </div>
    </div>
  );
}
