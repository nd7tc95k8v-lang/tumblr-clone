"use client";

import React from "react";
import type { ThemePreference } from "@/lib/theme-preference";
import { useTheme } from "./ThemeProvider";

const OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always use light mode." },
  { value: "dark", label: "Dark", description: "Always use dark mode." },
  { value: "system", label: "System", description: "Match your device or browser setting." },
];

export default function ThemeAppearanceSettings() {
  const { preference, setPreference } = useTheme();

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted mb-1">Appearance</h2>
      <p className="text-xs text-text-secondary mb-4">
        Color theme for this device. System updates when your OS changes.
      </p>
      <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-2">
        {OPTIONS.map((o) => {
          const selected = preference === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(o.value)}
              className={`flex w-full flex-col items-start rounded-md border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                selected
                  ? "border-primary bg-primary-soft text-text"
                  : "border-border bg-surface-elevated hover:bg-bg-secondary text-text"
              }`}
            >
              <span className="text-sm font-semibold">{o.label}</span>
              <span className="text-xs font-normal text-text-secondary mt-0.5">{o.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
