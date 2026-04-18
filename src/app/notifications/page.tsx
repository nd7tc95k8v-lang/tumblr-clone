import type { Metadata } from "next";
import React from "react";
import NotificationsClient from "../../../components/NotificationsClient";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <div className="min-h-full flex flex-col items-center py-8 px-4 md:py-10">
      <div className="w-full max-w-3xl flex flex-col gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-text px-3 sm:px-0">Notifications</h1>
        <NotificationsClient />
      </div>
    </div>
  );
}
