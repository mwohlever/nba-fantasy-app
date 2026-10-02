"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ncaaLiveOverviewHref, parseNcaaLiveOverview, type NcaaCalendar, type NcaaStandingsSelection } from "./ncaaUrlState";

export function useNcaaLiveUrl() {
  const pathname = usePathname(), search = useSearchParams().toString();
  const state = parseNcaaLiveOverview(search);
  const routeMatches = pathname === "/ncaa-pickem/scores";
  const canonical = ncaaLiveOverviewHref(state);
  useEffect(() => {
    if (routeMatches && state.view === "standings" && canonical !== `${pathname}${search ? `?${search}` : ""}`) window.history.replaceState(null, "", canonical);
  }, [routeMatches, state.view, canonical, pathname, search]);
  function selectView(view: "games" | "standings", calendar: NcaaCalendar | null) {
    if (!routeMatches || state.view === view) return;
    window.history.pushState(null, "", ncaaLiveOverviewHref(view === "games" ? { view, calendar } : { view, calendar, selection: "top25" }));
    window.scrollTo?.({ top: 0 });
  }
  function selectStandings(selection: NcaaStandingsSelection) {
    if (routeMatches && state.view === "standings" && selection !== state.selection) window.history.replaceState(null, "", ncaaLiveOverviewHref({ ...state, selection }));
  }
  function selectCalendar(calendar: NcaaCalendar) {
    if (routeMatches && state.view === "games") window.history.pushState(null, "", ncaaLiveOverviewHref({ view: "games", calendar }));
  }
  return { state, routeMatches, selectView, selectStandings, selectCalendar };
}
