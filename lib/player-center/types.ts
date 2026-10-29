export type CenterSport = "nba" | "nfl";
export type CenterPhase = "regular" | "postseason" | "preseason";
export type CenterStats = Record<string, number | null>;
export type CenterPlayer = {
  sport: CenterSport; playerId: number; name: string; position: string; active: boolean;
  providerPlayerId: string | null; nativePlayerId: string | null;
  identity: "resolved" | "unresolved" | "conflict";
};
export type CenterGame = {
  provider: "espn"; providerPlayerId: string; eventId: string;
  season: number; phase: CenterPhase; gameAt: string; week: number | null;
  teamId: string | null; team: string | null; opponentId: string | null; opponent: string | null;
  homeAway: "home" | "away" | null;
  status: "final" | "live" | "scheduled" | "unknown";
  participation: "played" | "dnp" | "unknown";
  stats: CenterStats;
  sources: string[]; fetchedAt: string; issues: string[];
};
export type CenterHistory = {
  player: CenterPlayer; season: number; phase: CenterPhase;
  source: "provider" | "stored";
  games: CenterGame[];
  coverage: {
    kind: "appearance_log" | "stored_appearances" | "team_schedule" | "season_cache" | "unavailable";
    /** Independent GP/schedule verification is required to claim full season coverage. */
    expectedGames: number | null;
    fetchedAt: string | null;
    freshness: "fresh" | "stale" | "unavailable";
    issues: string[];
    comparisonEligible?: boolean;
    cache?: { asOf: string; checkedAt: string; complete: boolean; batchId: string; contentHash: string };
  };
};
export type CenterWindow = "last1" | "last3" | "last5" | "season";
export type CenterScoringContext = {
  sport: CenterSport;
  settings: Record<string, unknown> | null;
  basis: "slate_snapshot" | "league_settings" | "legacy_defaults";
};

/** The public contract uses professional years, never the old app-season conversion. */
export function professionalSeason(sport: CenterSport, now = new Date()) {
  const month = now.getUTCMonth() + 1, year = now.getUTCFullYear();
  return sport === "nba" ? year + (month >= 10 ? 1 : 0) : year - (month < 3 ? 1 : 0);
}
export function slateCenterSeason(sport: CenterSport, slate?: { date: string; start_date?: string; display_name?: string | null } | null) {
  const named = sport === "nfl" ? slate?.display_name?.match(/^(\d{4}) Week \d+$/)?.[1] : null;
  if (named) return Number(named);
  const date = slate?.start_date ?? slate?.date;
  const parsed = date ? new Date(`${date.slice(0, 10)}T12:00:00Z`) : new Date();
  return professionalSeason(sport, Number.isFinite(parsed.getTime()) ? parsed : new Date());
}
export function seasonLabel(sport: CenterSport, season: number) {
  return sport === "nba" ? `${season - 1}–${String(season).slice(-2)}` : String(season);
}
export function validCenterSeason(value: number, sport: CenterSport, now = new Date()) {
  return Number.isInteger(value) && value >= 2000 && value <= professionalSeason(sport, now);
}
export function finiteStat(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
