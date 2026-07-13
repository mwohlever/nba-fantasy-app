"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type CurrentUser = {
  id: string;
  teamId: number;
  displayName: string;
  role: "player" | "admin";
};

const mainLinks = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/lineups/draft", label: "Draft", icon: "✎" },
  { href: "/lineups/scores", label: "Scores", icon: "▦" },
];

const desktopAdminLinks = [
  { href: "/admin", label: "Admin Home" },
  { href: "/admin/players", label: "Manage Players" },
  { href: "/admin/slates", label: "Manage Slates" },
  { href: "/admin/slate-games", label: "Slate NBA Games" },
  { href: "/slates/new", label: "Create Slate" },
];

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

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
    pathname.startsWith("/player-history") ||
    pathname.startsWith("/profile") ||
    (isAdmin &&
      (pathname.startsWith("/admin") || pathname.startsWith("/slates")));

  const userMenuIsActive =
    pathname.startsWith("/profile") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/slates");

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
    ...(currentUser ? [{ href: "/profile", label: "Profile" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
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
                  👤 {currentUser.displayName} ▾
                </button>

                {desktopUserOpen ? (
                  <div className="absolute right-0 z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                    <Link
                      href="/profile"
                      onClick={() => setDesktopUserOpen(false)}
                      className={`block rounded-xl px-3 py-2 text-sm transition ${
                        isLinkActive("/profile")
                          ? "bg-sky-100 font-semibold text-sky-900"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      Profile
                    </Link>

                    {isAdmin ? (
                      <>
                        <div className="my-2 border-t border-slate-200" />

                        <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Admin
                        </div>

                        {desktopAdminLinks.map((link) => (
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
            {currentUser ? (
              <div className="mb-2 rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Signed in as
                </div>
                <div className="mt-1 font-semibold text-slate-900">
                  {currentUser.displayName}
                </div>
              </div>
            ) : null}

            {mobileMoreLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMoreOpen(false)}
                className={`block rounded-xl px-4 py-3 text-sm font-medium transition ${
                  isLinkActive(link.href)
                    ? "bg-sky-100 text-sky-900"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            ))}

            <div className="my-2 border-t border-slate-200" />

            {currentUser ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
                className="block w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {isLoggingOut ? "Logging out..." : "Logout"}
              </button>
            ) : (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
                <div className="text-sm font-semibold text-sky-900">
                  Join your team
                </div>

                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Log in for your profile, draft alerts, and player notifications.
                </p>

                <Link
                  href="/login"
                  onClick={() => setMobileMoreOpen(false)}
                  className="mt-3 block rounded-xl bg-sky-700 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-sky-800"
                >
                  Log In
                </Link>
              </div>
            )}
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
