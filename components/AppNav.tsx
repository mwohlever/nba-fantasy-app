"use client";

import Link from "next/link";
import MobileAccountMenu from "@/components/MobileAccountMenu";
import DarkModeToggle from "@/components/theme/DarkModeToggle";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  SPORTS,
  getSportConfig,
  sportKeyFromLeagueSportKey,
} from "@/lib/sports";
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

const mainLinks = [
  { href: "/home", label: "Home", icon: "⌂" },
  { href: "/lineups/draft", label: "Draft", icon: "✎" },
  { href: "/lineups/scores", label: "Scores", icon: "▦" },
];

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

function AppNavContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedSport, setSelectedSport } = useSelectedSport();

  const {
    groupContext,
    availableGroups,
    isLoading: isGroupLoading,
    isSwitchingGroup,
    setActiveGroup,
  } = useGroupContext();

  const activeProfileTab =
    pathname.startsWith("/profile")
      ? searchParams.get("tab") ?? "overview"
      : null;

  const isGroupHomeRoute =
    pathname.startsWith(
      "/groups/",
    );

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [desktopUserOpen, setDesktopUserOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const desktopUserRef = useRef<HTMLDivElement | null>(null);
  const mobileMoreRef = useRef<HTMLDivElement | null>(null);

  const desktopGroupRef =
    useRef<HTMLDivElement | null>(null);

  const desktopSportRef =
    useRef<HTMLDivElement | null>(null);

  const mobileSportRef =
    useRef<HTMLDivElement | null>(null);

  const mobileGroupRef =
    useRef<HTMLDivElement | null>(null);

  const [
    desktopGroupOpen,
    setDesktopGroupOpen,
  ] =
    useState(false);

  const [
    desktopSportOpen,
    setDesktopSportOpen,
  ] =
    useState(false);

  const [
    mobileSportOpen,
    setMobileSportOpen,
  ] =
    useState(false);

  const [
    mobileGroupOpen,
    setMobileGroupOpen,
  ] =
    useState(false);

  useEffect(() => {
    document.documentElement.dataset.mobileMoreOpen =
      mobileMoreOpen
        ? "true"
        : "false";

    return () => {
      delete document.documentElement.dataset.mobileMoreOpen;
    };
  }, [
    mobileMoreOpen,
  ]);

  const isAdmin =
    Boolean(
      groupContext?.canAdministerGroup,
    );

  const sportParam =
    searchParams.get(
      "sport",
    );

  const sharedRouteSport =
    sportParam === "nba" ||
    sportParam === "nfl" ||
    sportParam === "golf"
      ? sportParam
      : null;

  const routeSport =
    pathname.startsWith(
      "/nba-skins",
    )
      ? "nba-skins"
      : pathname.startsWith(
            "/ncaa-pickem",
          )
        ? "ncaa"
        : sharedRouteSport;

  const activeSport =
    routeSport ??
    selectedSport;

  const isNbaSkins =
    activeSport === "nba-skins";

  const isNcaaPickEm =
    activeSport === "ncaa";

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

  const displayedAdminGroups =
    getAdminMenuGroups(
      activeSport,
      Boolean(
        groupContext?.isSuperAdmin,
      ),
    );


  const enabledSportKeys =
    new Set(
      (
        groupContext?.leagues ??
        []
      ).map(
        (league) =>
          sportKeyFromLeagueSportKey(
            league.sportKey,
          ),
      ),
    );


  const displayedSports =
    groupContext
      ? SPORTS.filter(
          (sport) =>
            enabledSportKeys.has(
              sport.key,
            ),
        )
      : SPORTS;


  /*
   * The active Group must always be representable in the
   * selector, even while the available-Groups list is loading
   * or temporarily unavailable.
   */
  const displayedGroups =
    groupContext
      ? (
          availableGroups.length > 0
            ? availableGroups
            : [
                {
                  id:
                    groupContext.group.id,

                  name:
                    groupContext.group.name,

                  slug:
                    groupContext.group.slug,

                  role:
                    groupContext.membership.role,

                  isActive:
                    groupContext.group.isActive,
                },
              ]
        )
      : [];


  /*
   * If the active Group does not offer the currently selected
   * sport, move to its first enabled League and make the URL
   * agree with that fallback.
   *
   * This is especially important when switching Groups while
   * the current URL contains ?sport=<old-group-sport>.
   */
  useEffect(() => {
    if (
      !groupContext ||
      displayedSports.length ===
        0 ||
      displayedSports.some(
        (sport) =>
          sport.key ===
          selectedSport,
      )
    ) {
      return;
    }

    const fallbackSport =
      displayedSports[0].key;

    setSelectedSport(
      fallbackSport,
    );


    const isGroupNeutralDestination =
      isGroupHomeRoute ||
      (
        pathname.startsWith(
          "/admin/groups",
        ) &&
        searchParams.get(
          "view",
        ) ===
          "commissioner"
      );


    /*
     * Group Settings is Group-scoped, not sport-page-scoped.
     *
     * If the newly active Group does not offer the previously
     * selected sport, update the nav's selected sport but remain
     * on Group Settings instead of redirecting to that sport's Home.
     */
    if (
      isGroupNeutralDestination
    ) {
      return;
    }


    router.replace(
      getSportDestination(
        fallbackSport,
      ),
    );
  }, [
    groupContext,
    displayedSports,
    selectedSport,
    setSelectedSport,
    router,
    pathname,
    searchParams,
    isGroupHomeRoute,
  ]);

  /*
   * The route may synchronize the selected sport only when that
   * sport is actually enabled in the active Group.
   *
   * Without this guard:
   *   Group A / Golf
   *     -> switch to Group B without Golf
   *     -> fallback sets NBA
   *     -> stale ?sport=golf sets Golf again
   *     -> infinite state loop.
   */
  useEffect(() => {
    /*
     * Notification administration is a shared cross-sport route.
     *
     * Its ?sport= value must be authoritative even for dedicated
     * game keys such as NCAA Pick 'Em and NBA Skins. The general
     * routeSport resolver is designed primarily around game-page
     * routes and can otherwise leave the previous fantasy sport
     * mounted after the URL has already changed.
     */
    const notificationRouteSport =
      pathname.startsWith(
        "/admin/notification",
      )
        ? searchParams.get(
            "sport",
          )
        : null;

    const effectiveRouteSport =
      notificationRouteSport ??
      routeSport;

    const routeSportIsEnabled =
      effectiveRouteSport
        ? displayedSports.some(
            (sport) =>
              sport.key ===
              effectiveRouteSport,
          )
        : false;

    if (
      effectiveRouteSport &&
      routeSportIsEnabled &&
      effectiveRouteSport !==
        selectedSport
    ) {
      setSelectedSport(
        effectiveRouteSport,
      );
    }
  }, [
    pathname,
    searchParams,
    routeSport,
    displayedSports,
    selectedSport,
    setSelectedSport,
  ]);


  const displayedMainLinks = isNbaSkins
    ? [
        {
          href: "/nba-skins",
          label: "Home",
          icon: "⌂",
        },
        {
          href: "/nba-skins/draft",
          label: "Draft",
          icon: "✎",
        },
        {
          href: "/nba-skins/standings",
          label: "Standings",
          icon: "▦",
        },
      ]
    : isNcaaPickEm
      ? [
          {
            href: "/ncaa-pickem",
            label: "Home",
            icon: "⌂",
          },
          {
            href: "/ncaa-pickem/standings",
            label: "Standings",
            icon: "▦",
          },
        ]
      : mainLinks;

  const sportScopedPaths = [
    "/home",
    "/profile",
    "/standings",
    "/player-history",
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

  function getLinkHref(href: string) {
    const basePath = href.split("?")[0];

    if (sportScopedPaths.includes(basePath)) {
      return appendSportParam(href, selectedSport);
    }

    return href;
  }

  type SportSection =
    | "home"
    | "profile"
    | "standings"
    | "draft"
    | "scores"
    | "player-history"
    | "other";


  function getCurrentSportSection():
    SportSection {
    if (
      pathname === "/home" ||
      pathname === "/nba-skins" ||
      pathname === "/ncaa-pickem"
    ) {
      return "home";
    }

    if (
      pathname.startsWith(
        "/profile",
      ) ||
      pathname.startsWith(
        "/nba-skins/profile",
      )
    ) {
      return "profile";
    }

    if (
      pathname === "/standings" ||
      pathname.startsWith(
        "/nba-skins/standings",
      ) ||
      pathname.startsWith(
        "/ncaa-pickem/standings",
      )
    ) {
      return "standings";
    }

    if (
      pathname ===
        "/lineups/draft" ||
      pathname.startsWith(
        "/nba-skins/draft",
      )
    ) {
      return "draft";
    }

    if (
      pathname ===
      "/lineups/scores"
    ) {
      return "scores";
    }

    if (
      pathname.startsWith(
        "/player-history",
      )
    ) {
      return "player-history";
    }

    return "other";
  }


  function getSportDestination(
    sportKey: string,
  ) {
    const section =
      getCurrentSportSection();

    /*
     * Preserve the current Profile tab for the shared profile
     * page. NBA Skins combines its Profile/Trophies surface.
     */
    const profileTab =
      activeProfileTab ??
      "overview";


    if (
      sportKey ===
      "nba-skins"
    ) {
      if (
        section ===
        "profile"
      ) {
        return "/nba-skins/profile";
      }

      if (
        section ===
        "standings"
      ) {
        return "/nba-skins/standings";
      }

      if (
        section ===
        "draft"
      ) {
        return "/nba-skins/draft";
      }

      return "/nba-skins";
    }


    if (
      sportKey ===
      "ncaa"
    ) {
      if (
        section ===
        "profile"
      ) {
        return appendSportParam(
          `/profile?tab=${profileTab}`,
          "ncaa",
        );
      }

      if (
        section ===
        "standings"
      ) {
        return "/ncaa-pickem/standings";
      }

      return "/ncaa-pickem";
    }


    if (
      section ===
      "profile"
    ) {
      return appendSportParam(
        `/profile?tab=${profileTab}`,
        sportKey,
      );
    }

    if (
      section ===
      "standings"
    ) {
      return appendSportParam(
        "/standings",
        sportKey,
      );
    }

    if (
      section ===
      "draft"
    ) {
      return appendSportParam(
        "/lineups/draft",
        sportKey,
      );
    }

    if (
      section ===
      "scores"
    ) {
      return appendSportParam(
        "/lineups/scores",
        sportKey,
      );
    }

    if (
      section ===
      "player-history"
    ) {
      return appendSportParam(
        "/player-history",
        sportKey,
      );
    }

    return appendSportParam(
      "/home",
      sportKey,
    );
  }


  function handleSelectSport(
    sportKey: string,
  ) {
    const isNotificationAdminRoute =
      pathname.startsWith(
        "/admin/notification",
      );

    const destination =
      isNotificationAdminRoute
        ? appendSportParam(
            pathname,
            sportKey,
          )
        : getSportDestination(
            sportKey,
          );

    const currentSection =
      getCurrentSportSection();

    /*
     * NBA Skins and NCAA Pick 'Em do not support every shared
     * fantasy section (for example Player History or Scores).
     *
     * When the destination is their fallback Home page, navigate
     * first and let routeSport synchronize selectedSport after the
     * route changes. Updating selectedSport while the unsupported
     * old page is still mounted can make that page briefly request
     * data for a sport it cannot render.
     */
    const usesDedicatedFallback =
      (
        sportKey ===
          "nba-skins" &&
        destination ===
          "/nba-skins" &&
        currentSection !==
          "home"
      ) ||
      (
        sportKey ===
          "ncaa" &&
        destination ===
          "/ncaa-pickem" &&
        currentSection !==
          "home"
      );

    if (
      usesDedicatedFallback ||
      isNotificationAdminRoute
    ) {
      /*
       * Navigate first and let routeSport synchronize selectedSport.
       *
       * Notification admin pages preserve their route across sports,
       * so updating selectedSport before the URL changes can race with
       * the still-stale ?sport= value and immediately switch back.
       */
      router.push(
        destination,
      );

      return;
    }

    setSelectedSport(
      sportKey,
    );

    router.push(
      destination,
    );
  }

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

      if (
        desktopGroupRef.current &&
        !desktopGroupRef.current.contains(
          target,
        )
      ) {
        setDesktopGroupOpen(
          false,
        );
      }

      if (desktopSportRef.current && !desktopSportRef.current.contains(target)) {
        setDesktopSportOpen(false);
      }

      if (mobileSportRef.current && !mobileSportRef.current.contains(target)) {
        setMobileSportOpen(false);
      }

      if (
        mobileGroupRef.current &&
        !mobileGroupRef.current.contains(target)
      ) {
        setMobileGroupOpen(false);
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
    if (
      href === "/home" ||
      href === "/nba-skins" ||
      href === "/ncaa-pickem"
    ) {
      return pathname === href;
    }

    /*
     * Commissioner administration and platform administration
     * currently share the /admin route tree, but they are
     * separate navigation scopes.
     *
     * Groups & Access belongs to the Super Admin surface even
     * though its legacy route remains /admin/groups.
     */
    const isCommissionerGroupSettings =
      pathname.startsWith(
        "/admin/groups",
      ) &&
      searchParams.get(
        "view",
      ) ===
        "commissioner";


    const isPlatformAdminPath =
      pathname.startsWith(
        "/admin/platform",
      ) ||
      (
        pathname.startsWith(
          "/admin/groups",
        ) &&
        !isCommissionerGroupSettings
      );

    if (
      href ===
        "/admin/groups?view=commissioner"
    ) {
      return (
        isCommissionerGroupSettings
      );
    }


    if (
      href === "/admin"
    ) {
      return (
        (
          pathname === "/admin" ||
          pathname.startsWith(
            "/admin/",
          )
        ) &&
        !isPlatformAdminPath &&
        !isCommissionerGroupSettings
      );
    }

    if (
      href === "/admin/platform"
    ) {
      return isPlatformAdminPath;
    }

    return (
      pathname === href ||
      pathname.startsWith(
        `${href}/`,
      )
    );
  }

  function desktopLinkClass(href: string) {
    const active = isLinkActive(href);

    return `app-desktop-link rounded-full border px-4 py-2 text-sm font-medium ${
      active
        ? "app-desktop-link-active border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
        : "app-desktop-link-idle border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
    }`;
  }

  function mobileLinkClass(href: string) {
    const active = isLinkActive(href);

    return `app-mobile-nav-item flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-0.5 text-xs font-medium transition ${
      active
        ? "app-mobile-nav-active bg-slate-800 text-sky-300 ring-1 ring-sky-500/20"
        : "app-mobile-nav-idle text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
    }`;
  }

  const mobileMoreLinks = [
    { href: "/standings", label: "Standings" },
    { href: "/player-history", label: "Player History" },
  ];

  const mobileGroupControl = groupContext ? (
    displayedGroups.length > 1 ? (
      <div
        ref={mobileGroupRef}
        className="relative min-w-0 max-w-[8.5rem]"
      >
        <button
          type="button"
          disabled={isSwitchingGroup}
          onClick={() => setMobileGroupOpen((open) => !open)}
          aria-expanded={mobileGroupOpen}
          aria-haspopup="menu"
          aria-label={`Active Group: ${groupContext.group.name}`}
          className="flex min-h-9 max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-60"
        >
          <span className="truncate">{groupContext.group.name}</span>
          <span aria-hidden="true" className="shrink-0 text-[9px]">
            ▾
          </span>
        </button>

        {mobileGroupOpen ? (
          <div
            role="menu"
            className="app-dropdown-panel absolute right-0 top-full z-[10000] mt-2 min-w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          >
            {displayedGroups.map((group) => {
              const isActive = group.slug === groupContext.group.slug;

              return (
                <button
                  key={group.id}
                  type="button"
                  role="menuitem"
                  disabled={isSwitchingGroup}
                  onClick={() => {
                    setMobileGroupOpen(false);

                    if (isActive) {
                      router.push(`/groups/${encodeURIComponent(group.slug)}`);
                    } else {
                      void setActiveGroup(group.slug);
                    }
                  }}
                  className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                    isActive
                      ? "bg-sky-100 font-semibold text-sky-900"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {group.name}
                  {isActive ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide">
                      Active
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    ) : (
      <Link
        href={`/groups/${encodeURIComponent(groupContext.group.slug)}`}
        className="block min-h-9 max-w-[8.5rem] truncate rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase leading-6 tracking-wide text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
      >
        {groupContext.group.name}
      </Link>
    )
  ) : null;

  return (
    <>
      <style jsx global>{`
        html[data-mobile-more-open="true"]
          [data-floating-compare="true"] {
          display: none !important;
        }

        .app-mobile-bottom-nav .app-mobile-nav-active {
          background: rgba(30, 41, 59, 0.96) !important;
          color: rgb(125, 211, 252) !important;
          box-shadow:
            inset 0 0 0 1px rgba(56, 189, 248, 0.22) !important;
        }

        .app-mobile-bottom-nav .app-mobile-nav-active::after {
          background: rgb(56, 189, 248) !important;
        }
      `}</style>

      {/* Desktop nav only */}
      <nav className="app-desktop-nav mb-6 hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:block">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              aria-label="111 Sports platform home"
              className="mr-1 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-950"
            >
              <img src="/logos/logo_all_sports.png" alt="" className="h-8 w-8 rounded-full object-cover" />
            </Link>
            {!isGroupHomeRoute ? displayedMainLinks.map((link) => (
              <Link
                key={link.href}
                href={
                  isNcaaPickEm || isNbaSkins
                    ? link.href
                    : getLinkHref(link.href)
                }
                className={desktopLinkClass(link.href)}
              >
                {link.label}
              </Link>
            )) : null}

            {!isGroupHomeRoute && !isNcaaPickEm && !isNbaSkins ? (
              <>
                <Link
                  href={getLinkHref(
                    "/standings",
                  )}
                  className={desktopLinkClass("/standings")}
                >
                  Standings
                </Link>

                <Link
                  href={getLinkHref(
                    "/player-history",
                  )}
                  className={desktopLinkClass("/player-history")}
                >
                  Player History
                </Link>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
          {groupContext ? (
            <div
              className="relative"
              ref={desktopGroupRef}
            >
              <button
                type="button"
                disabled={isSwitchingGroup}
                onClick={() =>
                  setDesktopGroupOpen(
                    (open) =>
                      !open,
                  )
                }
                aria-expanded={
                  desktopGroupOpen
                }
                aria-haspopup="menu"
                aria-label={`Active Group: ${groupContext.group.name}`}
                title="Switch Group"
                className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500 disabled:opacity-60"
              >
                <span>
                  {groupContext.group.name}
                </span>

                <span
                  aria-hidden="true"
                  className="text-xs text-slate-300"
                >
                  ▾
                </span>
              </button>

              {desktopGroupOpen ? (
                <div
                  role="menu"
                  className="app-dropdown-panel absolute right-0 top-full z-50 mt-2 min-w-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg"
                >
                  {displayedGroups.map(
                    (group) => {
                      const isActive =
                        group.slug ===
                        groupContext
                          .group
                          .slug;

                      return (
                        <button
                          key={
                            group.id
                          }
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setDesktopGroupOpen(
                              false,
                            );

                            if (isActive) {
                              router.push(`/groups/${encodeURIComponent(group.slug)}`);
                            } else {
                              void setActiveGroup(
                                group.slug,
                              );
                            }
                          }}
                          className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                            isActive
                              ? "bg-sky-100 font-semibold text-sky-900"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {group.name}
                        </button>
                      );
                    },
                  )}
                </div>
              ) : null}
            </div>
          ) : isGroupLoading ? (
            <div className="h-9 w-16 animate-pulse rounded-full bg-slate-800" />
          ) : null}

          {!isGroupHomeRoute ? (
          <div className="relative" ref={desktopSportRef}>
            <button
              type="button"
              onClick={() => setDesktopSportOpen((open) => !open)}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-300"
            >
              <span aria-hidden="true">{getSportConfig(activeSport).emoji}</span>
              <span>{getSportConfig(activeSport).label}</span>
              <span aria-hidden="true">▾</span>
            </button>

            {desktopSportOpen ? (
              <div className="app-dropdown-panel absolute left-0 top-full z-50 mt-2 w-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                {displayedSports.map((sport) => (
                  <button
                    key={sport.key}
                    type="button"
                    onClick={() => {
                      handleSelectSport(sport.key);
                      setDesktopSportOpen(false);
                    }}
                    className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                      activeSport === sport.key
                        ? "bg-sky-100 font-semibold text-sky-900"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {sport.emoji} {sport.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}

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
                  <div className="app-dropdown-panel absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
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

                    <div className="my-2 border-t border-slate-200" />

              <DarkModeToggle />

              {isAdmin ? (
                      <>
                        <div className="my-2 border-t border-slate-200" />

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
                                href={getLinkHref(link.href)}
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

                    <div className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Account
                    </div>

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
        </div>
      </nav>

      {/* Global mobile account header */}
      <nav className="app-mobile-header mb-6 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:hidden">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {isGroupHomeRoute ? (
              <Link
                href="/"
                aria-label="111 Sports platform home"
                className="block h-12 w-12 shrink-0 rounded-full bg-slate-950"
              >
                <img
                  src="/logos/logo_all_sports.png"
                  alt=""
                  className="h-12 w-12 rounded-full object-cover shadow-sm"
                />
              </Link>
            ) : (
              <div className="relative shrink-0" ref={mobileSportRef}>
                <button
                  type="button"
                  onClick={() => setMobileSportOpen((open) => !open)}
                  aria-label={`Switch sport, currently ${getSportConfig(activeSport).label}`}
                  aria-expanded={mobileSportOpen}
                  aria-haspopup="menu"
                  className="block"
                >
                  <span className="relative block h-12 w-12">
                    <img
                      src={getSportConfig(activeSport).logo}
                      alt={`${getSportConfig(activeSport).label} logo`}
                      className="h-12 w-12 rounded-full object-cover shadow-sm"
                    />
                    {activeSport === "ncaa" || activeSport === "nba-skins" ? (
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-1 -right-1 rounded-full border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[8px] font-black tracking-wide text-white shadow-md"
                      >
                        {activeSport === "nba-skins" ? "SKINS" : "NCAA"}
                      </span>
                    ) : null}
                  </span>
                </button>

                {mobileSportOpen ? (
                  <div className="app-dropdown-panel absolute left-0 top-full z-50 mt-2 w-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                    {displayedSports.map((sport) => (
                      <button
                        key={sport.key}
                        type="button"
                        onClick={() => {
                          handleSelectSport(sport.key);
                          setMobileSportOpen(false);
                        }}
                        className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                          activeSport === sport.key
                            ? "bg-sky-100 font-semibold text-sky-900"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {sport.emoji} {sport.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            <div className="min-w-0">
              <Link href="/" aria-label="111 Sports platform home" className="block min-w-0">
                <span className="block truncate text-lg font-bold tracking-tight text-slate-900">
                  111 Sports
                </span>
              </Link>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            {mobileGroupControl}
            <MobileAccountMenu />
          </div>
        </div>
      </nav>

      {/* White shield behind mobile nav */}
      {!isGroupHomeRoute ? (
      <div
        className="app-mobile-nav-shield pointer-events-none fixed bottom-[-52px] left-0 right-0 z-[9998] h-28 bg-white sm:hidden"
        aria-hidden="true"
      />
      ) : null}

      {/* Mobile bottom nav only */}
      {!isGroupHomeRoute ? (
      <div
        ref={mobileMoreRef}
        className="app-mobile-bottom-nav fixed bottom-[-42px] left-0 right-0 z-[9999] border-t border-slate-200 bg-white px-3 pb-[42px] pt-1 shadow-[0_-6px_16px_rgba(15,23,42,0.10)] sm:hidden"
      >
        {!isNcaaPickEm && !isNbaSkins && mobileMoreOpen ? (
          <div className="app-dropdown-panel absolute bottom-full right-3 mb-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {mobileMoreLinks.map((link) => (
              <Link
                key={link.href}
                href={getLinkHref(
                  link.href,
                )}
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

        <div
          className={`mx-auto grid max-w-xl gap-1 ${
            isNcaaPickEm
              ? "grid-cols-2"
              : isNbaSkins
                ? "grid-cols-3"
                : "grid-cols-4"
          }`}
        >
          {displayedMainLinks.map((link) => (
            <Link
              key={link.href}
              href={
                isNcaaPickEm || isNbaSkins
                  ? link.href
                  : getLinkHref(link.href)
              }
              className={mobileLinkClass(link.href)}
            >
              <span className="text-lg leading-none">{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}

          {!isNcaaPickEm && !isNbaSkins ? (
            <button
              type="button"
              onClick={() => setMobileMoreOpen((open) => !open)}
              className={`app-mobile-nav-item flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-0.5 text-xs font-medium transition ${
                moreIsActive
                  ? "app-mobile-nav-active bg-slate-800 text-sky-300 ring-1 ring-sky-500/20"
                  : "app-mobile-nav-idle text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
              }`}
            >
              <span className="text-lg leading-none">⋯</span>
              <span>More</span>
            </button>
          ) : null}
        </div>
      </div>
      ) : null}
    </>
  );
}


export default function AppNav() {
  return (
    <Suspense
      fallback={
        <nav className="app-desktop-nav mb-6 hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:block">
          <div className="h-10" />
        </nav>
      }
    >
      <AppNavContent />
    </Suspense>
  );
}
