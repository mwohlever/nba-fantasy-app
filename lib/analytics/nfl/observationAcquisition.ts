import { NFL_OBSERVATION_NORMALIZATION_VERSION, nflSignedYardInputs, type NflObservation } from "./observationFoundation";
import { buildNflObservation, type NflEligiblePlayer, type NflFinalEvent, type NflFumbleEvidence } from "./observationIngestion";
import type { NflGameLogObservation } from "../providers/espnNflGameLog";

type FumbleSummary = { eventId: string; source: string; fetchedAt: string; athletes: Array<{ providerPlayerId: string; fumblesLost: number }>; zeroEligibleTeams?: string[];
  conflictedPlayerIds?: string[]; athleteTeams?: Record<string, string>; season?: number | null; phase?: number | null; final?: boolean };

export type NflObservationAcquisition = {
  eligible: readonly NflEligiblePlayer[];
  season: number;
  finalEvents: readonly NflFinalEvent[];
  gameLogs: readonly NflGameLogObservation[];
  fetchFumbles: (eventId: string) => Promise<FumbleSummary>;
  onIncomplete?: (issue: { eventId: string; providerPlayerId: string; reason: string; values?: Record<string, number> }) => void;
};

/**
 * Builds complete factual rows only after final-state and QB LOST evidence are
 * both available. A summary is fetched once per final QB event, never per QB.
 */
export async function acquireNflObservations(input: NflObservationAcquisition) {
  const finalIds = new Set(input.finalEvents.filter(event => event.season === input.season && event.completed).map(event => event.providerEventId));
  const eligibleById = new Map(input.eligible.map(player => [player.providerPlayerId, player]));
  const logs = input.gameLogs.filter(row => row.season === input.season && eligibleById.has(row.providerPlayerId) && finalIds.has(row.eventId));
  const qbEventIds = [...new Set(logs.filter(row => row.position === "QB").map(row => row.eventId))].sort((a, b) => Number(a) - Number(b));
  const fumbles: NflFumbleEvidence[] = [];
  const unknownQbs = new Set<string>();
  for (const eventId of qbEventIds) {
    let summary: FumbleSummary;
    try { summary = await input.fetchFumbles(eventId); }
    catch {
      // A bad/unavailable event does not discard independently validated facts
      // elsewhere in the cohort. Unknown QB rows remain explicitly incomplete.
      for (const qb of logs.filter(row => row.position === "QB" && row.eventId === eventId && row.stats.fumblesLost === null)) {
        unknownQbs.add(`${eventId}:${qb.providerPlayerId}`);
        input.onIncomplete?.({ eventId, providerPlayerId: qb.providerPlayerId, reason: "fumbles_summary_unavailable" });
      }
      continue;
    }
    if (summary.eventId !== eventId) throw new Error(`NFL fumble summary identity mismatch: ${eventId}`);
    const contextValid = (summary.season === undefined || summary.season === input.season) &&
      (summary.phase === undefined || summary.phase === 2) && summary.final !== false;
    // Absence only establishes zero when this QB's team category was independently
    // reconciled. An omitted group/empty unverified list remains unknown.
    for (const qb of logs.filter(row => row.position === "QB" && row.eventId === eventId)) {
      const matches = summary.athletes.filter(a => a.providerPlayerId === qb.providerPlayerId);
      const summaryValue = matches.length === 1 ? matches[0].fumblesLost : summary.zeroEligibleTeams?.includes(qb.team.providerId ?? "") ? 0 : null;
      const conflict = matches.length > 1 || summary.conflictedPlayerIds?.includes(qb.providerPlayerId) ||
        summary.athleteTeams?.[qb.providerPlayerId] !== undefined && summary.athleteTeams[qb.providerPlayerId] !== qb.team.providerId ||
        qb.stats.fumblesLost !== null && summaryValue !== null && qb.stats.fumblesLost !== summaryValue;
      if (!contextValid || conflict || summaryValue === null && qb.stats.fumblesLost === null) {
        unknownQbs.add(`${eventId}:${qb.providerPlayerId}`);
        input.onIncomplete?.({ eventId, providerPlayerId: qb.providerPlayerId,
          reason: !contextValid ? "fumbles_summary_context_unknown_or_conflicting" : conflict ? "fumbles_lost_conflicting" : "fumbles_lost_unknown" });
      } else if (summaryValue !== null) {
        fumbles.push({ providerEventId: eventId, providerPlayerId: qb.providerPlayerId, sourceUrl: summary.source, fetchedAt: summary.fetchedAt, fumblesLost: summaryValue });
      }
    }
  }
  // All game-log and (where required) summary requests have completed before
  // this factual version becomes known to this system.
  const knownAt = new Date().toISOString();
  const observations: NflObservation[] = [];
  for (const gameLog of logs) {
    if (unknownQbs.has(`${gameLog.eventId}:${gameLog.providerPlayerId}`)) continue;
    const signed = nflSignedYardInputs(gameLog.stats);
    if (Object.keys(signed).length) {
      input.onIncomplete?.({ eventId: gameLog.eventId, providerPlayerId: gameLog.providerPlayerId,
        reason: "signed_yards_storage_review_required", values: signed });
      continue; // Explicit quarantine until the prepared SQL/storage contract is reviewed.
    }
    const observation = buildNflObservation({ gameLog, eligible: input.eligible, finalEvents: input.finalEvents, fumbles, knownAt, normalizationVersion: NFL_OBSERVATION_NORMALIZATION_VERSION });
    if (observation) observations.push(observation);
  }
  return observations.sort((left, right) => left.gameAt.localeCompare(right.gameAt) || Number(left.providerPlayerId) - Number(right.providerPlayerId) || Number(left.providerEventId) - Number(right.providerEventId));
}
