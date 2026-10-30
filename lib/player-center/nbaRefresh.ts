import { createHash } from "node:crypto";
import { normalizeEspnNbaGameLog } from "../analytics/providers/espnNbaGameLog";
import { observationRecordFromNbaObservation, type NbaObservationRecord } from "../analytics/nba/projectionInfrastructure";
import { normalizeCenterLog, normalizeCenterSeasonStats } from "./espn";
import type { CenterGame, CenterPlayer } from "./types";

export const NBA_APPEND_SOURCE_MD5 = "9308a04b52fecc6993b7730490cf686a";
export const NBA_REFRESH_LIMITS = { reserveBytes: 256 * 1048576, walAllowanceBytes: 64 * 1048576, cacheBytes: 64 * 1048576,
  warningDatabaseBytes: 400_000_000, stopDatabaseBytes: 450_000_000, maxMetricAgeSeconds: 90 } as const;

export type RefreshOutcome = "verified_data" | "verified_zero_appearances" | "coverage_incomplete" | "acquisition_failed" | "blocked_identity";
export type AcquiredSource = { payload?: unknown; fetchedAt: string; error?: string };
export type NbaRefreshCache = {
  sport: "nba"; provider: "espn"; provider_player_id: string; season: number; phase: "regular";
  nba_local_player_id: number; nfl_local_player_id: null; as_of: string; checked_at: string;
  expected_games: number | null; observed_games: number; complete: boolean; games: CenterGame[];
  season_stats: ReturnType<typeof normalizeCenterSeasonStats> | null; issues: string[]; content_hash: string; rollout_batch_id: string;
};
export type NbaRefreshPublication = {
  player_id: number; native_player_id: string | null; provider_player_id: string | null;
  identity: CenterPlayer["identity"]; outcome: RefreshOutcome; attempted_at: string; acquired_at: string | null;
  observations: NbaObservationRecord[]; cache: NbaRefreshCache | null; issues: string[];
};
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const refreshHash = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Pure acquisition classification. No clients, environment loading, persistence or forecast calls. */
export function buildNbaRefreshPublication(input: {
  player: CenterPlayer; season: number; asOf: string; runId: string; attemptedAt: string;
  log?: AcquiredSource; summary?: AcquiredSource;
}): NbaRefreshPublication {
  const { player, season, asOf, runId } = input;
  const cutoff = Date.parse(asOf), attempted = Date.parse(input.attemptedAt);
  if (player.sport !== "nba" || !Number.isInteger(season) || season < 2000 || season > 2100 ||
    !Number.isFinite(cutoff) || !Number.isFinite(attempted) || cutoff > attempted || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Invalid NBA refresh context");
  const result: NbaRefreshPublication = { player_id: player.playerId, native_player_id: player.nativePlayerId,
    provider_player_id: player.providerPlayerId, identity: player.identity, outcome: "blocked_identity", attempted_at: input.attemptedAt,
    acquired_at: null, observations: [], cache: null, issues: [] };
  if (!player.active || player.identity !== "resolved" || !player.nativePlayerId || !player.providerPlayerId) {
    result.issues.push("unresolved_or_conflicting_identity"); return result;
  }
  const issues: string[] = [];
  let games: CenterGame[] = [], stats: ReturnType<typeof normalizeCenterSeasonStats> | null = null;
  let logValid = false, emptyUnverified = false, summaryValid = false;
  for (const [kind, source] of [["log", input.log], ["summary", input.summary]] as const) {
    if (!source || source.error) { issues.push(`${kind}:${source?.error ?? "not_acquired"}`); continue; }
    if (!Number.isFinite(Date.parse(source.fetchedAt)) || Date.parse(source.fetchedAt) < cutoff || Date.parse(source.fetchedAt) > attempted) {
      issues.push(`${kind}:invalid_acquisition_time`); continue;
    }
    try {
      if (kind === "summary") {
        stats = normalizeCenterSeasonStats(source.payload, "nba", season, "regular", player.providerPlayerId);
        if (stats.expectedGames !== null && stats.expectedGames > 110) throw new Error("Provider GP cap exceeded");
        summaryValid = true; issues.push(...stats.issues);
      } else {
        const p = obj(source.payload), filters = Array.isArray(p.filters) ? p.filters.map(obj) : [];
        emptyUnverified = Object.keys(p).length === 1 && Object.keys(p)[0] === "filters" &&
          filters.find(f => f.name === "league")?.value === "nba" &&
          (filters.find(f => f.name === "season") === undefined || String(filters.find(f => f.name === "season")?.value) === String(season));
        if (emptyUnverified) continue; // Not a zero. Only explicit independent GP=0 can resolve this case below.
        const log = normalizeCenterLog(source.payload, { sport: "nba", providerPlayerId: player.providerPlayerId, season, phase: "regular", fetchedAt: source.fetchedAt });
        games = log.games; issues.push(...log.issues); logValid = true;
        if (games.length > 110) throw new Error("Provider game cap exceeded");
        const raw = normalizeEspnNbaGameLog(source.payload, { espnPlayerId: player.providerPlayerId, season,
          fetchedAt: source.fetchedAt, knownAt: source.fetchedAt });
        result.observations = raw.observations.filter(row => row.gameAt && Date.parse(row.gameAt) <= cutoff)
          .map(row => observationRecordFromNbaObservation(row, player.playerId)).filter((row): row is NbaObservationRecord => row !== null);
      }
    } catch (error) { issues.push(`${kind}:${error instanceof Error ? error.message : "invalid_payload"}`); if (kind === "log") { logValid = false; result.observations = []; } }
  }
  if (emptyUnverified && summaryValid && stats?.expectedGames === 0 && !stats.issues.length) logValid = true;
  if (!logValid || !summaryValid) {
    if (emptyUnverified) issues.push("unverified_no_data");
    result.outcome = "acquisition_failed"; result.issues = [...new Set(issues)]; return result;
  }
  const past = games.filter(game => Date.parse(game.gameAt) <= cutoff);
  const played = past.filter(game => game.status === "final" && game.participation === "played");
  if (stats!.expectedGames === null) issues.push("independent_gp_unknown");
  else if (stats!.expectedGames !== played.length) issues.push(`gp_mismatch:${played.length}/${stats!.expectedGames}`);
  for (const game of past) {
    if (game.status !== "final" || game.participation === "unknown") issues.push(`unverified_event:${game.eventId}`);
    if (game.issues.length) issues.push(`invalid_event:${game.eventId}`);
    if (game.status === "final" && game.participation === "played" && !result.observations.some(row => row.provider_event_id === game.eventId)) issues.push(`incomplete_scoring_line:${game.eventId}`);
  }
  // Later/live evidence cannot certify an older common cutoff, even if total GP happens to agree.
  if (games.some(game => Date.parse(game.gameAt) > cutoff && game.status !== "scheduled")) issues.push("evidence_after_cutoff");
  const unique = [...new Set(issues)], complete = unique.length === 0;
  const checked = new Date(Math.max(Date.parse(input.log!.fetchedAt), Date.parse(input.summary!.fetchedAt))).toISOString();
  result.acquired_at = checked;
  result.outcome = complete ? played.length ? "verified_data" : "verified_zero_appearances" : "coverage_incomplete";
  result.issues = unique;
  result.cache = { sport: "nba", provider: "espn", provider_player_id: player.providerPlayerId, season, phase: "regular",
    nba_local_player_id: player.playerId, nfl_local_player_id: null, as_of: asOf, checked_at: checked,
    expected_games: stats!.expectedGames, observed_games: played.length, complete, games, season_stats: stats, issues: unique,
    content_hash: refreshHash({ season, identity: [player.playerId, player.nativePlayerId, player.providerPlayerId],
      games: games.map(({ fetchedAt: _time, ...game }) => { void _time; return game; }), stats, issues: unique }), rollout_batch_id: runId };
  if (Buffer.byteLength(JSON.stringify(result.cache)) > 524288) throw new Error("Player cache exceeds publication cap");
  return result;
}

/** A newer failed/incomplete check never makes an older snapshot look freshly verified. */
export function applyNbaRefreshStatus<T extends import("./types").CenterHistory>(history: T, status: Record<string, unknown> | undefined): T {
  const cache = history.coverage.cache;
  if (!cache || !status && !/^[0-9a-f-]{36}$/i.test(cache.batchId)) return history; // Existing owner-reviewed bootstrap receipts remain supported.
  const verified = !!status && ["verified_data", "verified_zero_appearances"].includes(String(status.outcome)) &&
    status.run_id === cache.batchId && Date.parse(String(status.as_of)) === Date.parse(cache.asOf) &&
    status.provider_player_id === history.player.providerPlayerId && String(status.native_player_id) === history.player.nativePlayerId &&
    Date.parse(String(status.last_verified_at)) >= Date.parse(cache.checkedAt);
  if (!verified) {
    history.coverage.comparisonEligible = false;
    const freshlyAcquiredPartial = status?.outcome === "coverage_incomplete" && status.run_id === cache.batchId &&
      Date.parse(String(status.last_acquired_at)) >= Date.parse(cache.checkedAt);
    if (!freshlyAcquiredPartial) history.coverage.freshness = "stale";
    history.coverage.issues.push(`refresh:${String(status?.outcome ?? "missing_status")}`);
  }
  return history;
}
