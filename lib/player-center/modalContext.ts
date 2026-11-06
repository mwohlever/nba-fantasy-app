import { professionalSeason, type CenterSport } from "./types";

export type LeagueSeason = number | "all";
export type PlayerResearchMode = "season" | "league";

/** Professional seasons and calendar-year 111 Sports history are independent contexts. */
export function modalSeasons(input: { sport: CenterSport; centerSeason?: number; nflStatsSeason?: number; season?: LeagueSeason; defaultMode?: PlayerResearchMode }, now = new Date()) {
  return {
    leagueSeason: input.season ?? now.getUTCFullYear(),
    // Only an explicit professional research choice overrides the current season.
    // League-history years and historical draft slates are separate contexts.
    professionalSeason: input.centerSeason ?? (input.sport === "nfl" ? input.nflStatsSeason : undefined) ?? professionalSeason(input.sport, now),
  };
}

export function leagueHistoryHref(sport: CenterSport, season: LeagueSeason, playerId?: number) {
  const params = new URLSearchParams({ sport, mode: "league", season: String(season) });
  if (playerId !== undefined) params.set("playerId", String(playerId));
  return `/player-history?${params}`;
}
