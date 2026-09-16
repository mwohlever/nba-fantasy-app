import { createHash } from "node:crypto";

export const NFL_OBSERVATION_NORMALIZATION_VERSION = "espn_nfl_gamelog_fumbles_v1";

export type NflObservationPosition = "QB" | "RB" | "WR" | "TE";
export type NflObservationStats = {
  completions: number | null;
  passingAttempts: number | null;
  passingYards: number | null;
  passingTouchdowns: number | null;
  interceptions: number | null;
  rushingAttempts: number | null;
  rushingYards: number | null;
  rushingTouchdowns: number | null;
  receivingTargets: number | null;
  receptions: number | null;
  receivingYards: number | null;
  receivingTouchdowns: number | null;
  fumblesLost: number | null;
};

/** Normalized factual evidence. Provenance is intentionally outside its content hash. */
export type NflObservation = {
  provider: "espn";
  providerPlayerId: string;
  providerEventId: string;
  localPlayerId: number | null;
  position: NflObservationPosition;
  season: number;
  week: number;
  phase: "regular";
  gameAt: string;
  completedAt: string | null;
  team: { providerId: string; abbreviation: string | null };
  opponent: { providerId: string; abbreviation: string | null };
  homeAway: "home" | "away" | null;
  stats: NflObservationStats;
  provenance: {
    gameLogSourceUrl: string;
    gameLogFetchedAt: string;
    fumbleSummarySourceUrl: string | null;
    fumbleSummaryFetchedAt: string | null;
    knownAt: string;
    normalizationVersion: string;
  };
};

const STAT_KEYS = [
  "completions", "passingAttempts", "passingYards", "passingTouchdowns", "interceptions",
  "rushingAttempts", "rushingYards", "rushingTouchdowns", "receivingTargets", "receptions",
  "receivingYards", "receivingTouchdowns", "fumblesLost",
] as const;

function requiredNumericId(label: string, value: string) {
  if (!/^\d+$/.test(value)) throw new Error(`NFL observation requires numeric ${label}`);
  return value;
}
function validStat(value: number | null) {
  return value === null || Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

/**
 * Fixed-key-order factual payload used for version identity. Do not add fetch,
 * known, or creation timestamps: those are acquisition metadata, not facts.
 */
export function canonicalNflObservationHashPayload(row: NflObservation) {
  if (row.provider !== "espn") throw new Error("NFL observation provider must be ESPN");
  if (!(["QB", "RB", "WR", "TE"] as const).includes(row.position)) throw new Error("NFL observation position must be QB/RB/WR/TE");
  requiredNumericId("provider player ID", row.providerPlayerId);
  requiredNumericId("provider event ID", row.providerEventId);
  requiredNumericId("team provider ID", row.team.providerId);
  requiredNumericId("opponent provider ID", row.opponent.providerId);
  if (!Number.isInteger(row.season) || !Number.isInteger(row.week)) throw new Error("NFL observation requires integer season/week");
  if (row.localPlayerId !== null && (!Number.isSafeInteger(row.localPlayerId) || row.localPlayerId <= 0)) throw new Error("Invalid local NFL player ID");
  if ((row.provenance.fumbleSummarySourceUrl === null) !== (row.provenance.fumbleSummaryFetchedAt === null)) throw new Error("NFL fumble provenance URL/timestamp must be paired");
  for (const key of STAT_KEYS) if (!validStat(row.stats[key])) throw new Error(`Invalid NFL factual stat: ${key}`);
  return {
    provider: row.provider,
    providerPlayerId: row.providerPlayerId,
    providerEventId: row.providerEventId,
    localPlayerId: row.localPlayerId,
    position: row.position,
    season: row.season,
    week: row.week,
    phase: row.phase,
    gameAt: row.gameAt,
    completedAt: row.completedAt,
    teamProviderId: row.team.providerId,
    teamAbbreviation: row.team.abbreviation,
    opponentProviderId: row.opponent.providerId,
    opponentAbbreviation: row.opponent.abbreviation,
    homeAway: row.homeAway,
    stats: Object.fromEntries(STAT_KEYS.map(key => [key, row.stats[key]])),
    normalizationVersion: row.provenance.normalizationVersion,
  };
}

export function hashNflObservation(row: NflObservation) {
  return createHash("sha256").update(JSON.stringify(canonicalNflObservationHashPayload(row))).digest("hex");
}
