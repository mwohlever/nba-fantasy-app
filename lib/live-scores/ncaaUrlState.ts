import type { GameCenterTab } from "./urlState";

export type NcaaCalendar = { season: number; week: number };
export type NcaaStandingsSelection = "top25" | "cfp" | `conference:${string}`;
export type NcaaLiveOverview = { calendar: NcaaCalendar | null } & (
  | { view: "games" }
  | { view: "standings"; selection: NcaaStandingsSelection }
  | { view: "detail"; gameId: string; tab: GameCenterTab; period: number | null; statsTeam: string | null }
);

export function parseNcaaLiveOverview(search: string): NcaaLiveOverview {
  const params = new URLSearchParams(search);
  const season = Number(params.get("season")), week = Number(params.get("week"));
  const calendar = Number.isInteger(season) && season >= 2000 && season <= 2100 && Number.isInteger(week) && week >= 1 && week <= 20 ? { season, week } : null;
  if (params.get("view") !== "standings") {
    if (!params.has("gameId")) return { view: "games", calendar };
    const tab = params.get("tab"), period = Number(params.get("period")), team = params.get("statsTeam");
    return { view: "detail", calendar, gameId: params.get("gameId") ?? "",
      tab: tab === "pbp" || tab === "stats" ? tab : "summary",
      period: Number.isInteger(period) && period >= 1 && period <= 20 ? period : null,
      statsTeam: team && /^\d+$/.test(team) ? team : null };
  }
  const conference = params.get("conference");
  const selection = conference && /^\d+$/.test(conference) ? `conference:${conference}` as const
    : params.get("standingsView") === "cfp" ? "cfp" : "top25";
  return { view: "standings", calendar, selection };
}
export function ncaaLiveOverviewHref(state: NcaaLiveOverview) {
  const params = new URLSearchParams();
  if (state.calendar) { params.set("season", String(state.calendar.season)); params.set("week", String(state.calendar.week)); }
  if (state.view === "standings") {
    params.set("view", "standings");
    if (state.selection.startsWith("conference:")) params.set("conference", state.selection.slice(11));
    else params.set("standingsView", state.selection);
  }
  if (state.view === "detail") {
    params.set("gameId", state.gameId); params.set("tab", state.tab);
    if (state.period) params.set("period", String(state.period));
    if (state.statsTeam) params.set("statsTeam", state.statsTeam);
  }
  return `/ncaa-pickem/scores${params.size ? `?${params}` : ""}`;
}
