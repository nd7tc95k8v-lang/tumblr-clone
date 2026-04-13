"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  readStoredThemePreference,
  resolveEffectiveTheme,
  type ThemePreference,
} from "@/lib/theme-preference";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  const syncFromStorage = useCallback(() => {
    const p = readStoredThemePreference();
    const r = resolveEffectiveTheme(p);
    setPreferenceState(p);
    setResolved(r);
    applyThemeToDocument(r);
  }, []);

  useLayoutEffect(() => {
    syncFromStorage();
  }, [syncFromStorage]);

  useEffect(() => {
    const onCustom = () => syncFromStorage();
    window.addEventListener(THEME_CHANGE_EVENT, onCustom);
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) syncFromStorage();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncFromStorage]);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolveEffectiveTheme("system");
      setResolved(r);
      applyThemeToDocument(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    const r = resolveEffectiveTheme(next);
    setPreferenceState(next);
    setResolved(r);
    applyThemeToDocument(r);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
