import { createHash } from "node:crypto";
import { modelingEvidence } from "./participation";
import { scoreNbaStats, targetNbaScoring } from "./scoring";
import { completeStats, instant, type NbaObservation, type NbaStatLine } from "./types";

export const NBA_PROJECTION_NORMALIZATION_VERSION = "espn_nba_gamelog_v1";

export type NbaProviderIdentity = {
  provider: "espn";
  providerPlayerId: string;
  playerId: number | null;
  providerName: string | null;
  status: "resolved" | "unresolved" | "ambiguous";
  method: "reviewed_provider_evidence" | "reviewed_exact_name" | "unresolved" | "ambiguous";
  evidence: string;
  locked: boolean;
};

/** A name match is a review candidate only; it never resolves an identity by itself. */
export function resolveStoredNbaProviderIdentity(providerPlayerId: string, identities: readonly NbaProviderIdentity[]) {
  const matches = identities.filter(identity => identity.provider === "espn" && identity.providerPlayerId === providerPlayerId);
  if (matches.length !== 1) return { playerId: null, status: "unresolved" as const, reason: "missing_or_conflicting_crosswalk" };
  const identity = matches[0];
  if (identity.status !== "resolved" || identity.playerId === null) {
    return { playerId: null, status: identity.status, reason: identity.evidence };
  }
  return { playerId: identity.playerId, status: "resolved" as const, reason: identity.evidence };
}

export function uniqueExactNameCandidate(providerName: string | null, players: readonly { id: number; name: string }[]) {
  const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  if (!providerName?.trim()) return null;
  const matches = players.filter(player => normalize(player.name) === normalize(providerName));
  return matches.length === 1 ? { playerId: matches[0].id, status: "candidate" as const } : null;
}

export type NbaObservationRecord = {
  provider: "espn"; provider_player_id: string; provider_event_id: string; local_player_id: number | null;
  season: number; phase: "regular"; game_at: string; completed_at: string | null;
  team_provider_id: string | null; team_abbreviation: string | null; opponent_provider_id: string | null;
  opponent_abbreviation: string | null; home_away: "home" | "away" | null;
  minutes: number; points: number; rebounds: number; assists: number; steals: number; blocks: number; turnovers: number;
  source_url: string; provider_fetched_at: string; provider_known_at: string | null;
  normalization_version: typeof NBA_PROJECTION_NORMALIZATION_VERSION; observation_hash: string;
};

export function observationRecordFromNbaObservation(row: NbaObservation, localPlayerId: number | null): NbaObservationRecord | null {
  if (row.provider !== "espn" || row.phase !== "regular" || !modelingEvidence(row).rateEligible || instant(row.gameAt) === null) return null;
  const stats = completeStats(row.stats);
  if (!stats) return null;
  const body = { provider: "espn" as const, provider_player_id: row.providerPlayerId, provider_event_id: row.eventId,
    local_player_id: localPlayerId, season: row.season, phase: "regular" as const, game_at: row.gameAt!, completed_at: row.completedAt,
    team_provider_id: row.team.providerId, team_abbreviation: row.team.abbreviation, opponent_provider_id: row.opponent.providerId,
    opponent_abbreviation: row.opponent.abbreviation, home_away: row.homeAway, minutes: row.minutes!, ...stats,
    source_url: row.provenance.source, provider_fetched_at: row.provenance.fetchedAt, provider_known_at: row.provenance.knownAt,
    normalization_version: NBA_PROJECTION_NORMALIZATION_VERSION as typeof NBA_PROJECTION_NORMALIZATION_VERSION };
  return { ...body, observation_hash: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

export function nbaObservationFromRecord(row: NbaObservationRecord): NbaObservation {
  return { sport: "nba", identity: row.local_player_id === null
    ? { status: "unresolved", canonicalPlayerId: null, reason: "No reviewed ESPN NBA identity" }
    : { status: "resolved", canonicalPlayerId: `111:nba:players:${row.local_player_id}`, evidence: "Stored reviewed ESPN identity" },
  provider: "espn", providerPlayerId: row.provider_player_id, eventId: row.provider_event_id, season: row.season, phase: "regular",
  gameAt: row.game_at, completedAt: row.completed_at, team: { providerId: row.team_provider_id, abbreviation: row.team_abbreviation },
  opponent: { providerId: row.opponent_provider_id, abbreviation: row.opponent_abbreviation }, homeAway: row.home_away,
  gameStatus: "final", finalEvidence: "explicit", participation: "played", minutes: Number(row.minutes), starter: null,
  stats: { points: Number(row.points), rebounds: Number(row.rebounds), assists: Number(row.assists), steals: Number(row.steals), blocks: Number(row.blocks), turnovers: Number(row.turnovers) },
  shooting: { fieldGoalsMade: null, fieldGoalsAttempted: null, freeThrowsMade: null, freeThrowsAttempted: null, threePointersMade: null, threePointersAttempted: null },
  provenance: { source: row.source_url, fetchedAt: row.provider_fetched_at, knownAt: row.provider_known_at }, missing: [] };
}

/** Shared repository selector: only V1's current/prior window and strict pre-asOf history may enter the engine. */
export function selectNbaProjectionHistoryRecords(input: { rows: readonly NbaObservationRecord[]; playerId: number; targetSeason: number; asOf: string }) {
  const cutoff = instant(input.asOf);
  if (cutoff === null) throw new Error('Projection history requires a timezone-bearing asOf instant');
  return input.rows.filter(row => row.local_player_id === input.playerId && (row.season === input.targetSeason || row.season === input.targetSeason - 1)
    && instant(row.game_at) !== null && instant(row.game_at)! < cutoff).slice().sort((a, b) => instant(a.game_at)! - instant(b.game_at)! || a.provider_event_id.localeCompare(b.provider_event_id));
}

export type NbaProjectionStatCacheRecord = {
  player_id: number; model_version: string; as_of: string; generated_at: string;
  projected_stats: NbaStatLine; projected_participation: { expectedMinutes: number };
  confidence: "high" | "medium" | "low"; sample: Record<string, unknown>;
  components?: Record<string, number | string | null>; fallback_reason?: string | null;
  source_latest_game_at: string | null; source_latest_updated_at: string | null;
};

export function statCacheRecordFromProjection(input: { projection: { playerId: string; modelVersion: string; asOf: string; generatedAt: string;
  projectedStats: NbaStatLine; projectedParticipation: { expectedMinutes: number }; confidence: "high" | "medium" | "low";
  sample: Record<string, unknown>; components?: Record<string, number | string | null>; fallbackReason?: string | null }; sourceLatestGameAt: string | null; sourceLatestUpdatedAt: string | null }) : NbaProjectionStatCacheRecord {
  const playerId = Number(input.projection.playerId.replace(/^111:nba:players:/, ""));
  if (!Number.isSafeInteger(playerId) || playerId <= 0) throw new Error("Projection cache requires a canonical local NBA player ID");
  return { player_id: playerId, model_version: input.projection.modelVersion, as_of: input.projection.asOf,
    generated_at: input.projection.generatedAt, projected_stats: input.projection.projectedStats,
    projected_participation: input.projection.projectedParticipation, confidence: input.projection.confidence,
    sample: input.projection.sample, components: input.projection.components ?? {}, fallback_reason: input.projection.fallbackReason ?? null, source_latest_game_at: input.sourceLatestGameAt,
    source_latest_updated_at: input.sourceLatestUpdatedAt };
}

/** Rule-dependent score is intentionally calculated outside the global stat-line cache. */
export function scoreCachedNbaProjection(record: Pick<NbaProjectionStatCacheRecord, "projected_stats">, targetRulesSnapshot: Record<string, unknown> | null, legacyRulesFallback = false) {
  const score = scoreNbaStats(record.projected_stats, targetNbaScoring(targetRulesSnapshot, legacyRulesFallback));
  if (score === null) throw new Error("Cached NBA projected stats are incomplete");
  return score;
}
