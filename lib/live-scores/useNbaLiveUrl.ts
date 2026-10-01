"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { easternToday, nbaDateKey } from "./nbaDate";
import type { NbaLiveContext } from "./nbaContext";
import { liveBackMatches, nbaLiveHref, parseNbaLiveState, type GameCenterTab, type LiveOverviewEntry } from "./urlState";

const markerKey = "sports111LiveOverview";
/** Native history updates are supported by Next and synchronize useSearchParams.
 * Keep only our own marker; Next copies its internal router fields itself. */
function replace(href: string) {
  window.history.replaceState({ [markerKey]: window.history.state?.[markerKey] ?? null }, "", href);
}
export function useNbaLiveUrl(context: NbaLiveContext, scope: string) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [today] = useState(easternToday);
  const state = parseNbaLiveState(context, search, today);
  const routeMatches = context === "nba-skins" ? pathname === "/nba-skins/live"
    : pathname === "/live-scores" && new URLSearchParams(search).get("sport") === "nba";
  const overview = nbaLiveHref({ sport: "nba", context, view: "games", date: state.date ?? today });
  const canonical = nbaLiveHref(state);
  useEffect(() => {
    if (routeMatches && canonical !== `${pathname}${search ? `?${search}` : ""}`) replace(canonical);
  }, [routeMatches, canonical, pathname, search]);
  function openGame(gameId: string) {
    if (!routeMatches || state.view !== "games") return;
    const entry: LiveOverviewEntry = { overview, gameId, scope };
    window.history.pushState({ [markerKey]: entry }, "", nbaLiveHref({ ...state, view: "detail", gameId, tab: "summary" }));
    window.scrollTo?.({ top: 0 });
  }
  function backToGames() {
    const entry = window.history.state?.[markerKey] as LiveOverviewEntry | undefined;
    if (state.view === "detail" && liveBackMatches(entry, overview, state.gameId, scope)) window.history.back();
    else window.history.replaceState(null, "", overview);
    window.scrollTo?.({ top: 0 });
  }
  function selectDate(date: string) {
    if (!routeMatches || state.view !== "games" || !nbaDateKey(date)) return;
    const next = parseNbaLiveState(context, new URLSearchParams({ date }).toString(), today);
    window.history.pushState(null, "", nbaLiveHref(next));
  }
  function selectTab(tab: GameCenterTab) {
    if (routeMatches && state.view === "detail") replace(nbaLiveHref({ ...state, tab }));
  }
  function resolveEventDate(date: string) {
    if (routeMatches && state.view === "detail" && !state.date) replace(nbaLiveHref({ ...state, date }));
  }
  return { state, routeMatches, openGame, backToGames, selectDate, selectTab, resolveEventDate };
}
