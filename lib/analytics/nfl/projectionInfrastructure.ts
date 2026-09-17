import { createHash } from "node:crypto";
import { calculateNflFantasyPoints, type NflScoringRules } from "../../scoring/nfl";
import { resolveLeagueRules } from "../../rules/leagueRules";
import { projectNflResearchO1Raw, type RawStats, type ResearchRow } from "./researchCandidates";
import type { NflObservationPosition } from "./observationFoundation";

export const NFL_PROJECTION_V2 = "nfl-v2-o1-opportunity5-production8-v1" as const;
export type NflRawProjectionStats = { passing_yards: number; passing_tds: number; passing_ints: number; rushing_yards: number; rushing_tds: number; receiving_yards: number; receiving_tds: number; receptions: number; fumbles_lost: number };
export type NflProjectionConfidence = "low" | "normal";
export type NflObservationVersionRecord = {
  id: number; provider: "espn"; provider_player_id: string; provider_event_id: string; local_player_id: number | null; position: NflObservationPosition;
  season: number; week: number; phase: "regular"; game_at: string; known_at: string;
  completions: number | null; passing_attempts: number | null; passing_yards: number | null; passing_touchdowns: number | null; interceptions: number | null;
  rushing_attempts: number | null; rushing_yards: number | null; rushing_touchdowns: number | null; receiving_targets: number | null; receptions: number | null; receiving_yards: number | null; receiving_touchdowns: number | null; fumbles_lost: number | null;
};
export type NflProjectionCacheRecord = {
  provider: "espn"; provider_player_id: string; local_player_id: number; position: NflObservationPosition; season: number; model_version: typeof NFL_PROJECTION_V2;
  as_of: string; generated_at: string; projected_stats: NflRawProjectionStats; confidence: NflProjectionConfidence; sample: Record<string, number>;
  components: Record<string, number>; source_latest_game_at: string | null; source_latest_known_at: string | null; projection_hash: string;
};

const instant = (value: string) => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error("NFL projection requires timezone-bearing timestamps"); return parsed; };
const numeric = (value: number | null) => value ?? 0;

/** Versions already filtered by known_at are collapsed per factual player/event as of T. */
export function selectNflAsOfObservationVersions(input: { rows: readonly NflObservationVersionRecord[]; playerId: number; targetSeason: number; asOf: string }) {
  const cutoff = instant(input.asOf), current = new Map<string, NflObservationVersionRecord>();
  for (const row of input.rows) {
    if (row.local_player_id !== input.playerId || row.season !== input.targetSeason || row.phase !== "regular" || instant(row.game_at) >= cutoff || instant(row.known_at) >= cutoff) continue;
    const key = `${row.provider}:${row.provider_player_id}:${row.provider_event_id}`, previous = current.get(key);
    if (!previous || instant(row.known_at) > instant(previous.known_at) || instant(row.known_at) === instant(previous.known_at) && row.id > previous.id) current.set(key, row);
  }
  return [...current.values()].sort((left, right) => instant(left.game_at) - instant(right.game_at) || left.provider_event_id.localeCompare(right.provider_event_id) || left.id - right.id);
}

function researchRow(row: NflObservationVersionRecord): ResearchRow {
  return { providerPlayerId: row.provider_player_id, position: row.position, season: row.season, eventId: row.provider_event_id, gameAt: row.game_at, week: row.week,
    stats: { completions: row.completions, passingAttempts: row.passing_attempts, passingYards: row.passing_yards, passingTouchdowns: row.passing_touchdowns, interceptions: row.interceptions,
      rushingAttempts: row.rushing_attempts, rushingYards: row.rushing_yards, rushingTouchdowns: row.rushing_touchdowns, receivingTargets: row.receiving_targets, receptions: row.receptions, receivingYards: row.receiving_yards, receivingTouchdowns: row.receiving_touchdowns, fumblesLost: row.fumbles_lost } };
}
function cachedStats(stats: RawStats): NflRawProjectionStats { return { passing_yards: stats.passingYards, passing_tds: stats.passingTouchdowns, passing_ints: stats.interceptions, rushing_yards: stats.rushingYards, rushing_tds: stats.rushingTouchdowns, receiving_yards: stats.receivingYards, receiving_tds: stats.receivingTouchdowns, receptions: stats.receptions, fumbles_lost: stats.fumblesLost }; }

/** Frozen O1 only: current-season history, opportunity last 5, production ratio-of-totals last 8. */
export function projectNflV2O1Raw(input: { playerId: number; providerPlayerId: string; position: NflObservationPosition; season: number; asOf: string; history: readonly NflObservationVersionRecord[] }) {
  const selected = selectNflAsOfObservationVersions({ rows: input.history, playerId: input.playerId, targetSeason: input.season, asOf: input.asOf });
  if (!selected.length) return null;
  const target: ResearchRow = { providerPlayerId: input.providerPlayerId, position: input.position, season: input.season, eventId: `projection:${input.playerId}`, gameAt: input.asOf, week: 1, stats: {} };
  const result = projectNflResearchO1Raw(target, selected.map(researchRow));
  if (!result?.projectedStats) throw new Error("Frozen NFL O1 unexpectedly abstained with current-season history");
  const components = result.components as { opportunity: Record<string, number>; productionSample: number };
  return { projectedStats: cachedStats(result.projectedStats), confidence: selected.length < 5 ? "low" as const : "normal" as const,
    sample: { current_season_games: selected.length, opportunity_window_games: Math.min(5, selected.length), production_window_games: Math.min(8, selected.length) },
    components: { passing_attempts: components.opportunity.passingAttempts ?? 0, rushing_attempts: components.opportunity.rushingAttempts ?? 0, receiving_targets: components.opportunity.receivingTargets ?? 0, production_window_games: components.productionSample },
    sourceLatestGameAt: selected.at(-1)?.game_at ?? null, sourceLatestKnownAt: selected.at(-1)?.known_at ?? null };
}

/** Hash includes raw model output and factual source boundary, never volatile generation timestamps. */
export function nflProjectionCacheRecord(input: { playerId: number; providerPlayerId: string; position: NflObservationPosition; season: number; asOf: string; generatedAt: string; projection: NonNullable<ReturnType<typeof projectNflV2O1Raw>> }): NflProjectionCacheRecord {
  const body = { provider: "espn" as const, provider_player_id: input.providerPlayerId, local_player_id: input.playerId, position: input.position, season: input.season, model_version: NFL_PROJECTION_V2, as_of: input.asOf,
    projected_stats: input.projection.projectedStats, confidence: input.projection.confidence, sample: input.projection.sample, components: input.projection.components, source_latest_game_at: input.projection.sourceLatestGameAt, source_latest_known_at: input.projection.sourceLatestKnownAt };
  return { ...body, generated_at: input.generatedAt, projection_hash: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

/** Slate rules are applied at read time only; global cache rows never contain points or slate/group identity. */
export function scoreCachedNflProjection(record: Pick<NflProjectionCacheRecord, "projected_stats">, rulesSnapshot: Record<string, unknown> | null) {
  const rules = resolveLeagueRules({ sport: "nfl", settings: rulesSnapshot }).scoring as NflScoringRules;
  return calculateNflFantasyPoints(record.projected_stats, rules);
}

export function validateNflRawProjectionStats(stats: NflRawProjectionStats) {
  const keys = ["passing_yards", "passing_tds", "passing_ints", "rushing_yards", "rushing_tds", "receiving_yards", "receiving_tds", "receptions", "fumbles_lost"];
  return Object.keys(stats).length === keys.length && keys.every(key => Object.hasOwn(stats, key) && typeof stats[key as keyof NflRawProjectionStats] === "number" && Number.isFinite(stats[key as keyof NflRawProjectionStats]) && stats[key as keyof NflRawProjectionStats] >= 0) && numeric(stats.passing_yards) >= 0;
}
