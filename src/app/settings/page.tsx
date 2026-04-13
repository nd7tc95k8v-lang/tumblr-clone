import React from "react";
import SettingsClient from "../../../components/SettingsClient";

export default function SettingsPage() {
  return (
    <div className="min-h-full flex flex-col items-center py-8 px-4 md:py-10">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <h1 className="text-2xl md:text-3xl font-bold text-text">Settings</h1>
        <SettingsClient />
      </div>
    </div>
  );
}
