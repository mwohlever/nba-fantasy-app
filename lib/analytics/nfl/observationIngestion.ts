import { hashNflObservation, canonicalNflObservationHashPayload, type NflObservation } from "./observationFoundation";
import type { NflGameLogObservation } from "../providers/espnNflGameLog";
import type { NflObservationPosition } from "./observationFoundation";

export type NflEligiblePlayer = { localPlayerId: number; providerPlayerId: string; position: NflObservationPosition };
export type NflFinalEvent = { providerEventId: string; season: number; phase: "regular"; completed: true };
export type NflFumbleEvidence = { providerEventId: string; providerPlayerId: string; sourceUrl: string; fetchedAt: string; fumblesLost: number };

export type NflObservationRecord = {
  provider: "espn"; provider_player_id: string; provider_event_id: string; local_player_id: number | null; position: NflObservationPosition;
  season: number; week: number; phase: "regular"; game_at: string; completed_at: string | null;
  team_provider_id: string; team_abbreviation: string | null; opponent_provider_id: string; opponent_abbreviation: string | null; home_away: "home" | "away" | null;
  completions: number | null; passing_attempts: number | null; passing_yards: number | null; passing_touchdowns: number | null; interceptions: number | null;
  rushing_attempts: number | null; rushing_yards: number | null; rushing_touchdowns: number | null;
  receiving_targets: number | null; receptions: number | null; receiving_yards: number | null; receiving_touchdowns: number | null; fumbles_lost: number | null;
  game_log_source_url: string; game_log_fetched_at: string; fumble_summary_source_url: string | null; fumble_summary_fetched_at: string | null;
  known_at: string; normalization_version: string; observation_hash: string;
};

const supported = new Set<NflObservationPosition>(["QB", "RB", "WR", "TE"]);
export function resolveDirectNflIdentity(input: { providerPlayerId: string; position: string; eligible: readonly NflEligiblePlayer[] }) {
  const matches = input.eligible.filter(player => player.providerPlayerId === input.providerPlayerId && player.position === input.position);
  if (matches.length !== 1) throw new Error(`NFL direct ESPN identity is missing or ambiguous: ${input.providerPlayerId}:${input.position}`);
  return matches[0];
}

/** Final-status eligibility is separate from the athlete log because that payload has no reliable status field. */
export function finalRegularEvent(input: { eventId: string; season: number; events: readonly NflFinalEvent[] }) {
  const matches = input.events.filter(event => event.providerEventId === input.eventId);
  if (matches.length > 1) throw new Error(`Duplicate NFL final-status event evidence: ${input.eventId}`);
  return matches.length === 1 && matches[0].season === input.season && matches[0].phase === "regular" && matches[0].completed;
}

export function buildNflObservation(input: {
  gameLog: NflGameLogObservation; eligible: readonly NflEligiblePlayer[]; finalEvents: readonly NflFinalEvent[];
  fumbles: readonly NflFumbleEvidence[]; knownAt: string; normalizationVersion: string;
}): NflObservation | null {
  const row = input.gameLog;
  if (!supported.has(row.position) || !finalRegularEvent({ eventId: row.eventId, season: row.season, events: input.finalEvents })) return null;
  const identity = resolveDirectNflIdentity({ providerPlayerId: row.providerPlayerId, position: row.position, eligible: input.eligible });
  const matches = input.fumbles.filter(evidence => evidence.providerEventId === row.eventId && evidence.providerPlayerId === row.providerPlayerId);
  if (matches.length > 1) throw new Error(`Duplicate NFL QB fumble evidence: ${row.providerPlayerId}:${row.eventId}`);
  if (row.position === "QB" && matches.length !== 1) throw new Error(`Missing validated NFL QB fumble evidence: ${row.providerPlayerId}:${row.eventId}`);
  const fumble = matches[0] ?? null;
  const observation: NflObservation = {
    provider: "espn", providerPlayerId: row.providerPlayerId, providerEventId: row.eventId, localPlayerId: identity.localPlayerId,
    position: row.position, season: row.season, week: row.week, phase: "regular", gameAt: row.gameAt, completedAt: null,
    team: row.team, opponent: row.opponent, homeAway: row.homeAway,
    stats: { ...row.stats, fumblesLost: row.position === "QB" ? fumble!.fumblesLost : row.stats.fumblesLost },
    provenance: { gameLogSourceUrl: row.provenance.source, gameLogFetchedAt: row.provenance.fetchedAt,
      fumbleSummarySourceUrl: fumble?.sourceUrl ?? null, fumbleSummaryFetchedAt: fumble?.fetchedAt ?? null,
      knownAt: input.knownAt, normalizationVersion: input.normalizationVersion },
  };
  canonicalNflObservationHashPayload(observation);
  if (observation.position === "QB" && (observation.stats.fumblesLost === null || observation.provenance.fumbleSummarySourceUrl === null || observation.provenance.fumbleSummaryFetchedAt === null)) {
    throw new Error("NFL QB observation requires validated fumble-summary evidence");
  }
  if (observation.position !== "QB" && (observation.provenance.fumbleSummarySourceUrl !== null || observation.provenance.fumbleSummaryFetchedAt !== null)) {
    throw new Error("NFL non-QB observation must not carry QB fumble-summary provenance");
  }
  return observation;
}

export function observationRecordFromNflObservation(observation: NflObservation): NflObservationRecord {
  canonicalNflObservationHashPayload(observation);
  const stats = observation.stats, provenance = observation.provenance;
  return { provider: observation.provider, provider_player_id: observation.providerPlayerId, provider_event_id: observation.providerEventId,
    local_player_id: observation.localPlayerId, position: observation.position, season: observation.season, week: observation.week, phase: observation.phase,
    game_at: observation.gameAt, completed_at: observation.completedAt, team_provider_id: observation.team.providerId, team_abbreviation: observation.team.abbreviation,
    opponent_provider_id: observation.opponent.providerId, opponent_abbreviation: observation.opponent.abbreviation, home_away: observation.homeAway,
    completions: stats.completions, passing_attempts: stats.passingAttempts, passing_yards: stats.passingYards, passing_touchdowns: stats.passingTouchdowns, interceptions: stats.interceptions,
    rushing_attempts: stats.rushingAttempts, rushing_yards: stats.rushingYards, rushing_touchdowns: stats.rushingTouchdowns, receiving_targets: stats.receivingTargets,
    receptions: stats.receptions, receiving_yards: stats.receivingYards, receiving_touchdowns: stats.receivingTouchdowns, fumbles_lost: stats.fumblesLost,
    game_log_source_url: provenance.gameLogSourceUrl, game_log_fetched_at: provenance.gameLogFetchedAt, fumble_summary_source_url: provenance.fumbleSummarySourceUrl,
    fumble_summary_fetched_at: provenance.fumbleSummaryFetchedAt, known_at: provenance.knownAt, normalization_version: provenance.normalizationVersion,
    observation_hash: hashNflObservation(observation) };
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const nullableString = (value: unknown): string | null => value === null ? null : string(value);
const integer = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const nullableInteger = (value: unknown): number | null => value === null ? null : integer(value);

/** Parse only the worker's normalized wire contract; server recomputes its hash. */
export function nflObservationFromUnknown(value: unknown): NflObservation {
  const row = object(value), stats = object(row.stats), provenance = object(row.provenance), team = object(row.team), opponent = object(row.opponent);
  const requiredString = (label: string, raw: unknown) => { const result = string(raw); if (result === null) throw new Error(`NFL observation ${label} must be a string`); return result; };
  const requiredInteger = (label: string, raw: unknown) => { const result = integer(raw); if (result === null) throw new Error(`NFL observation ${label} must be an integer`); return result; };
  const stat = (label: string) => { const result = nullableInteger(stats[label]); if (result === null && stats[label] !== null) throw new Error(`NFL observation stat ${label} must be an integer or null`); return result; };
  const position = requiredString("position", row.position);
  const homeAway = row.homeAway === null ? null : requiredString("homeAway", row.homeAway);
  const observation: NflObservation = {
    provider: requiredString("provider", row.provider) as "espn", providerPlayerId: requiredString("providerPlayerId", row.providerPlayerId),
    providerEventId: requiredString("providerEventId", row.providerEventId), localPlayerId: row.localPlayerId === null ? null : requiredInteger("localPlayerId", row.localPlayerId),
    position: position as NflObservationPosition, season: requiredInteger("season", row.season), week: requiredInteger("week", row.week),
    phase: requiredString("phase", row.phase) as "regular", gameAt: requiredString("gameAt", row.gameAt), completedAt: nullableString(row.completedAt),
    team: { providerId: requiredString("team.providerId", team.providerId), abbreviation: nullableString(team.abbreviation) },
    opponent: { providerId: requiredString("opponent.providerId", opponent.providerId), abbreviation: nullableString(opponent.abbreviation) },
    homeAway: homeAway as "home" | "away" | null,
    stats: { completions: stat("completions"), passingAttempts: stat("passingAttempts"), passingYards: stat("passingYards"), passingTouchdowns: stat("passingTouchdowns"), interceptions: stat("interceptions"), rushingAttempts: stat("rushingAttempts"), rushingYards: stat("rushingYards"), rushingTouchdowns: stat("rushingTouchdowns"), receivingTargets: stat("receivingTargets"), receptions: stat("receptions"), receivingYards: stat("receivingYards"), receivingTouchdowns: stat("receivingTouchdowns"), fumblesLost: stat("fumblesLost") },
    provenance: { gameLogSourceUrl: requiredString("provenance.gameLogSourceUrl", provenance.gameLogSourceUrl), gameLogFetchedAt: requiredString("provenance.gameLogFetchedAt", provenance.gameLogFetchedAt), fumbleSummarySourceUrl: nullableString(provenance.fumbleSummarySourceUrl), fumbleSummaryFetchedAt: nullableString(provenance.fumbleSummaryFetchedAt), knownAt: requiredString("provenance.knownAt", provenance.knownAt), normalizationVersion: requiredString("provenance.normalizationVersion", provenance.normalizationVersion) },
  };
  canonicalNflObservationHashPayload(observation);
  return observation;
}
