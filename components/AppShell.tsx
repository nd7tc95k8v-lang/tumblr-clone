"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/constants";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeUsername } from "@/lib/username";
import SidebarAccount from "./SidebarAccount";

const linkBase =
  "block rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";
const linkActive =
  "border border-border bg-surface font-semibold text-text shadow-sm hover:bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

function useSupabaseSidebarAuth(supabase: ReturnType<typeof createBrowserSupabaseClient>) {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setUser(null);
      setUsername(null);
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const u = session?.user ?? null;
    setUser(u);
    if (!u) {
      setUsername(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("username").eq("id", u.id).maybeSingle();
    const un = data?.username?.trim();
    setUsername(un && un.length > 0 ? un : null);
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => subscription.unsubscribe();
  }, [supabase, refresh]);

  const profileHref =
    username !== null ? `/profile/${encodeURIComponent(normalizeUsername(username))}` : "/";

  return { user, username, profileHref, refreshAuth: refresh };
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { user, username, profileHref, refreshAuth } = useSupabaseSidebarAuth(supabase);

  const items: NavItem[] = [
    { href: "/", label: "Home", match: (p) => p === "/" },
    { href: "/explore", label: "Explore", match: (p) => p === "/explore" },
    {
      href: profileHref,
      label: "Profile",
      match: (p) => p.startsWith("/profile/"),
    },
    { href: "/settings", label: "Settings", match: (p) => p === "/settings" },
  ];

  const createActive = pathname === "/compose";

  const sidebarNav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map(({ href, label, match }) => (
        <Link key={label} href={href} className={match(pathname) ? `${linkBase} ${linkActive}` : linkBase}>
          {label}
        </Link>
      ))}
      <Link
        href="/compose"
        className={
          createActive
            ? "qrtz-btn-primary mt-3 block px-3 py-2.5 text-center text-sm"
            : "qrtz-btn-primary mt-3 block px-3 py-2.5 text-center text-sm"
        }
      >
        Create post
      </Link>
    </nav>
  );

  const brand = (
    <Link
      href="/"
      className="mb-6 flex min-w-0 items-center gap-2 text-text transition-opacity hover:opacity-90"
      aria-label={APP_NAME}
    >
      <img
        src="/logo/qrtz-logo.svg"
        alt=""
        className="h-8 w-auto shrink-0"
        width={140}
        height={32}
      />
      <span className="truncate text-lg font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );

  const bottomBarFocus =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/60";
  const mobileTabBase =
    "relative flex min-h-[3.25rem] min-w-0 touch-manipulation flex-col items-center justify-center gap-1 px-0.5 pb-2 pt-1 text-center text-[11px] font-medium leading-none tracking-wide transition-[color,background-color] duration-150 ease-out";
  const mobileTabInactive = "text-text-muted active:bg-bg-secondary/55";
  const mobileTabActive =
    "font-semibold text-text after:pointer-events-none after:absolute after:bottom-1.5 after:left-1/2 after:h-0.5 after:w-7 after:-translate-x-1/2 after:rounded-full after:bg-text/80";
  const mobilePostTabActive =
    "font-semibold text-text after:pointer-events-none after:absolute after:bottom-1.5 after:left-1/2 after:h-0.5 after:w-7 after:-translate-x-1/2 after:rounded-full after:bg-accent-aqua/90";

  return (
    <div className="min-h-full flex flex-col bg-bg">
      <header className="sticky top-0 z-30 flex min-h-[calc(2.75rem+env(safe-area-inset-top,0px))] min-w-0 shrink-0 items-center border-b border-border/40 bg-bg/90 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md md:hidden">
        <Link
          href="/"
          className="flex min-h-[2.25rem] min-w-0 max-w-full items-center gap-2 text-text transition-opacity hover:opacity-90 active:opacity-80"
          aria-label={APP_NAME}
        >
          <img
            src="/logo/qrtz-logo.svg"
            alt=""
            className="h-6 w-auto shrink-0"
            width={112}
            height={24}
          />
          <span className="min-w-0 truncate text-base font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          id="app-sidebar"
          className="hidden w-56 shrink-0 border-r border-border bg-bg p-4 md:flex md:min-h-screen md:flex-col"
          aria-label="Sidebar"
        >
          {brand}
          {!supabase ? (
            <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1.5 text-meta text-text">
              Add Supabase env vars to enable full navigation.
            </p>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0">{sidebarNav}</div>
            <div className="min-h-4 flex-1" aria-hidden />
            {supabase && user ? (
              <SidebarAccount supabase={supabase} username={username} onAuthChange={() => void refreshAuth()} />
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-bg pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          <div className="flex-1 min-h-0">{children}</div>
          <footer className="shrink-0 border-t border-border px-4 py-4 text-center text-meta text-text-muted">
            © 2026 {APP_NAME}
          </footer>
        </main>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 items-stretch border-t border-border/40 bg-bg/90 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-10px_40px_-18px_rgba(0,0,0,0.08)] backdrop-blur-md md:hidden"
        aria-label="Mobile navigation"
      >
        {items.slice(0, 2).map(({ href, label, match }) => (
          <Link
            key={label}
            href={href}
            className={`${mobileTabBase} ${bottomBarFocus} ${match(pathname) ? mobileTabActive : mobileTabInactive}`}
          >
            <span className="max-w-full truncate px-0.5">{label}</span>
          </Link>
        ))}
        <Link
          href="/compose"
          className={`${mobileTabBase} ${bottomBarFocus} ${
            createActive ? mobilePostTabActive : "text-text-secondary active:bg-bg-secondary/55"
          }`}
        >
          <span
            className={`qrtz-btn-primary mb-px flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold leading-none shadow-sm ring-1 ring-white/20 transition-[transform,box-shadow] duration-150 ease-out ${
              createActive ? "shadow-md ring-white/25" : ""
            }`}
            aria-hidden
          >
            +
          </span>
          <span
            className={`max-w-full truncate px-0.5 text-[11px] font-semibold leading-none tracking-wide ${
              createActive ? "text-accent-aqua" : "text-text-muted"
            }`}
          >
            Post
          </span>
        </Link>
        {items.slice(2).map(({ href, label, match }) => (
          <Link
            key={label}
            href={href}
            className={`${mobileTabBase} ${bottomBarFocus} ${match(pathname) ? mobileTabActive : mobileTabInactive}`}
          >
            <span className="max-w-full truncate px-0.5">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
