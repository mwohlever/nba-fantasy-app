export type NcaaCalendar = { season: number; week: number };
export type NcaaStandingsSelection = "top25" | "cfp" | `conference:${string}`;
export type NcaaLiveOverview = { calendar: NcaaCalendar | null } & (
  | { view: "games" }
  | { view: "standings"; selection: NcaaStandingsSelection }
);

export function parseNcaaLiveOverview(search: string): NcaaLiveOverview {
  const params = new URLSearchParams(search);
  const season = Number(params.get("season")), week = Number(params.get("week"));
  const calendar = Number.isInteger(season) && season >= 2000 && season <= 2100 && Number.isInteger(week) && week >= 1 && week <= 20 ? { season, week } : null;
  if (params.get("view") !== "standings") return { view: "games", calendar };
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
  return `/ncaa-pickem/scores${params.size ? `?${params}` : ""}`;
}
