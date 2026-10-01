import { easternToday, nbaDateKey } from "./nbaDate";
import type { NbaLiveContext } from "./nbaContext";

export type GameCenterTab = "summary" | "pbp" | "stats";
export type NbaLiveState = { sport: "nba"; context: NbaLiveContext } & (
  | { view: "games"; date: string }
  | { view: "detail"; date: string | null; gameId: string; tab: GameCenterTab }
);
/** Future view contracts only. Golf deliberately has no standings variant.
 * Live is independent of the fantasy slate viewing-context/storage namespace. */
export type LiveState = NbaLiveState
  | { sport: "nba"; context: NbaLiveContext; view: "standings"; leagueSeason: number }
  | ({ sport: "nfl"; context: "nfl" } & (
      | { view: "games"; season: number; seasonType: number; week: number }
      | { view: "standings"; season: number }
      | { view: "detail"; gameId: string; tab: GameCenterTab }))
  | ({ sport: "golf"; context: "golf"; tournamentId: string } & (
      | { view: "leaderboard" }
      | { view: "detail"; golferId: string }));

export function parseNbaLiveState(context: NbaLiveContext, search: string, today = easternToday()): NbaLiveState {
  const params = new URLSearchParams(search);
  const rawDate = params.get("date");
  const date = rawDate && nbaDateKey(rawDate) ? rawDate : null;
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
  if (state.view === "detail") { params.set("gameId", state.gameId); params.set("tab", state.tab); }
  return `${state.context === "nba" ? "/live-scores" : "/nba-skins/live"}?${params}`;
}

export function validNbaEventId(value: string) { return /^\d+$/.test(value); }

export function nbaEventDate(header: { competitions?: { date?: string }[] } | null | undefined) {
  const value = header?.competitions?.[0]?.date;
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return easternToday(new Date(value));
}

export type LiveOverviewEntry = { overview: string; gameId: string; scope: string };
export function liveBackMatches(entry: LiveOverviewEntry | null | undefined, overview: string, gameId: string, scope: string) {
  return Boolean(entry && entry.overview === overview && entry.gameId === gameId && entry.scope === scope);
}
