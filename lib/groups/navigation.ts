import { golfLiveHref } from "../golf/liveTournament";
import { nbaLiveHref, parseNbaLiveState, nflLiveHref, parseNflLiveState } from "../live-scores/urlState";
import { sharesViewingContext } from "../viewing-context/context";
import { ncaaLiveOverviewHref, parseNcaaLiveOverview } from "../live-scores/ncaaUrlState";

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
 * Group-scoped meaning. Shared viewing IDs are cleared before resolving
 * the destination. Other resource IDs and unknown routes fall back to the target Group Home so identifiers cannot leak across
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

  // NBA ESPN events/dates are public provider context, not Group resource IDs.
  // Whitelist the Live namespace, discarding slate/team/season/Group identifiers.
  const nbaContext = normalizedPathname === "/nba-skins/live" ? "nba-skins"
    : normalizedPathname === "/live-scores" && searchParams.get("sport") === "nba" ? "nba" : null;
  if (nbaContext) {
    if (!isEnabled(nbaContext, targetEnabledSports)) return fallback;
    // Explicit old Group/league IDs are never transferred to another Group.
    if (searchParams.has("groupId") || searchParams.has("leagueId")) return fallback;
    return nbaLiveHref(parseNbaLiveState(nbaContext, normalizedSearch));
  }

  // Golf ESPN event identity is public; ownership is re-resolved in the new Group.
  if (normalizedPathname === "/golf/live") {
    if (!isEnabled("golf", targetEnabledSports) || searchParams.has("groupId") || searchParams.has("leagueId")) return fallback;
    if (!searchParams.has("eventId") && hasGroupSpecificResource(searchParams)) return fallback;
    return golfLiveHref(searchParams.get("eventId"));
  }

  // NFL events and weekly calendars are public Live context as well.
  if (normalizedPathname === "/live-scores" && (searchParams.get("sport") === "nfl" || !searchParams.has("sport"))) {
    if (!isEnabled("nfl", targetEnabledSports)) return fallback;
    if (searchParams.has("groupId") || searchParams.has("leagueId") || searchParams.has("eventId")) return fallback;
    return nflLiveHref(parseNflLiveState(normalizedSearch));
  }

  let destinationSearch = normalizedSearch;
  // NCAA detail is public provider context; scoped requests are reloaded after switching.
  if (normalizedPathname === "/ncaa-pickem/scores" && (searchParams.get("view") === "standings" || searchParams.has("gameId"))) {
    if (!isEnabled("ncaa", targetEnabledSports) || searchParams.has("groupId") || searchParams.has("leagueId") || searchParams.has("eventId")) return fallback;
    return ncaaLiveOverviewHref(parseNcaaLiveOverview(normalizedSearch));
  }
  const viewingGame = normalizedPathname.startsWith("/nba-skins") ? "nba-skins" : searchParams.get("sport");
  if (viewingGame && sharesViewingContext(normalizedPathname, viewingGame) &&
      (searchParams.has("slateId") || searchParams.has("season"))) {
    searchParams.delete("slateId");
    searchParams.delete("season");
    destinationSearch = searchParams.toString();
  }

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
      destinationSearch,
    );

  if (
    normalizedPathname === "/ncaa-pickem" ||
    normalizedPathname === "/ncaa-pickem/standings" ||
    normalizedPathname === "/ncaa-pickem/scores"
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
    normalizedPathname === "/nba-skins/live" ||
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

  if (normalizedPathname === "/live-scores") {
    return sport === "nfl" && isEnabled("nfl", targetEnabledSports) ? currentDestination : fallback;
  }

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
export function shouldFallbackSportSelection(input: {
  selectedSport: string;
  routeSport: string | null;
  enabledSports: readonly string[];
}) {
  if (!input.enabledSports.length) return false;
  if (input.routeSport && input.enabledSports.includes(input.routeSport)) return false;
  return !input.enabledSports.includes(input.selectedSport);
}
