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

  const bottomBar =
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-center text-meta font-medium leading-tight";
  const bottomBarFocus =
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-focus/70";

  return (
    <div className="min-h-full flex flex-col bg-bg">
      <header className="sticky top-0 z-30 flex h-12 min-w-0 shrink-0 items-center border-b border-border bg-bg/95 px-4 backdrop-blur-sm md:hidden">
        <Link
          href="/"
          className="flex min-w-0 max-w-full items-center gap-2 text-text"
          aria-label={APP_NAME}
        >
          <img
            src="/logo/qrtz-logo.svg"
            alt=""
            className="h-7 w-auto shrink-0"
            width={120}
            height={28}
          />
          <span className="min-w-0 truncate text-lg font-semibold tracking-tight">{APP_NAME}</span>
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

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0 bg-bg flex flex-col">
          <div className="flex-1 min-h-0">{children}</div>
          <footer className="shrink-0 border-t border-border px-4 py-4 text-center text-meta text-text-muted">
            © 2026 {APP_NAME}
          </footer>
        </main>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-bg/95 backdrop-blur-sm md:hidden pb-[env(safe-area-inset-bottom,0px)]"
        aria-label="Mobile navigation"
      >
        {items.slice(0, 2).map(({ href, label, match }) => (
          <Link
            key={label}
            href={href}
            className={`${bottomBar} ${bottomBarFocus} ${
              match(pathname) ? "text-text" : "text-text-muted active:bg-bg-secondary"
            }`}
          >
            <span className="truncate max-w-full px-0.5">{label}</span>
          </Link>
        ))}
        <Link
          href="/compose"
          className={`${bottomBar} ${bottomBarFocus} ${
            createActive ? "font-semibold text-accent-aqua" : "text-accent-aqua active:bg-primary-soft/40"
          }`}
        >
          <span className="qrtz-btn-primary mb-0.5 flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-full px-2 py-1 text-[10px] font-bold leading-none">
            +
          </span>
          <span className="truncate max-w-full">Post</span>
        </Link>
        {items.slice(2).map(({ href, label, match }) => (
          <Link
            key={label}
            href={href}
            className={`${bottomBar} ${bottomBarFocus} ${
              match(pathname) ? "text-text" : "text-text-muted active:bg-bg-secondary"
            }`}
          >
            <span className="truncate max-w-full px-0.5">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
