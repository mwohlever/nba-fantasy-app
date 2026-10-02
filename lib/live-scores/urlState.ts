import { easternToday, nbaDateKey } from "./nbaDate";
import type { NbaLiveContext } from "./nbaContext";

export type GameCenterTab = "summary" | "pbp" | "stats";
export type NbaStandingsView = "east" | "west" | "playoffs";
export type NflStandingsView = "afc" | "nfc" | "playoffs";
export type NbaLiveState = { sport: "nba"; context: NbaLiveContext } & (
  | { view: "games"; date: string }
  | { view: "standings"; date: string; standingsView: NbaStandingsView }
  | { view: "detail"; date: string | null; gameId: string; tab: GameCenterTab }
);
export type NflCalendarContext = { season: number; seasonType: number; week: number };
export type NflLiveState = { sport: "nfl"; context: "nfl"; calendar: NflCalendarContext | null } & (
  | { view: "games" }
  | { view: "standings"; standingsView: NflStandingsView }
  | { view: "detail"; gameId: string; tab: GameCenterTab; period: number | null; statsTeam: string | null }
);
/** Golf deliberately has no standings variant.
 * Live is independent of the fantasy slate viewing-context/storage namespace. */
export type LiveState = NbaLiveState
  | NflLiveState
  | ({ sport: "golf"; context: "golf"; tournamentId: string } & (
      | { view: "leaderboard" }
      | { view: "detail"; golferId: string }));

export function parseNbaLiveState(context: NbaLiveContext, search: string, today = easternToday()): NbaLiveState {
  const params = new URLSearchParams(search);
  const rawDate = params.get("date");
  const date = rawDate && nbaDateKey(rawDate) ? rawDate : null;
  if (params.get("view") === "standings") {
    const selected = params.get("standingsView");
    return { sport: "nba", context, view: "standings", date: date ?? today,
      standingsView: selected === "west" || selected === "playoffs" ? selected : "east" };
  }
  // Presence (including an empty/invalid ID) selects detail: never silently pick a game.
  if (params.has("gameId")) {
    const value = params.get("tab");
    return { sport: "nba", context, view: "detail", date, gameId: params.get("gameId") ?? "",
      tab: value === "pbp" || value === "stats" ? value : "summary" };
  }
  return { sport: "nba", context, view: "games", date: date ?? today };
}

export function nbaLiveHref(state: NbaLiveState) {
  const params = new URLSearchParams();
  if (state.context === "nba") params.set("sport", "nba");
  if (state.date) params.set("date", state.date);
  if (state.view === "standings") { params.set("view", "standings"); params.set("standingsView", state.standingsView); }
  if (state.view === "detail") { params.set("gameId", state.gameId); params.set("tab", state.tab); }
  return `${state.context === "nba" ? "/live-scores" : "/nba-skins/live"}?${params}`;
}

export function validNbaEventId(value: string) { return /^\d+$/.test(value); }

/** NFL schedules are weekly, including distinct preseason/postseason calendars.
 * Missing/invalid calendar context waits for the provider's current week; never
 * guesses January's season from the calendar year or uses a fantasy slate ID. */
export function parseNflCalendar(params: URLSearchParams): NflCalendarContext | null {
  const season = Number(params.get("season")), seasonType = Number(params.get("seasonType")), week = Number(params.get("week"));
  return Number.isInteger(season) && season >= 2000 && season <= 2100 && [1, 2, 3].includes(seasonType)
    && Number.isInteger(week) && week >= 1 && week <= 18 ? { season, seasonType, week } : null;
}

export function parseNflLiveState(search: string): NflLiveState {
  const params = new URLSearchParams(search);
  const base = { sport: "nfl" as const, context: "nfl" as const, calendar: parseNflCalendar(params) };
  if (params.get("view") === "standings") {
    const selected = params.get("standingsView");
    return { ...base, view: "standings", standingsView: selected === "nfc" || selected === "playoffs" ? selected : "afc" };
  }
  if (!params.has("gameId")) return { ...base, view: "games" };
  const tab = params.get("tab"), period = Number(params.get("period")), team = params.get("statsTeam");
  return { ...base, view: "detail", gameId: params.get("gameId") ?? "",
    tab: tab === "pbp" || tab === "stats" ? tab : "summary",
    period: Number.isInteger(period) && period >= 1 && period <= 20 ? period : null,
    statsTeam: team && /^\d+$/.test(team) ? team : null };
}

export function nflLiveHref(state: NflLiveState): string {
  const params = new URLSearchParams({ sport: "nfl" });
  if (state.calendar) {
    params.set("season", String(state.calendar.season)); params.set("seasonType", String(state.calendar.seasonType)); params.set("week", String(state.calendar.week));
  }
  if (state.view === "standings") { params.set("view", "standings"); params.set("standingsView", state.standingsView); }
  if (state.view === "detail") {
    params.set("gameId", state.gameId); params.set("tab", state.tab);
    if (state.period) params.set("period", String(state.period));
    if (state.statsTeam) params.set("statsTeam", state.statsTeam);
  }
  return `/live-scores?${params}`;
}

export function validNflEventId(value: string) { return /^\d+$/.test(value); }

export function nbaEventDate(header: { competitions?: { date?: string }[] } | null | undefined) {
  const value = header?.competitions?.[0]?.date;
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return easternToday(new Date(value));
}

export type LiveOverviewEntry = { overview: string; gameId: string; scope: string };
export function liveBackMatches(entry: LiveOverviewEntry | null | undefined, overview: string, gameId: string, scope: string) {
  return Boolean(entry && entry.overview === overview && entry.gameId === gameId && entry.scope === scope);
}
