import { effectiveSampleSize, recencyWeight, weightedMean, weightedRatioOfTotals } from "../statistics";
import { modelingEvidence } from "./participation";
import { scoreNbaStats, targetNbaScoring } from "./scoring";
import { NBA_STATS, instant, type NbaObservation, type NbaProvider, type NbaStatLine } from "./types";

export const NBA_PROJECTION_V1 = "nba_projection_v1" as const;

export type ProjectionConfidence = "high" | "medium" | "low";

export type NbaProjectionSample = {
  currentGames: number;
  priorGames: number;
  currentMinutes: number;
  priorMinutes: number;
  effectiveSampleSize: number | null;
  priorAvailable: boolean;
  lowWorkload: boolean;
  roleChange: boolean;
  fallbackReason: string | null;
};

export type NbaProjectionResult = {
  playerId: string;
  sport: "nba";
  modelVersion: typeof NBA_PROJECTION_V1;
  generatedAt: string;
  asOf: string;
  projectedScore: number;
  projectedStats: NbaStatLine;
  projectedParticipation: { expectedMinutes: number };
  confidence: ProjectionConfidence;
  sample: NbaProjectionSample;
};

/**
 * Inputs are provider-scoped deliberately: a local NBA player ID is not proof of
 * an ESPN identity. `observations` may contain other players/seasons; the engine
 * filters it and never uses an observation at or after `asOf`.
 *
 * The caller remains responsible for supplying a point-in-time-valid observation
 * set when historical reproducibility matters (for example through
 * observationsAsOf). This pure engine does not fetch or persist anything.
 */
export type NbaProjectionV1Input = {
  playerId: string;
  provider: NbaProvider;
  providerPlayerId: string;
  targetSeason: number;
  asOf: string;
  /** Defaults to asOf so identical inputs always produce identical output. */
  generatedAt?: string;
  targetRulesSnapshot: Record<string, unknown> | null;
  observations: readonly NbaObservation[];
  /** Only for explicit legacy slate callers; production slates should be frozen. */
  legacyRulesFallback?: boolean;
};

function assertInput(input: NbaProjectionV1Input) {
  if (!input.playerId || !input.providerPlayerId || !Number.isInteger(input.targetSeason)) {
    throw new Error("Projection needs player identity and target season");
  }
  if (instant(input.asOf) === null) throw new Error("Projection needs a timezone-bearing asOf instant");
  if (input.generatedAt !== undefined && instant(input.generatedAt) === null) {
    throw new Error("generatedAt must be a timezone-bearing instant");
  }
}

function eligibleHistory(input: NbaProjectionV1Input) {
  const cutoff = instant(input.asOf)!;
  return input.observations.filter(row => row.provider === input.provider
    && row.providerPlayerId === input.providerPlayerId
    && row.phase === "regular"
    && instant(row.gameAt) !== null
    && instant(row.gameAt)! < cutoff
    && modelingEvidence(row).rateEligible)
    .slice()
    .sort((a, b) => instant(a.gameAt)! - instant(b.gameAt)! || a.eventId.localeCompare(b.eventId));
}

function meanMinutes(rows: readonly NbaObservation[]) {
  return weightedMean(rows.map(row => ({ value: row.minutes!, weight: 1 })));
}

function rate(rows: readonly NbaObservation[], key: typeof NBA_STATS[number]) {
  return weightedRatioOfTotals(rows.map(row => ({
    production: row.stats[key]!, opportunity: row.minutes!, weight: 1,
  })));
}

function rates(rows: readonly NbaObservation[]) {
  if (!rows.length) return null;
  const seasonMinutes = rows.reduce((sum, row) => sum + row.minutes!, 0);
  if (seasonMinutes <= 0) return null;
  const recent = rows.slice(-5);
  const result = {} as NbaStatLine;
  for (const key of NBA_STATS) {
    const seasonRate = rate(rows, key)!;
    const recentRate = rate(recent, key)!;
    result[key] = 0.75 * seasonRate + 0.25 * recentRate;
  }
  return { rates: result, minutes: seasonMinutes };
}

function expectedMinutes(current: readonly NbaObservation[], prior: readonly NbaObservation[]) {
  const priorMinutes = meanMinutes(prior.slice(-8));
  if (!current.length) return priorMinutes;
  const recent = current.slice(-8);
  const weights = recent.map((_row, index) => recencyWeight(recent.length - 1 - index, 3));
  const w8 = weightedMean(recent.map((row, index) => ({ value: row.minutes!, weight: weights[index] })))!;
  const season = meanMinutes(current)!;
  const currentEstimate = 0.8 * w8 + 0.2 * season;
  if (priorMinutes === null) return currentEstimate;
  const share = current.length === 1 ? 0.25
    : current.length === 2 ? 0.4
      : current.length === 3 ? 0.6
        : current.length === 4 ? 0.75 : 1;
  return share * currentEstimate + (1 - share) * priorMinutes;
}

function workloadSignals(current: readonly NbaObservation[]) {
  if (current.length < 4) return { lowWorkload: false, roleChange: false };
  const last = current.at(-1)!;
  const reference = current.slice(-6, -1);
  const referenceMinutes = meanMinutes(reference)!;
  const lowWorkload = last.minutes! < referenceMinutes * 0.5;
  if (current.length < 6) return { lowWorkload, roleChange: false };
  const recentThree = current.slice(-3);
  const before = current.slice(-8, -3);
  const beforeMinutes = meanMinutes(before)!;
  const roleChange = recentThree.every(row => row.minutes! < beforeMinutes * 0.65)
    || recentThree.every(row => row.minutes! > beforeMinutes * 1.35);
  return { lowWorkload, roleChange };
}

function confidence(input: {
  currentGames: number; priorAvailable: boolean; effectiveGames: number;
  lowWorkload: boolean; roleChange: boolean;
}): ProjectionConfidence {
  if (input.currentGames <= 2 || (!input.priorAvailable && input.currentGames < 5)
    || input.effectiveGames < 2 || input.lowWorkload || input.roleChange) return "low";
  if (input.currentGames >= 8 && input.effectiveGames >= 4) return "high";
  return "medium";
}

/**
 * Pure NBA projection V1. It intentionally has no provider calls, storage,
 * availability forecast, roster effect, or live-scoring side effect.
 */
export function projectNbaV1(input: NbaProjectionV1Input): NbaProjectionResult | null {
  assertInput(input);
  const history = eligibleHistory(input);
  const current = history.filter(row => row.season === input.targetSeason);
  const prior = history.filter(row => row.season === input.targetSeason - 1);
  const currentRates = rates(current);
  const priorRates = rates(prior);
  const expected = expectedMinutes(current, prior);
  if (expected === null || (!currentRates && !priorRates)) return null;

  const projectedRates = {} as NbaStatLine;
  if (!currentRates) {
    Object.assign(projectedRates, priorRates!.rates);
  } else if (!priorRates) {
    Object.assign(projectedRates, currentRates.rates);
  } else {
    const priorEquivalentMinutes = Math.min(priorRates.minutes, 300);
    for (const key of NBA_STATS) {
      projectedRates[key] = (currentRates.minutes * currentRates.rates[key]
        + priorEquivalentMinutes * priorRates.rates[key]) / (currentRates.minutes + priorEquivalentMinutes);
    }
  }

  const projectedStats = Object.fromEntries(NBA_STATS.map(key => [key, expected * projectedRates[key]])) as NbaStatLine;
  const scoring = targetNbaScoring(input.targetRulesSnapshot, input.legacyRulesFallback === true);
  const projectedScore = scoreNbaStats(projectedStats, scoring);
  if (projectedScore === null) throw new Error("Complete projected NBA stats must be scoreable");

  const recent = current.slice(-8);
  const effectiveGames = recent.length
    ? effectiveSampleSize(recent.map((_row, index) => recencyWeight(recent.length - 1 - index, 3)))
    : 0;
  const signals = workloadSignals(current);
  const priorAvailable = priorRates !== null;
  const fallbackReason = !currentRates ? "Current-season evidence unavailable; prior-season bridge used"
    : !priorAvailable ? "No usable prior-season NBA history"
      : current.length < 5 ? "Sparse current-season evidence blended with prior season" : null;

  return {
    playerId: input.playerId,
    sport: "nba",
    modelVersion: NBA_PROJECTION_V1,
    generatedAt: input.generatedAt ?? input.asOf,
    asOf: input.asOf,
    projectedScore,
    projectedStats,
    projectedParticipation: { expectedMinutes: expected },
    confidence: confidence({ currentGames: current.length, priorAvailable, effectiveGames,
      lowWorkload: signals.lowWorkload, roleChange: signals.roleChange }),
    sample: {
      currentGames: current.length,
      priorGames: prior.length,
      currentMinutes: currentRates?.minutes ?? 0,
      priorMinutes: priorRates?.minutes ?? 0,
      effectiveSampleSize: recent.length ? effectiveGames : null,
      priorAvailable,
      lowWorkload: signals.lowWorkload,
      roleChange: signals.roleChange,
      fallbackReason,
    },
  };
}
