import { weightedMedian } from "../statistics";
import { completeStats, instant, type NbaObservation } from "./types";

export function modelingEvidence(row: NbaObservation) {
  const rateEligible = row.gameStatus === "final" && row.participation === "played"
    && row.minutes !== null && Number.isFinite(row.minutes) && row.minutes > 0
    && completeStats(row.stats) !== null && !row.missing.includes("contradictory-dnp");
  return { rateEligible, opportunityMinutes: rateEligible ? row.minutes : null,
    reason: rateEligible ? null : "Requires final played appearance, positive minutes, and complete scoring stats" };
}

/** priorHistory must already have passed observationsAsOf; caller chooses anomaly threshold, not injury diagnosis. */
export function describeParticipation(row: NbaObservation, priorHistory: readonly NbaObservation[], lowRatioThreshold: number) {
  if (!(lowRatioThreshold > 0 && lowRatioThreshold < 1)) throw new Error("Participation threshold must be between 0 and 1");
  const prior = priorHistory.filter(candidate => candidate.provider === row.provider
    && candidate.providerPlayerId === row.providerPlayerId && candidate.eventId !== row.eventId
    && instant(candidate.gameAt) !== null && instant(row.gameAt) !== null && instant(candidate.gameAt)! < instant(row.gameAt)!
    && modelingEvidence(candidate).rateEligible);
  const typicalMinutes = weightedMedian(prior.map(candidate => ({ value: candidate.minutes!, weight: 1 })));
  const ratio = typicalMinutes && row.minutes !== null ? row.minutes / typicalMinutes : null;
  return { ...modelingEvidence(row), typicalMinutes, participationRatio: ratio,
    possibleLowWorkload: ratio === null || prior.length < 3 ? null : ratio < lowRatioThreshold,
    referenceSampleSize: prior.length, cause: "unknown" as const };
}
