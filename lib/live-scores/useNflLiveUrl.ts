"use client";
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { backToLiveGames, pushLiveGame, replaceLiveHref } from "./history";
import { nflLiveHref, parseNflLiveState, type NflCalendarContext, type GameCenterTab, type NflStandingsView } from "./urlState";

export function useNflLiveUrl(scope: string) {
  const pathname = usePathname(), search = useSearchParams().toString();
  const state = parseNflLiveState(search);
  // Calendar resolution and content defaults can run in the same commit.
  // Merge each correction with the last URL write, rather than an older render.
  const current = useRef(state); current.current = state;
  function replaceState(next: typeof state) {
    if (nflLiveHref(next) === nflLiveHref(current.current)) return;
    current.current = next;
    replaceLiveHref(nflLiveHref(next));
  }
  const sport = new URLSearchParams(search).get("sport");
  const routeMatches = pathname === "/live-scores" && (sport === "nfl" || !sport);
  const canonical = nflLiveHref(state);
  const overview = nflLiveHref({ sport: "nfl", context: "nfl", view: "games", calendar: state.calendar });
  useEffect(() => {
    if (routeMatches && canonical === nflLiveHref(current.current) && canonical !== `${pathname}${search ? `?${search}` : ""}`) replaceLiveHref(canonical);
  }, [routeMatches, canonical, pathname, search]);

  function openGame(gameId: string) {
    if (!routeMatches || state.view !== "games" || !state.calendar) return;
    pushLiveGame(nflLiveHref({ ...state, view: "detail", gameId, tab: "summary", period: null, statsTeam: null }), { overview, gameId, scope });
  }
  function backToGames() {
    backToLiveGames(overview, state.view === "detail" ? state.gameId : "", scope);
  }
  function selectCalendar(calendar: NflCalendarContext) {
    if (!routeMatches || state.view !== "games") return;
    window.history.pushState(null, "", nflLiveHref({ ...state, calendar }));
  }
  function resolveCalendar(calendar: NflCalendarContext) {
    if (routeMatches && !current.current.calendar) replaceState({ ...current.current, calendar });
  }
  function selectDetail(change: { tab?: GameCenterTab; period?: number | null; statsTeam?: string }) {
    if (routeMatches && state.view === "detail" && current.current.view === "detail" && current.current.gameId === state.gameId) replaceState({ ...current.current, ...change });
  }
  function selectView(view: "games" | "standings") {
    if (!routeMatches || state.view === "detail" || state.view === view) return;
    const next = view === "games" ? overview : nflLiveHref({ sport: "nfl", context: "nfl", calendar: state.calendar, view: "standings", standingsView: "afc" });
    window.history.pushState(null, "", next);
    window.scrollTo?.({ top: 0 });
  }
  function selectStandings(standingsView: NflStandingsView) {
    if (routeMatches && state.view === "standings") replaceState({ ...state, standingsView });
  }
  return { state, routeMatches, openGame, backToGames, selectCalendar, resolveCalendar, selectDetail, selectView, selectStandings };
}
