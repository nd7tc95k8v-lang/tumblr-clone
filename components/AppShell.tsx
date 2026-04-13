"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeUsername } from "@/lib/username";

const linkBase =
  "block rounded-md px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/80 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-zinc-100";
const linkActive =
  "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

function useProfileHref(supabase: ReturnType<typeof createBrowserSupabaseClient>) {
  const [profileUsername, setProfileUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setProfileUsername(null);
        return;
      }
      const { data } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
      if (cancelled) return;
      const u = data?.username?.trim();
      setProfileUsername(u && u.length > 0 ? u : null);
    };

    void load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  return profileUsername !== null
    ? `/profile/${encodeURIComponent(normalizeUsername(profileUsername))}`
    : "/";
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const profileHref = useProfileHref(supabase);

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
            ? "mt-3 block rounded-md py-2.5 px-3 text-center text-sm font-semibold bg-blue-700 text-white"
            : "mt-3 block rounded-md py-2.5 px-3 text-center text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
        }
      >
        Create post
      </Link>
    </nav>
  );

  const brand = (
    <Link
      href="/"
      className="mb-6 block text-lg font-bold text-zinc-900 dark:text-zinc-50 tracking-tight hover:opacity-90"
    >
      My Tumblr Clone
    </Link>
  );

  const bottomBar =
    "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-w-0 text-[11px] font-medium leading-tight text-center";

  return (
    <div className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-zinc-950/95 px-4 backdrop-blur-sm md:hidden">
        <Link href="/" className="text-base font-bold text-zinc-900 dark:text-zinc-50">
          My Tumblr Clone
        </Link>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          id="app-sidebar"
          className="hidden md:flex w-56 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 min-h-screen"
          aria-label="Sidebar"
        >
          {brand}
          {!supabase ? (
            <p className="mb-4 text-xs text-amber-800 dark:text-amber-200">
              Add Supabase env vars to enable full navigation.
            </p>
          ) : null}
          {sidebarNav}
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          {children}
        </main>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-sm md:hidden pb-[env(safe-area-inset-bottom,0px)]"
        aria-label="Mobile navigation"
      >
        {items.slice(0, 2).map(({ href, label, match }) => (
          <Link
            key={label}
            href={href}
            className={`${bottomBar} ${
              match(pathname)
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 active:bg-zinc-200/80 dark:active:bg-zinc-800/80"
            }`}
          >
            <span className="truncate max-w-full px-0.5">{label}</span>
          </Link>
        ))}
        <Link
          href="/compose"
          className={`${bottomBar} ${
            createActive
              ? "text-blue-700 dark:text-blue-400 font-semibold"
              : "text-blue-600 dark:text-blue-400 active:bg-blue-50 dark:active:bg-blue-950/40"
          }`}
        >
          <span className="rounded-full bg-blue-600 text-white text-[10px] font-bold px-2 py-1 leading-none mb-0.5">
            +
          </span>
          <span className="truncate max-w-full">Post</span>
        </Link>
        {items.slice(2).map(({ href, label, match }) => (
          <Link
            key={label}
            href={href}
            className={`${bottomBar} ${
              match(pathname)
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 dark:text-zinc-400 active:bg-zinc-200/80 dark:active:bg-zinc-800/80"
            }`}
          >
            <span className="truncate max-w-full px-0.5">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
