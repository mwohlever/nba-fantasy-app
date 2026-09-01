export type GroupNavigationSport =
  | "nba"
  | "nfl"
  | "golf"
  | "ncaa"
  | "nba-skins";


type GroupSwitchDestinationInput = {
  pathname: string;
  search?: string;
  targetGroupSlug: string;
  enabledSports: Iterable<string>;
  canAdministerGroup: boolean;
  isSuperAdmin?: boolean;
};


const SHARED_FANTASY_PATHS = new Set([
  "/home",
  "/standings",
  "/player-history",
  "/lineups/draft",
  "/lineups/scores",
]);


const SHARED_PROFILE_PATHS = new Set([
  "/profile",
]);


const SPORT_SCOPED_COMMISSIONER_PATHS = new Set([
  "/slates/new",
  "/admin/slates",
  "/admin/corrections",
  "/admin/league-awards",
]);


const RESOURCE_QUERY_KEYS = [
  "slateId",
  "teamId",
  "playerId",
  "weekId",
  "leagueId",
  "groupId",
  "gameId",
  "eventId",
];


function groupHome(
  slug: string,
) {
  return `/groups/${encodeURIComponent(slug)}`;
}


function destinationWithSearch(
  pathname: string,
  search: string,
) {
  if (!search) {
    return pathname;
  }

  return `${pathname}${search.startsWith("?") ? search : `?${search}`}`;
}


function isEnabled(
  sport: string | null,
  enabledSports: Set<string>,
): sport is GroupNavigationSport {
  return Boolean(
    sport &&
      enabledSports.has(
        sport,
      ),
  );
}


function hasGroupSpecificResource(
  searchParams: URLSearchParams,
) {
  return RESOURCE_QUERY_KEYS.some(
    (key) =>
      searchParams.has(
        key,
      ),
  );
}


/**
 * Resolve the one safe destination for a Group switch.
 *
 * Routes are preserved only when they have an explicit, reusable
 * Group-scoped meaning. Unknown routes and URLs carrying resource IDs
 * fall back to the target Group Home so identifiers cannot leak across
 * Groups.
 */
export function getGroupSwitchDestination({
  pathname,
  search = "",
  targetGroupSlug,
  enabledSports,
  canAdministerGroup,
  isSuperAdmin = false,
}: GroupSwitchDestinationInput) {
  const fallback =
    groupHome(
      targetGroupSlug,
    );

  const normalizedPathname =
    pathname !== "/" && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  const normalizedSearch =
    search && !search.startsWith("?")
      ? `?${search}`
      : search;

  const searchParams =
    new URLSearchParams(
      normalizedSearch,
    );

  const targetEnabledSports =
    new Set(
      enabledSports,
    );

  if (
    hasGroupSpecificResource(
      searchParams,
    )
  ) {
    return fallback;
  }

  if (
    normalizedPathname === "/groups" ||
    normalizedPathname.startsWith("/groups/")
  ) {
    return fallback;
  }

  const currentDestination =
    destinationWithSearch(
      normalizedPathname,
      normalizedSearch,
    );

  if (
    normalizedPathname === "/ncaa-pickem" ||
    normalizedPathname === "/ncaa-pickem/standings"
  ) {
    return isEnabled(
      "ncaa",
      targetEnabledSports,
    )
      ? currentDestination
      : fallback;
  }

  if (
    normalizedPathname === "/nba-skins" ||
    normalizedPathname === "/nba-skins/draft" ||
    normalizedPathname === "/nba-skins/profile" ||
    normalizedPathname === "/nba-skins/standings"
  ) {
    return isEnabled(
      "nba-skins",
      targetEnabledSports,
    )
      ? currentDestination
      : fallback;
  }

  const sport =
    searchParams.get(
      "sport",
    );

  if (
    SHARED_FANTASY_PATHS.has(
      normalizedPathname,
    )
  ) {
    const isSharedFantasySport =
      sport === "nba" ||
      sport === "nfl" ||
      sport === "golf";

    return isSharedFantasySport &&
      isEnabled(
        sport,
        targetEnabledSports,
      )
      ? currentDestination
      : fallback;
  }

  if (
    SHARED_PROFILE_PATHS.has(
      normalizedPathname,
    )
  ) {
    return isEnabled(
      sport,
      targetEnabledSports,
    )
      ? currentDestination
      : fallback;
  }

  if (
    normalizedPathname === "/admin/ncaa-pickem"
  ) {
    return canAdministerGroup &&
      isEnabled(
        "ncaa",
        targetEnabledSports,
      )
      ? currentDestination
      : fallback;
  }

  if (
    normalizedPathname === "/admin/nba-skins"
  ) {
    return canAdministerGroup &&
      isEnabled(
        "nba-skins",
        targetEnabledSports,
      )
      ? currentDestination
      : fallback;
  }

  if (
    normalizedPathname === "/admin/notification-templates" ||
    normalizedPathname === "/admin/notification-history"
  ) {
    return canAdministerGroup &&
      isEnabled(
        sport,
        targetEnabledSports,
      )
      ? currentDestination
      : fallback;
  }

  if (
    SPORT_SCOPED_COMMISSIONER_PATHS.has(
      normalizedPathname,
    )
  ) {
    const isFantasySport =
      sport === "nba" ||
      sport === "nfl" ||
      sport === "golf";

    return canAdministerGroup &&
      isFantasySport &&
      isEnabled(
        sport,
        targetEnabledSports,
      )
      ? currentDestination
      : fallback;
  }

  const fixedCommissionerSport =
    normalizedPathname === "/admin/slate-games" ||
    normalizedPathname === "/admin/players"
      ? "nba"
      : normalizedPathname === "/admin/players-nfl"
        ? "nfl"
        : null;

  if (fixedCommissionerSport) {
    return canAdministerGroup &&
      isEnabled(
        fixedCommissionerSport,
        targetEnabledSports,
      )
      ? currentDestination
      : fallback;
  }

  if (
    normalizedPathname === "/admin" ||
    (
      normalizedPathname === "/admin/groups" &&
      searchParams.get("view") === "commissioner"
    )
  ) {
    return canAdministerGroup
      ? currentDestination
      : fallback;
  }

  if (
    normalizedPathname === "/admin/platform"
  ) {
    return isSuperAdmin
      ? currentDestination
      : fallback;
  }

  return fallback;
}
