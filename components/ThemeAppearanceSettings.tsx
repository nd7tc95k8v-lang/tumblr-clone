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
    <section className="qrtz-card">
      <h2 className="mb-1 text-meta font-semibold uppercase tracking-wide text-text-muted">Appearance</h2>
      <p className="mb-4 text-meta text-text-secondary">
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
              className={`flex w-full flex-col items-start rounded-btn px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/75 focus-visible:ring-offset-1 focus-visible:ring-offset-bg ${
                selected
                  ? "qrtz-option-selected text-text"
                  : "border border-border bg-surface-elevated hover:bg-bg-secondary text-text"
              }`}
            >
              <span className="font-heading text-sm font-semibold">{o.label}</span>
              <span className="mt-0.5 text-meta font-normal text-text-secondary">{o.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
