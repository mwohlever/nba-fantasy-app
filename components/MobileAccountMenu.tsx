"use client";

import Link from "next/link";
import DarkModeToggle from "@/components/theme/DarkModeToggle";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { getAdminMenuGroups } from "@/lib/adminMenu";

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

const profileLinks = [
  {
    href: "/profile?tab=overview",
    label: "Overview",
    tab: "overview",
  },
  {
    href: "/profile?tab=awards",
    label: "Trophy Case",
    tab: "awards",
  },
  {
    href: "/profile?tab=settings",
    label: "Settings",
    tab: "settings",
  },
];

const sportScopedPaths = [
  "/profile",
  "/lineups/draft",
  "/lineups/scores",
  "/slates/new",
  "/admin/slates",
  "/admin/notification-templates",
  "/admin/notification-history",
];

function appendSportParam(href: string, sport: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}sport=${sport}`;
}

function getLinkHref(href: string, sport: string) {
  const basePath = href.split("?")[0];

  if (sportScopedPaths.includes(basePath)) {
    return appendSportParam(href, sport);
  }

  return href;
}

function MobileAccountMenuContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedSport } = useSelectedSport();

  const {
    groupContext,
    availableGroups,
    isSwitchingGroup,
    setActiveGroup,
  } = useGroupContext();

  const isNbaSkins =
    pathname.startsWith("/nba-skins") ||
    selectedSport === "nba-skins";

  const activeAdminSport =
    isNbaSkins
      ? "nba-skins"
      : selectedSport;

  const displayedAdminGroups =
    getAdminMenuGroups(
      activeAdminSport,
    );

  const displayedProfileLinks =
    isNbaSkins
      ? [
          {
            href: "/nba-skins/profile",
            label: "Profile / Trophies",
            tab: "overview",
          },
          {
            href: "/profile?tab=settings",
            label: "Settings",
            tab: "settings",
          },
        ]
      : profileLinks;

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

  const activeProfileTab =
    pathname.startsWith("/profile")
      ? searchParams.get("tab") ?? "overview"
      : null;

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
        console.error("Failed to load mobile account user", error);
        setCurrentUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    void loadCurrentUser();
  }, [pathname]);

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
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;

      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
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
      setIsOpen(false);

      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error(error);
      window.alert("Unable to log out right now.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  function isAdminLinkActive(href: string) {
    if (href === "/admin") {
      return pathname === "/admin";
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  if (isLoading) {
    return (
      <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-200 sm:hidden" />
    );
  }

  if (!currentUser) {
    return (
      <Link
        href="/login"
        aria-label="Log in"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sky-300 bg-sky-50 text-lg text-sky-800 shadow-sm sm:hidden"
      >
        👤
      </Link>
    );
  }

  const imageSrc =
    currentUser.avatarUrl ??
    getFallbackProfileImage(currentUser.displayName);

  return (
    <div ref={menuRef} className="relative shrink-0 sm:hidden">
      <button
        type="button"
        aria-label={`Open ${currentUser.displayName} account menu`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex h-12 w-12 items-center justify-center rounded-full border bg-white shadow-sm transition ${
          isOpen ||
          pathname.startsWith("/profile") ||
          pathname.startsWith("/admin") ||
          pathname.startsWith("/slates")
            ? "border-sky-300 ring-2 ring-sky-100"
            : "border-slate-200"
        }`}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={`${currentUser.displayName} profile`}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-200 font-bold text-sky-900">
            {currentUser.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>

      {isOpen ? (
        <div className="app-dropdown-panel absolute right-0 z-[10000] mt-2 max-h-[70dvh] w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt=""
                className="h-11 w-11 rounded-full object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-200 font-bold text-sky-900">
                {currentUser.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Signed in as
              </div>

              <div className="truncate font-semibold text-slate-900">
                {currentUser.displayName}
              </div>
            </div>
          </div>

          <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Profile
          </div>

          {displayedProfileLinks.map((link) => {
            const isActive =
              isNbaSkins
                ? link.tab === "settings"
                  ? pathname.startsWith("/profile") &&
                    activeProfileTab === "settings"
                  : pathname.startsWith("/nba-skins/profile")
                : pathname.startsWith("/profile") &&
                  activeProfileTab === link.tab;

            return (
              <Link
                key={link.href}
                href={
                  isNbaSkins
                    ? link.href
                    : getLinkHref(link.href, selectedSport)
                }
                onClick={() => setIsOpen(false)}
                className={`block rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-sky-100 font-semibold text-sky-900"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          <div className="my-2 border-t border-slate-200" />

          {groupContext ? (
            <>
              <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Groups
              </div>
              <Link
                href={`/groups/${encodeURIComponent(groupContext.group.slug)}`}
                onClick={() => setIsOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {groupContext.group.name} Home
              </Link>
              {availableGroups.length > 1 ? availableGroups
                .filter((group) => group.slug !== groupContext.group.slug)
                .map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    disabled={isSwitchingGroup}
                    onClick={() => {
                      setIsOpen(false);
                      void setActiveGroup(group.slug);
                    }}
                    className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Switch to {group.name}
                  </button>
                )) : null}
              <div className="my-2 border-t border-slate-200" />
            </>
          ) : null}

          <DarkModeToggle />

          {groupContext?.canAdministerGroup ? (
            <>
              <div className="my-2 border-t border-slate-200" />

              <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Admin
              </div>

              {displayedAdminGroups.map((group, groupIndex) => (
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
                      href={getLinkHref(link.href, selectedSport)}
                      onClick={() => setIsOpen(false)}
                      className={`block rounded-xl px-3 py-2.5 text-sm transition ${
                        isAdminLinkActive(link.href)
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
            className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {isLoggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function MobileAccountMenu() {
  return (
    <Suspense
      fallback={
        <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-200 sm:hidden" />
      }
    >
      <MobileAccountMenuContent />
    </Suspense>
  );
}
