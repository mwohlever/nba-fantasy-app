import { NFL_OBSERVATION_NORMALIZATION_VERSION, type NflObservation } from "./observationFoundation";
import { buildNflObservation, type NflEligiblePlayer, type NflFinalEvent, type NflFumbleEvidence } from "./observationIngestion";
import type { NflGameLogObservation } from "../providers/espnNflGameLog";

type FumbleSummary = { eventId: string; source: string; fetchedAt: string; athletes: Array<{ providerPlayerId: string; fumblesLost: number }> };

export type NflObservationAcquisition = {
  eligible: readonly NflEligiblePlayer[];
  season: number;
  finalEvents: readonly NflFinalEvent[];
  gameLogs: readonly NflGameLogObservation[];
  fetchFumbles: (eventId: string) => Promise<FumbleSummary>;
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
  for (const eventId of qbEventIds) {
    const summary = await input.fetchFumbles(eventId);
    if (summary.eventId !== eventId) throw new Error(`NFL fumble summary identity mismatch: ${eventId}`);
    for (const athlete of summary.athletes) fumbles.push({ providerEventId: eventId, providerPlayerId: athlete.providerPlayerId, sourceUrl: summary.source, fetchedAt: summary.fetchedAt, fumblesLost: athlete.fumblesLost });
    // A QB absent from this validated summary becomes a factual zero only here.
    for (const qb of logs.filter(row => row.position === "QB" && row.eventId === eventId)) {
      if (!summary.athletes.some(athlete => athlete.providerPlayerId === qb.providerPlayerId)) fumbles.push({ providerEventId: eventId, providerPlayerId: qb.providerPlayerId, sourceUrl: summary.source, fetchedAt: summary.fetchedAt, fumblesLost: 0 });
    }
  }
  // All game-log and (where required) summary requests have completed before
  // this factual version becomes known to this system.
  const knownAt = new Date().toISOString();
  const observations: NflObservation[] = [];
  for (const gameLog of logs) {
    const observation = buildNflObservation({ gameLog, eligible: input.eligible, finalEvents: input.finalEvents, fumbles, knownAt, normalizationVersion: NFL_OBSERVATION_NORMALIZATION_VERSION });
    if (observation) observations.push(observation);
  }
  return observations.sort((left, right) => left.gameAt.localeCompare(right.gameAt) || Number(left.providerPlayerId) - Number(right.providerPlayerId) || Number(left.providerEventId) - Number(right.providerEventId));
}
