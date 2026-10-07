"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { backToLiveGames, pushLiveGame, replaceLiveHref } from "./history";
import { ncaaLiveOverviewHref, parseNcaaLiveOverview, type NcaaCalendar, type NcaaStandingsSelection } from "./ncaaUrlState";
import type { GameCenterTab } from "./urlState";

// Merge same-commit corrections with the latest URL, including child quarter effects.
function currentNcaaState() { return parseNcaaLiveOverview(window.location.search); }

export function useNcaaLiveUrl(scope = "ncaa") {
  const pathname = usePathname(), search = useSearchParams().toString();
  const state = parseNcaaLiveOverview(search);
  const routeMatches = pathname === "/ncaa-pickem/scores";
  const canonical = ncaaLiveOverviewHref(state);
  const overview = ncaaLiveOverviewHref({ view: "games", calendar: state.calendar });
  function replaceState(next: typeof state) {
    if (ncaaLiveOverviewHref(next) === ncaaLiveOverviewHref(currentNcaaState())) return;
    replaceLiveHref(ncaaLiveOverviewHref(next));
  }
  useEffect(() => {
    if (routeMatches && canonical === ncaaLiveOverviewHref(currentNcaaState()) && canonical !== `${pathname}${search ? `?${search}` : ""}`) replaceLiveHref(canonical);
  }, [routeMatches, canonical, pathname, search]);
  function selectView(view: "games" | "standings", calendar: NcaaCalendar | null) {
    if (!routeMatches || state.view === view) return;
    window.history.pushState(null, "", ncaaLiveOverviewHref(view === "games" ? { view, calendar } : { view, calendar, selection: "top25" }));
    window.scrollTo?.({ top: 0 });
  }
  function selectStandings(selection: NcaaStandingsSelection) {
    if (routeMatches && state.view === "standings" && selection !== state.selection) replaceState({ ...currentNcaaState(), view: "standings", selection });
  }
  function selectCalendar(calendar: NcaaCalendar) {
    if (routeMatches) window.history.pushState(null, "", ncaaLiveOverviewHref({ view: "games", calendar }));
  }
  function resolveCalendar(calendar: NcaaCalendar) {
    const latest = currentNcaaState();
    if (routeMatches && !latest.calendar) replaceState({ ...latest, calendar });
  }
  function openGame(gameId: string) {
    if (!routeMatches || state.view !== "games" || !state.calendar) return;
    pushLiveGame(ncaaLiveOverviewHref({ ...state, view: "detail", gameId, tab: "summary", period: null, statsTeam: null }), { overview, gameId, scope });
  }
  function backToGames() {
    backToLiveGames(overview, state.view === "detail" ? state.gameId : "", scope);
  }
  function clearDetail() {
    const latest = currentNcaaState();
    if (routeMatches && state.view === "detail" && latest.view === "detail" && latest.gameId === state.gameId
      && latest.calendar?.season === state.calendar?.season && latest.calendar?.week === state.calendar?.week) {
      replaceState({ view: "games", calendar: latest.calendar });
    }
  }
  function selectDetail(change: { tab?: GameCenterTab; period?: number | null; statsTeam?: string }) {
    const latest = currentNcaaState();
    if (routeMatches && state.view === "detail" && latest.view === "detail" && latest.gameId === state.gameId) replaceState({ ...latest, ...change });
  }
  return { state, routeMatches, selectView, selectStandings, selectCalendar, resolveCalendar, openGame, backToGames, clearDetail, selectDetail };
}
