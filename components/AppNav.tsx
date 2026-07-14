"use client";

import Link from "next/link";
import MobileAccountMenu from "@/components/MobileAccountMenu";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

type CurrentUser = {
  id: string;
  teamId: number;
  displayName: string;
  role: "player" | "admin";
  avatarUrl: string | null;
};

function getFallbackProfileImage(displayName: string) {
  const imageMap: Record<string, string> = {
    mark: "/team-headshots/mark.jpg",
    andy: "/team-headshots/andy.jpg",
    jon: "/team-headshots/jon.jpg",
    josh: "/team-headshots/josh.jpg",
  };

  return imageMap[displayName.trim().toLowerCase()] ?? null;
}

const mainLinks = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/lineups/draft", label: "Draft", icon: "✎" },
  { href: "/lineups/scores", label: "Scores", icon: "▦" },
];

const desktopAdminGroups = [
  {
    label: "Overview",
    links: [{ href: "/admin", label: "Admin Home" }],
  },
  {
    label: "Slates",
    links: [
      { href: "/slates/new", label: "Create Slate" },
      { href: "/admin/slates", label: "Manage Slates" },
      { href: "/admin/slate-games", label: "Slate NBA Games" },
      { href: "/admin/corrections", label: "Corrections" },
    ],
  },
  {
    label: "Notifications",
    links: [
      {
        href: "/admin/notification-templates",
        label: "Notification Templates",
      },
      {
        href: "/admin/notification-history",
        label: "Notification History",
      },
    ],
  },
  {
    label: "Players",
    links: [{ href: "/admin/players", label: "Manage Players" }],
  },
];

const profileLinks = [
  {
    href: "/profile?tab=overview",
    label: "Overview",
    tab: "overview",
  },
  {
    href: "/profile?tab=awards",
    label: "Awards",
    tab: "awards",
  },
  {
    href: "/profile?tab=settings",
    label: "Settings",
    tab: "settings",
  },
];

function AppNavContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeProfileTab =
    pathname.startsWith("/profile")
      ? searchParams.get("tab") ?? "overview"
      : null;

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [desktopUserOpen, setDesktopUserOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const desktopUserRef = useRef<HTMLDivElement | null>(null);
  const mobileMoreRef = useRef<HTMLDivElement | null>(null);

  const isAdmin = currentUser?.role === "admin";

  const moreIsActive =
    pathname.startsWith("/standings") ||
    pathname.startsWith("/player-history");

  const userMenuIsActive =
    pathname.startsWith("/profile") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/slates");

  useEffect(() => {
    function handleAvatarUpdated(event: Event) {
      const customEvent = event as CustomEvent<{
        avatarUrl: string | null;
      }>;

      setCurrentUser((current) =>
        current
          ? {
              ...current,
              avatarUrl: customEvent.detail.avatarUrl,
            }
          : current
      );
    }

    window.addEventListener(
      "profile-avatar-updated",
      handleAvatarUpdated
    );

    return () => {
      window.removeEventListener(
        "profile-avatar-updated",
        handleAvatarUpdated
      );
    };
  }, []);

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
        });

        const result = await response.json();

        if (response.ok && result.authenticated && result.user) {
          setCurrentUser(result.user as CurrentUser);
        } else {
          setCurrentUser(null);
        }
      } catch (error) {
        console.error("Failed to load current user", error);
        setCurrentUser(null);
      } finally {
        setIsUserLoading(false);
      }
    }

    void loadCurrentUser();
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;

      if (
        desktopUserRef.current &&
        !desktopUserRef.current.contains(target)
      ) {
        setDesktopUserOpen(false);
      }

      if (mobileMoreRef.current && !mobileMoreRef.current.contains(target)) {
        setMobileMoreOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleLogout() {
    try {
      setIsLoggingOut(true);

      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Logout failed.");
      }

      setCurrentUser(null);
      setDesktopUserOpen(false);
      setMobileMoreOpen(false);

      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error(error);
      window.alert("Unable to log out right now.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  function isLinkActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function desktopLinkClass(href: string) {
    const active = isLinkActive(href);

    return `rounded-full border px-4 py-2 text-sm font-medium transition ${
      active
        ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
        : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
    }`;
  }

  function mobileLinkClass(href: string) {
    const active = isLinkActive(href);

    return `flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
      active
        ? "bg-sky-100 text-sky-900"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
    }`;
  }

  const mobileMoreLinks = [
    { href: "/standings", label: "Standings" },
    { href: "/player-history", label: "Player History" },
  ];

  return (
    <>
      {/* Desktop nav only */}
      <nav className="mb-6 hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:block">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {mainLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={desktopLinkClass(link.href)}
              >
                {link.label}
              </Link>
            ))}

            <Link href="/standings" className={desktopLinkClass("/standings")}>
              Standings
            </Link>

            <Link
              href="/player-history"
              className={desktopLinkClass("/player-history")}
            >
              Player History
            </Link>
          </div>

          <div className="relative" ref={desktopUserRef}>
            {isUserLoading ? (
              <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400">
                Loading...
              </div>
            ) : currentUser ? (
              <>
                <button
                  type="button"
                  onClick={() => setDesktopUserOpen((open) => !open)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    userMenuIsActive
                      ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {currentUser.avatarUrl ||
                    getFallbackProfileImage(currentUser.displayName) ? (
                      <img
                        src={
                          currentUser.avatarUrl ??
                          getFallbackProfileImage(
                            currentUser.displayName
                          ) ??
                          undefined
                        }
                        alt={`${currentUser.displayName} profile`}
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-white shadow-sm"
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-200 text-xs font-bold text-sky-900">
                        {currentUser.displayName
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                    )}

                    <span>{currentUser.displayName}</span>
                    <span aria-hidden="true">▾</span>
                  </span>
                </button>

                {desktopUserOpen ? (
                  <div className="absolute right-0 z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                    <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Profile
                    </div>

                    {profileLinks.map((link) => {
                      const isActive =
                        pathname.startsWith("/profile") &&
                        activeProfileTab === link.tab;

                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setDesktopUserOpen(false)}
                          className={`block rounded-xl px-3 py-2 text-sm transition ${
                            isActive
                              ? "bg-sky-100 font-semibold text-sky-900"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {link.label}
                        </Link>
                      );
                    })}

                    {isAdmin ? (
                      <>
                        <div className="my-2 border-t border-slate-200" />

                        <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Admin
                        </div>

                        {desktopAdminGroups.map((group, groupIndex) => (
                          <div key={group.label}>
                            {groupIndex > 0 ? (
                              <div className="my-2 border-t border-slate-100" />
                            ) : null}

                            <div className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              {group.label}
                            </div>

                            {group.links.map((link) => (
                              <Link
                                key={link.href}
                                href={link.href}
                                onClick={() => setDesktopUserOpen(false)}
                                className={`block rounded-xl px-3 py-2 text-sm transition ${
                                  isLinkActive(link.href)
                                    ? "bg-sky-100 font-semibold text-sky-900"
                                    : "text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                {link.label}
                              </Link>
                            ))}
                          </div>
                        ))}
                      </>
                    ) : null}

                    <div className="my-2 border-t border-slate-200" />

                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      disabled={isLoggingOut}
                      className="block w-full rounded-xl px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      {isLoggingOut ? "Logging out..." : "Logout"}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
              >
                Join Your Team
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Global mobile account header */}
      <nav className="mb-6 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:hidden">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3"
          aria-label="111 Fantasy Sports home"
        >
          <img
            src="/icon-192.png"
            alt=""
            aria-hidden="true"
            className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-sm"
          />

          <span className="truncate text-lg font-bold tracking-tight text-slate-900">
            111 Fantasy Sports
          </span>
        </Link>

        <MobileAccountMenu />
      </nav>

      {/* White shield behind mobile nav */}
      <div
        className="fixed bottom-[-56px] left-0 right-0 z-[9998] h-28 bg-white sm:hidden"
        aria-hidden="true"
      />

      {/* Mobile bottom nav only */}
      <div
        ref={mobileMoreRef}
        className="fixed bottom-[-48px] left-0 right-0 z-[9999] border-t border-slate-200 bg-white px-3 pb-[58px] pt-2 shadow-[0_-6px_16px_rgba(15,23,42,0.10)] sm:hidden"
      >
        {mobileMoreOpen ? (
          <div className="absolute bottom-full right-3 mb-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {mobileMoreLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMoreOpen(false)}
                className={`block rounded-xl px-4 py-3 text-sm font-medium transition ${
                  (
                    link.href.startsWith("/profile?")
                      ? pathname.startsWith("/profile") &&
                        activeProfileTab ===
                          new URLSearchParams(
                            link.href.split("?")[1] ?? ""
                          ).get("tab")
                      : isLinkActive(link.href)
                  )
                    ? "bg-sky-100 text-sky-900"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            ))}

          </div>
        ) : null}

        <div className="mx-auto grid max-w-xl grid-cols-4 gap-1">
          {mainLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={mobileLinkClass(link.href)}
            >
              <span className="text-lg leading-none">{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}

          <button
            type="button"
            onClick={() => setMobileMoreOpen((open) => !open)}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
              moreIsActive
                ? "bg-sky-100 text-sky-900"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span className="text-lg leading-none">⋯</span>
            <span>More</span>
          </button>
        </div>
      </div>
    </>
  );
}


export default function AppNav() {
  return (
    <Suspense
      fallback={
        <nav className="mb-6 hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:block">
          <div className="h-10" />
        </nav>
      }
    >
      <AppNavContent />
    </Suspense>
  );
}
