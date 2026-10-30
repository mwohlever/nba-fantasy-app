import { calculateCorrectionFantasyPoints } from "../corrections/correctionPolicy";
import { calculateNflDstFantasyPoints } from "../scoring/nfl";
import { resolveLeagueRules, type NbaScoringRules, type NflScoringRules } from "../rules/leagueRules";
import { seasonLabel } from "./types";
import type { CenterGame, CenterHistory, CenterScoringContext, CenterStats, CenterWindow } from "./types";

const nbaFields = ["points", "rebounds", "assists", "steals", "blocks", "turnovers"];
const nflFields = ["passing_yards", "passing_tds", "passing_ints", "rushing_yards", "rushing_tds", "receiving_yards", "receiving_tds", "receptions", "fumbles_lost"];
const dstFields = ["sacks", "interceptions", "fumbleRecoveries", "safeties", "touchdowns", "pointsAllowed", "yardsAllowed"];

/** Missing statistics are rejected before calling the existing zero-defaulting scorer. */
export function actualFantasyPoints(game: CenterGame, position: string, context: CenterScoringContext) {
  if (game.status !== "final" || game.participation !== "played" || game.issues.length || position === "K") return null;
  if (context.basis === "slate_snapshot" && !context.settings) throw new Error("Frozen slate snapshot required");
  if (context.settings?.sport !== undefined && context.settings.sport !== context.sport) throw new Error("Scoring sport mismatch");
  const fields = context.sport === "nba" ? nbaFields : position === "D/ST" ? dstFields : nflFields;
  if (fields.some(key => game.stats[key] == null || !Number.isFinite(game.stats[key]))) return null;
  const scoring = resolveLeagueRules({ sport: context.sport, settings: context.settings }).scoring;
  if (position === "D/ST" && context.sport === "nfl") {
    const s = game.stats;
    return calculateNflDstFantasyPoints({ sacks: s.sacks!, interceptions: s.interceptions!, fumbleRecoveries: s.fumbleRecoveries!,
      safeties: s.safeties!, touchdowns: s.touchdowns!, pointsAllowed: s.pointsAllowed!, yardsAllowed: s.yardsAllowed! }, scoring as NflScoringRules);
  }
  return calculateCorrectionFantasyPoints({ sport: context.sport, stats: game.stats as Record<string, number>, scoring: scoring as NbaScoringRules | NflScoringRules });
}

export const comparisonStats = {
  nba: ["fantasy_points", "minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers"],
  QB: ["fantasy_points", "passing_yards", "passing_tds", "passing_ints", "rushing_yards", "rushing_tds"],
  RB: ["fantasy_points", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds"],
  WR: ["fantasy_points", "receptions", "receiving_yards", "receiving_tds", "receiving_targets"],
  TE: ["fantasy_points", "receptions", "receiving_yards", "receiving_tds", "receiving_targets"],
  K: ["field_goals_made", "field_goals_attempted", "extra_points_made", "extra_points_attempted", "kicking_points"],
  "D/ST": ["fantasy_points", "sacks", "interceptions", "fumbleRecoveries", "pointsAllowed", "yardsAllowed"],
} as const;

export function summarizeHistory(history: CenterHistory, window: CenterWindow, context: CenterScoringContext, asOf: string) {
  if (context.sport !== history.player.sport) throw new Error("History scoring sport mismatch");
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("Invalid comparison cutoff");
  const cutoff = Math.min(Date.parse(asOf), Date.parse(history.coverage.cache?.asOf ?? asOf));
  const eligible = history.games.filter(game => game.season === history.season && game.phase === history.phase &&
    game.providerPlayerId === history.player.providerPlayerId && Date.parse(game.gameAt) <= cutoff);
  const ordered = [...eligible].sort((a, b) => b.gameAt.localeCompare(a.gameAt) || b.eventId.localeCompare(a.eventId));
  const appearances = ordered.filter(game => game.status !== "scheduled" && game.status !== "live" && game.participation === "played");
  const played = appearances.filter(game => game.status === "final");
  const required = window === "last1" ? 1 : window === "last3" ? 3 : window === "last5" ? 5 : null;
  // Unknown recent rows occupy their proper window: never skip them for an older good game.
  const candidates = ordered.filter(game => game.status !== "scheduled" && game.status !== "live" && game.participation !== "dnp");
  const windowRows = required === null ? candidates : candidates.slice(0, required);
  const rows = windowRows.filter(game => game.status === "final" && game.participation === "played");
  const unverifiedGames = windowRows.length - rows.length;
  const issues = [...history.coverage.issues];
  if (required !== null && rows.length < required) issues.push(`insufficient_games:${rows.length}/${required}`);
  if (unverifiedGames) issues.push(`unverified_games:${unverifiedGames}`);
  const appearanceCoverageVerified = history.coverage.expectedGames !== null && history.coverage.expectedGames === appearances.length;
  const seasonVerified = appearanceCoverageVerified && played.length === appearances.length;
  const stats: CenterStats = {}, totals: CenterStats = {}, samples: Record<string, number> = {};
  const keys = new Set(rows.flatMap(game => Object.keys(game.stats)));
  keys.add("fantasy_points");
  for (const key of keys) {
    const values = rows.map(game => key === "fantasy_points" ? actualFantasyPoints(game, history.player.position, context) : game.stats[key]);
    const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
    samples[key] = valid.length;
    const complete = rows.length > 0 && valid.length === rows.length && !unverifiedGames && (required === null || rows.length === required);
    totals[key] = complete ? valid.reduce((sum, value) => sum + value, 0) : null;
    stats[key] = complete ? totals[key]! / rows.length : null;
  }
  const comparable = history.player.identity === "resolved" && history.coverage.freshness === "fresh" && history.coverage.comparisonEligible !== false && history.coverage.cache?.complete !== false &&
    unverifiedGames === 0 && rows.length > 0 && (required === null ? seasonVerified : rows.length === required && appearanceCoverageVerified);
  return { window, sampleSize: rows.length, availableGames: played.length, expectedGames: history.coverage.expectedGames,
    seasonVerified, unverifiedGames, averages: stats, totals, metricSamples: samples,
    firstGameAt: rows.at(-1)?.gameAt ?? null, lastGameAt: rows[0]?.gameAt ?? null,
    freshness: history.coverage.freshness,
    missingMetricSamples: Object.fromEntries([...keys].map(key => [key, rows.length - samples[key]])),
    metricComparable: Object.fromEntries([...keys].map(key => [key, comparable && stats[key] !== null])),
    // A season with unknown appearance coverage is useful research but cannot be advertised as complete.
    comparable,
    issues: [...new Set(issues)] };
}

/** Numeric ordering is independent of direction for missing values. */
export function compareActualStats(left: number | null | undefined, right: number | null | undefined, ascending: boolean) {
  const a = left != null && Number.isFinite(left) ? left : null, b = right != null && Number.isFinite(right) ? right : null;
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}


/** Shared deterministic comparison for stored observations and isolated, captured preview pools. */
export function compareHistories(input: { sport: CenterScoringContext["sport"]; season: number; window: CenterWindow; metric: string; position?: string; ascending: boolean; scoring: CenterScoringContext }, histories: CenterHistory[], asOf: string, readAt: string | null) {
    const players = histories.filter(history => history.player.active && (!input.position || history.player.position === input.position)).map(history => {
      const summary = summarizeHistory(history, input.window, input.scoring, asOf);
      const fields = input.sport === "nba" ? comparisonStats.nba : comparisonStats[history.player.position as keyof typeof comparisonStats] ?? [];
      const relevant = (fields as readonly string[]).includes(input.metric);
      return { player: history.player, coverage: history.coverage, summary,
        metricRelevant: relevant,
        observedAverage: relevant ? summary.averages[input.metric] ?? null : null,
        rankableAverage: relevant && summary.metricComparable[input.metric] ? summary.averages[input.metric] ?? null : null };
    });
    const relevant = players.filter(row => input.sport === "nba" || ((comparisonStats[row.player.position as keyof typeof comparisonStats] ?? []) as readonly string[]).includes(input.metric));
    // Unknown rows cannot silently drop out of the comparison universe. Explicit GP=0 is a known absence.
    const required = input.window === "last1" ? 1 : input.window === "last3" ? 3 : input.window === "last5" ? 5 : null;
    const knownShortSample = (row: typeof players[number]) => row.player.identity === "resolved" && row.coverage.freshness === "fresh" &&
      row.coverage.comparisonEligible !== false && row.coverage.cache?.complete === true && row.summary.seasonVerified && row.summary.unverifiedGames === 0 &&
      (row.coverage.expectedGames === 0 || required !== null && row.summary.availableGames < required &&
        row.summary.metricSamples[input.metric] === row.summary.sampleSize);
    const cutoffs = new Set(relevant.map(row => row.coverage.cache?.asOf).filter(Boolean));
    const canSort = relevant.some(row => row.rankableAverage !== null) && cutoffs.size <= 1 && relevant.every(row => row.rankableAverage !== null || knownShortSample(row));
    players.sort((a, b) => (canSort ? compareActualStats(a.rankableAverage, b.rankableAverage, input.ascending) : 0) || a.player.name.localeCompare(b.player.name));
    return { sport: input.sport, season: input.season, seasonLabel: seasonLabel(input.sport, input.season), phase: "regular" as const,
      window: input.window, metric: input.metric, direction: input.ascending ? "asc" : "desc", scoringBasis: input.scoring.basis,
      source: "stored" as const, providerRequests: 0, readAt: readAt, asOf: cutoffs.size === 1 ? [...cutoffs][0]! : asOf,
      coverage: { poolPlayers: players.length, relevantPlayers: relevant.length,
        mappedPlayers: players.filter(row => row.player.identity === "resolved").length,
        playersWithGames: players.filter(row => row.summary.availableGames > 0).length,
        rankablePlayers: relevant.filter(row => row.rankableAverage !== null).length,
        canSort, reason: canSort ? null : "Coverage, source freshness, or complete metric windows are not verified across the relevant pool; alphabetical order retained." }, players };
}
