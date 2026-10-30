import type { CenterGame, CenterSport, CenterWindow } from "./types";
export type CenterIdentity = { id: number; name: string; positionGroup?: string | null; teamAbbreviation?: string | null;
  nbaPlayerId?: number | null; nflPlayerId?: number | null; headshotUrl?: string | null; jerseyNumber?: string | null };
export const formatStat = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
export function signedPoints(value: number | null | undefined) {
  const formatted = formatStat(value, 2);
  return formatted === "—" ? formatted : formatted === "0" || formatted === "-0" ? "0" : value! > 0 ? `+${formatted}` : formatted;
}
export const windowLabel: Record<CenterWindow, string> = { last1: "Last game", last3: "Last 3", last5: "Last 5", season: "Season" };
export const venueLabel = (game: CenterGame) => game.homeAway === "away" ? "@" : game.homeAway === "home" ? "vs" : "·";
export function gameIdentifier(game: CenterGame, sport: CenterSport) {
  const day = new Date(game.gameAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const week = sport === "nfl" && game.week !== null ? `W${game.week} · ` : "";
  return `${week}${day} ${venueLabel(game)} ${game.opponent ?? "Opponent unavailable"}`;
}
export const statLabels: Record<string, string> = { fantasy_points: "Fantasy FP", minutes: "MIN", points: "PTS", rebounds: "REB", assists: "AST", steals: "STL", blocks: "BLK", turnovers: "TO",
  passing_yards: "Pass YDS", passing_tds: "Pass TD", passing_ints: "INT", completions: "CMP", passing_attempts: "ATT", rushing_yards: "Rush YDS", rushing_tds: "Rush TD", rushing_attempts: "CAR",
  receptions: "REC", receiving_yards: "Rec YDS", receiving_tds: "Rec TD", receiving_targets: "TGTS", fumbles_lost: "FL",
  field_goals_made: "FGM", field_goals_attempted: "FGA", extra_points_made: "XPM", extra_points_attempted: "XPA", kicking_points: "Kick PTS", long_field_goal: "Long FG",
  sacks: "Sacks", interceptions: "INT", fumbleRecoveries: "FR", safeties: "Safety", touchdowns: "D/ST TD", pointsAllowed: "PA", yardsAllowed: "YA" };
export function gameColumns(sport: CenterSport, position: string): string[] {
  if (sport === "nba") return ["minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers", "FG", "3PT", "FT"];
  if (position === "K") return ["field_goals_made", "field_goals_attempted", "extra_points_made", "extra_points_attempted", "long_field_goal", "kicking_points"];
  if (position === "D/ST") return ["sacks", "interceptions", "fumbleRecoveries", "safeties", "touchdowns", "pointsAllowed", "yardsAllowed"];
  if (position === "QB") return ["completions", "passing_attempts", "passing_yards", "passing_tds", "passing_ints", "rushing_yards", "rushing_tds", "fumbles_lost"];
  if (position === "RB") return ["rushing_attempts", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds", "fumbles_lost"];
  return ["receiving_targets", "receptions", "receiving_yards", "receiving_tds", "rushing_yards", "rushing_tds", "fumbles_lost"];
}
export function gameCell(game: CenterGame, key: string) {
  const pairs: Record<string, [string, string]> = { FG: ["fieldGoalsMade", "fieldGoalsAttempted"], "3PT": ["threePointersMade", "threePointersAttempted"], FT: ["freeThrowsMade", "freeThrowsAttempted"] };
  if (!pairs[key]) return formatStat(game.stats[key]);
  const [a, b] = pairs[key].map(field => game.stats[field]);
  return a == null || b == null ? "—" : `${formatStat(a)}–${formatStat(b)}`;
}
export function gameStatus(game: CenterGame) {
  if (game.participation === "dnp") return "DNP";
  if (game.status === "unknown") return "Unverified";
  if (game.status === "live") return "Live";
  if (game.status === "scheduled") return "Scheduled";
  return game.participation === "unknown" ? "Participation unknown" : "Final";
}
