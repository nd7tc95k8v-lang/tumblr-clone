"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { APP_NAME, NOTIFICATION_INBOX_MARKED_READ_EVENT } from "@/lib/constants";
import { fetchNotificationUnreadCount } from "@/lib/supabase/notifications-inbox";
import { clearPostImageSignedUrlCache } from "@/lib/supabase/post-image-url-cache";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeUsername } from "@/lib/username";
import SidebarAccount from "./SidebarAccount";

const SPLASH_SLOGANS = [
  "Find your voice. Shape the vibe.",
  "Create boldly. Belong naturally.",
  "A welcoming space for creative voices.",
  "Share your art. Find your people.",
  "Where creators shape the conversation.",
];

/** Mobile splash: slogan motion ~420ms; fade ~1950ms; unmount ~2550ms (~600ms opacity transition). */
const SPLASH_SLOGAN_REVEAL_MS = 420;
const SPLASH_FADE_START_MS = 1950;
const SPLASH_TOTAL_MS = 2550;
const SPLASH_FADE_DURATION_MS = SPLASH_TOTAL_MS - SPLASH_FADE_START_MS;

const linkBase =
  "block rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";
const linkActive =
  "border border-border bg-surface font-semibold text-text shadow-sm hover:bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/80 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
  /** Unread count badge (notifications only in this pass). */
  badge?: number;
};

const mobileTabIconSvgPropsBase = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function MobileTabIcon({ label, active }: { label: string; active: boolean }) {
  const iconClassName = `size-[1.35rem] shrink-0 transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none ${
    active ? "scale-[1.06] -translate-y-px opacity-100" : "scale-100 opacity-[0.88] motion-reduce:opacity-100"
  }`;
  const mobileTabIconSvgProps = { ...mobileTabIconSvgPropsBase, className: iconClassName };

  switch (label) {
    case "Home":
      return (
        <svg {...mobileTabIconSvgProps}>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "Explore":
      return (
        <svg {...mobileTabIconSvgProps}>
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </svg>
      );
    case "Profile":
      return (
        <svg {...mobileTabIconSvgProps}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "Settings":
      return (
        <svg {...mobileTabIconSvgProps}>
          <line x1="4" x2="4" y1="21" y2="14" />
          <line x1="4" x2="4" y1="10" y2="3" />
          <line x1="12" x2="12" y1="21" y2="12" />
          <line x1="12" x2="12" y1="8" y2="3" />
          <line x1="20" x2="20" y1="21" y2="16" />
          <line x1="20" x2="20" y1="12" y2="3" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="16" r="2" />
          <circle cx="20" cy="8" r="2" />
        </svg>
      );
    default:
      return null;
  }
}

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
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        clearPostImageSignedUrlCache();
      }
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
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  const refreshNotificationsUnread = useCallback(async () => {
    if (!supabase || !user) {
      setUnreadNotifCount(0);
      return;
    }
    const { count, error } = await fetchNotificationUnreadCount(supabase);
    if (error) {
      setUnreadNotifCount(0);
      return;
    }
    setUnreadNotifCount(count);
  }, [supabase, user]);

  /** Initial load + auth/session changes. */
  useEffect(() => {
    void refreshNotificationsUnread();
  }, [refreshNotificationsUnread]);

  /** Route changes (skip entering `/notifications` — inbox updates the badge via custom event after mark-read). */
  const pathnameRef = useRef<string | null>(null);
  useEffect(() => {
    if (pathnameRef.current === null) {
      pathnameRef.current = pathname;
      return;
    }
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    if (pathname.startsWith("/notifications")) return;
    void refreshNotificationsUnread();
  }, [pathname, refreshNotificationsUnread]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMarkedRead = () => {
      void refreshNotificationsUnread();
    };
    window.addEventListener(NOTIFICATION_INBOX_MARKED_READ_EVENT, onMarkedRead);
    return () => window.removeEventListener(NOTIFICATION_INBOX_MARKED_READ_EVENT, onMarkedRead);
  }, [refreshNotificationsUnread]);

  /** Tab focus / bfcache restore — keeps badge plausible without polling. */
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void refreshNotificationsUnread();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void refreshNotificationsUnread();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refreshNotificationsUnread]);

  const [slogan] = useState(() => {
    const i = Math.floor(Math.random() * SPLASH_SLOGANS.length);
    return SPLASH_SLOGANS[i];
  });

  const [splashMounted, setSplashMounted] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [sloganVisible, setSloganVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let sloganRevealTimer: number | null = null;
    let fadeStartTimer: number | null = null;
    let unmountTimer: number | null = null;

    if (reduceMotion.matches) {
      setSloganVisible(true);
      fadeStartTimer = window.setTimeout(() => setSplashFading(true), SPLASH_FADE_START_MS);
      unmountTimer = window.setTimeout(() => setSplashMounted(false), SPLASH_TOTAL_MS);
      return () => {
        if (fadeStartTimer !== null) window.clearTimeout(fadeStartTimer);
        if (unmountTimer !== null) window.clearTimeout(unmountTimer);
      };
    }

    sloganRevealTimer = window.setTimeout(() => setSloganVisible(true), SPLASH_SLOGAN_REVEAL_MS);
    fadeStartTimer = window.setTimeout(() => setSplashFading(true), SPLASH_FADE_START_MS);
    unmountTimer = window.setTimeout(() => setSplashMounted(false), SPLASH_TOTAL_MS);

    return () => {
      if (sloganRevealTimer !== null) window.clearTimeout(sloganRevealTimer);
      if (fadeStartTimer !== null) window.clearTimeout(fadeStartTimer);
      if (unmountTimer !== null) window.clearTimeout(unmountTimer);
    };
  }, []);

  const sidebarItems: NavItem[] = useMemo(
    () => [
      { href: "/", label: "Home", match: (p: string) => p === "/" },
      {
        href: "/notifications",
        label: "Notifications",
        match: (p) => p === "/notifications" || p.startsWith("/notifications/"),
        badge: unreadNotifCount > 0 ? unreadNotifCount : undefined,
      },
      { href: "/explore", label: "Explore", match: (p) => p === "/explore" },
      { href: "/search", label: "Search", match: (p) => p === "/search" },
      {
        href: profileHref,
        label: "Profile",
        match: (p) => p.startsWith("/profile/"),
      },
      { href: "/settings", label: "Settings", match: (p) => p === "/settings" },
    ],
    [profileHref, unreadNotifCount],
  );

  /** Bottom bar stays 5 slots (grid-cols-5); Search is desktop sidebar + direct URL. */
  const mobileItems: NavItem[] = [
    sidebarItems[0],
    sidebarItems[2],
    sidebarItems[4],
    sidebarItems[5],
  ];

  const createActive = pathname === "/compose";

  const sidebarNav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {sidebarItems.map(({ href, label, match, badge }) => (
        <Link
          key={label}
          href={href}
          className={match(pathname) ? `${linkBase} ${linkActive}` : linkBase}
        >
          <span className="flex items-center justify-between gap-2">
            <span>{label}</span>
            {badge != null && badge > 0 ? (
              <span className="tabular-nums rounded-full bg-accent-aqua/90 px-1.5 text-[10px] font-bold leading-none text-black">
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </span>
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
    "relative flex min-h-[3.5rem] min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 px-0.5 pb-2.5 pt-1.5 text-center text-[10px] font-medium leading-none tracking-wide transition-[color,background-color,transform,opacity] duration-150 ease-out";
  const mobileTabInactive =
    "rounded-lg text-text-muted active:scale-[0.97] active:bg-bg-secondary/55 motion-reduce:active:scale-100";
  const mobileTabActive =
    "rounded-lg font-semibold text-text after:pointer-events-none after:absolute after:bottom-2.5 after:left-1/2 after:h-[3px] after:w-8 after:-translate-x-1/2 after:rounded-full after:bg-text after:shadow-[0_1px_2px_rgba(0,0,0,0.12)]";
  const mobilePostTabActive =
    "font-semibold text-text after:pointer-events-none after:absolute after:bottom-3 after:left-1/2 after:h-0.5 after:w-7 after:-translate-x-1/2 after:rounded-full after:bg-accent-aqua/90";

  return (
    <div className="min-h-full flex flex-col bg-bg">
      {splashMounted ? (
        <div
          className={`fixed inset-0 z-[60] flex flex-col items-center justify-center gap-2 bg-bg px-6 md:hidden pointer-events-none transition-opacity ease-out ${
            splashFading ? "opacity-0" : "opacity-100"
          }`}
          style={{ transitionDuration: `${SPLASH_FADE_DURATION_MS}ms` }}
          aria-hidden="true"
        >
          <img
            src="/logo/qrtz-logo.svg"
            alt=""
            className="h-28 w-auto shrink-0"
            width={392}
            height={112}
          />
          <p
            className={`max-w-[min(320px,100vw-3rem)] text-center text-base font-medium leading-snug text-text-muted transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none ${
              sloganVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            } motion-reduce:translate-y-0 motion-reduce:opacity-100`}
          >
            {slogan}
          </p>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 flex min-h-[calc(2.75rem+env(safe-area-inset-top,0px))] min-w-0 shrink-0 items-center gap-1.5 border-b border-border/40 bg-bg/90 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md md:hidden">
        <div className="min-w-0 flex-1">
          <Link
            href="/"
            className="flex min-h-11 min-w-0 max-w-full items-center gap-1.5 py-0.5 text-text transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.99] active:opacity-80 motion-reduce:active:scale-100"
            aria-label={APP_NAME}
          >
            <img
              src="/logo/qrtz-logo.svg"
              alt=""
              className="h-[1.375rem] w-auto shrink-0"
              width={112}
              height={24}
            />
            <span className="min-w-0 truncate text-[0.9375rem] font-semibold leading-tight tracking-tight">{APP_NAME}</span>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {supabase && user ? (
            <Link
              href="/notifications"
              aria-label={
                unreadNotifCount > 0
                  ? `Notifications, ${unreadNotifCount > 99 ? "99+" : unreadNotifCount} unread`
                  : "Notifications"
              }
              className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-[color,background-color,transform,opacity] duration-150 ease-out hover:bg-bg-secondary hover:text-text active:scale-[0.97] active:bg-bg-secondary/55 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/60"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[1.35rem] shrink-0 transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none"
                aria-hidden
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadNotifCount > 0 ? (
                <span className="absolute right-1 top-1 flex min-h-[0.875rem] min-w-[0.875rem] items-center justify-center rounded-full bg-accent-aqua px-[3px] text-[9px] font-bold leading-none text-black ring-2 ring-bg/90">
                  {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
                </span>
              ) : null}
            </Link>
          ) : null}
          <Link
            href="/search"
            aria-label="Search"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-[color,background-color,transform,opacity] duration-150 ease-out hover:bg-bg-secondary hover:text-text active:scale-[0.97] active:bg-bg-secondary/55 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/60"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[1.35rem] shrink-0 transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </Link>
        </div>
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

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-bg pb-[calc(4.375rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          <div className="flex-1 min-h-0">{children}</div>
          <footer className="shrink-0 border-t border-border px-4 py-4 text-center text-meta text-text-muted">
            © 2026 {APP_NAME}
          </footer>
        </main>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 items-stretch border-t border-border/40 bg-bg/90 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] shadow-[0_-10px_40px_-18px_rgba(0,0,0,0.08)] backdrop-blur-md md:hidden"
        aria-label="Mobile navigation"
      >
        {mobileItems.slice(0, 2).map(({ href, label, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={label}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`${mobileTabBase} ${bottomBarFocus} ${active ? mobileTabActive : mobileTabInactive}`}
            >
              <MobileTabIcon label={label} active={active} />
              {active ? (
                <span className="max-w-full truncate px-0.5 text-[9px] font-semibold leading-tight tracking-wide text-text">
                  {label}
                </span>
              ) : null}
            </Link>
          );
        })}
        <Link
          href="/compose"
          aria-label="Create post"
          aria-current={createActive ? "page" : undefined}
          className={`${mobileTabBase} ${bottomBarFocus} ${
            createActive ? mobilePostTabActive : "text-text-secondary active:bg-bg-secondary/55"
          }`}
        >
          <span
            className={`qrtz-btn-primary relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold leading-none transition-[transform,box-shadow] duration-150 ease-out motion-reduce:translate-y-0 motion-reduce:shadow-sm motion-reduce:ring-1 motion-reduce:ring-white/25 ${
              createActive
                ? "-translate-y-1.5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_8px_22px_-5px_rgba(0,0,0,0.26)] ring-2 ring-white/45"
                : "-translate-y-1 shadow-[0_2px_8px_rgba(0,0,0,0.12),0_5px_16px_-5px_rgba(0,0,0,0.2)] ring-1 ring-white/28"
            }`}
            aria-hidden
          >
            +
          </span>
        </Link>
        {mobileItems.slice(2).map(({ href, label, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={label}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`${mobileTabBase} ${bottomBarFocus} ${active ? mobileTabActive : mobileTabInactive}`}
            >
              <MobileTabIcon label={label} active={active} />
              {active ? (
                <span className="max-w-full truncate px-0.5 text-[9px] font-semibold leading-tight tracking-wide text-text">
                  {label}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
