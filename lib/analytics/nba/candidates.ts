import { effectiveSampleSize, recencyWeight, weightedMean, weightedMedian, weightedRatioOfTotals } from "../statistics";
import type { PredictionContext, ProjectionCandidate } from "./backtest";
import { modelingEvidence } from "./participation";
import { scoreNbaStats } from "./scoring";
import { NBA_STATS, instant, type NbaObservation, type NbaStatLine } from "./types";

export type MinutesConfig = {
  kind: "median" | "weighted-mean" | "weighted-median" | "blend" | "robust";
  window: number;
  halfLife?: number;
  recentShare?: number;
  lowRatio?: number;
  lowInfluence?: number;
  adapt?: boolean;
};
export type RateConfig = {
  kind: "season" | "recent" | "weighted" | "blend";
  window?: number;
  halfLife?: number;
  recentShare?: number;
  /** Pseudo-minutes from disjoint older current history, otherwise previous season. */
  priorMinutes?: number;
  rareStatPriorMultiplier?: number;
};
export type NbaCandidateConfig = {
  id: string;
  minutes: MinutesConfig;
  rates: RateConfig;
  priorFallback: boolean;
  sparseMinutesPrior?: boolean;
};
const mean = (values: number[]) => weightedMean(values.map(value => ({ value, weight: 1 })))!;
const median = (values: number[]) => weightedMedian(values.map(value => ({ value, weight: 1 })))!;

function checkWindow(value: number | undefined) {
  if (!Number.isInteger(value) || value! < 1) throw new Error("Positive integer window required");
}
export function validateCandidate(config: NbaCandidateConfig) {
  if (!config.id) throw new Error("Candidate needs a reproducible ID");
  checkWindow(config.minutes.window);
  if (!["median", "weighted-mean", "weighted-median", "blend", "robust"].includes(config.minutes.kind)) throw new Error("Unknown minutes estimator");
  if (!["season", "recent", "weighted", "blend"].includes(config.rates.kind)) throw new Error("Unknown rate estimator");
  if (config.rates.kind !== "season") checkWindow(config.rates.window);
  for (const value of [config.minutes.halfLife, config.rates.halfLife]) if (value !== undefined) recencyWeight(0, value);
  if (config.minutes.kind !== "median" && config.minutes.halfLife === undefined) throw new Error("Minutes estimator needs half-life");
  if (config.rates.kind === "weighted" && config.rates.halfLife === undefined) throw new Error("Rate estimator needs half-life");
  for (const value of [config.minutes.recentShare, config.rates.recentShare, config.minutes.lowInfluence]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error("Invalid blend/influence");
  }
  if (config.minutes.kind === "blend" && config.minutes.recentShare === undefined
    || config.rates.kind === "blend" && config.rates.recentShare === undefined) throw new Error("Blend share required");
  if (config.minutes.kind === "robust" && (!(config.minutes.lowRatio! > 0 && config.minutes.lowRatio! < 1)
    || config.minutes.lowInfluence === undefined)) throw new Error("Explicit low-workload parameters required");
  for (const value of [config.rates.priorMinutes, config.rates.rareStatPriorMultiplier]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error("Invalid rate prior");
  }
}

/** Ordered, already-as-of player observations only. Never classifies an injury. */
export function estimateMinutes(history: readonly NbaObservation[], config: MinutesConfig) {
  const recent = history.slice(-config.window);
  if (!recent.length) return null;
  let downweighted = 0;
  const weights = recent.map((row, i) => {
    let weight = config.halfLife === undefined ? 1 : recencyWeight(recent.length - 1 - i, config.halfLife);
    if (config.kind === "robust") {
      const index = history.length - recent.length + i;
      const preceding = history.slice(Math.max(0, index - 5), index);
      if (preceding.length >= 3 && row.minutes! < median(preceding.map(x => x.minutes!)) * config.lowRatio!) {
        weight *= config.lowInfluence!;
        downweighted++;
      }
    }
    return weight;
  });
  const values = recent.map((row, i) => ({ value: row.minutes!, weight: weights[i] }));
  let minutes = config.kind === "median" || config.kind === "weighted-median"
    ? weightedMedian(values)! : weightedMean(values)!;
  if (config.kind === "blend") minutes = config.recentShare! * minutes + (1 - config.recentShare!) * mean(history.map(row => row.minutes!));
  let roleChange = "none";
  if (config.kind === "robust" && config.adapt && history.length >= 6) {
    const last = history.slice(-3), before = history.slice(-11, -3);
    const reference = median(before.map(row => row.minutes!));
    if (last.every(row => row.minutes! < reference * 0.65)) roleChange = "sustained-lower-workload";
    else if (last.every(row => row.minutes! > reference * 1.35)) roleChange = "sustained-higher-workload";
    if (roleChange !== "none") minutes = weightedMean(last.map((row, i) => ({ value: row.minutes!, weight: recencyWeight(2 - i, 2) })))!;
  }
  return { minutes, sample: recent.length, downweighted, roleChange, effectiveGames: effectiveSampleSize(weights) };
}

function ratesFor(rows: readonly NbaObservation[], weights: readonly number[]): NbaStatLine {
  return Object.fromEntries(NBA_STATS.map(key => [key, weightedRatioOfTotals(rows.map((row, i) => ({
    production: row.stats[key]!, opportunity: row.minutes!, weight: weights[i],
  })))!])) as NbaStatLine;
}

export function estimateRates(history: readonly NbaObservation[], previousSeason: readonly NbaObservation[], config: RateConfig) {
  const sample = config.kind === "season" ? [...history] : history.slice(-config.window!);
  if (!sample.length) return null;
  const weights = sample.map((_row, i) => config.kind === "weighted" ? recencyWeight(sample.length - 1 - i, config.halfLife!) : 1);
  const rates = ratesFor(sample, weights);
  if (config.kind === "blend") {
    const seasonRates = ratesFor(history, history.map(() => 1));
    for (const key of NBA_STATS) rates[key] = config.recentShare! * rates[key] + (1 - config.recentShare!) * seasonRates[key];
  }
  const used = new Set(sample.map(row => row.eventId));
  const older = history.filter(row => !used.has(row.eventId));
  const prior = older.length ? older : previousSeason;
  const supportMinutes = sample.reduce((sum, row, i) => sum + row.minutes! * weights[i], 0);
  let priorSource = "none";
  if (config.priorMinutes && prior.length) {
    const priorRates = ratesFor(prior, prior.map(() => 1));
    const availablePriorMinutes = prior.reduce((sum, row) => sum + row.minutes!, 0);
    priorSource = older.length ? "older-current-season" : "previous-season";
    for (const key of NBA_STATS) {
      const multiplier = key === "steals" || key === "blocks" ? config.rareStatPriorMultiplier ?? 1 : 1;
      const pseudoMinutes = Math.min(availablePriorMinutes, config.priorMinutes * multiplier);
      rates[key] = (supportMinutes * rates[key] + pseudoMinutes * priorRates[key]) / (supportMinutes + pseudoMinutes);
    }
  }
  return { rates, sample: sample.length, supportMinutes, effectiveGames: effectiveSampleSize(weights), priorSource };
}

export function workloadContext(history: readonly NbaObservation[], asOf: string) {
  const recent = history.slice(-8), precedingLast = history.slice(-9, -1);
  const typical = recent.length ? median(recent.map(row => row.minutes!)) : null;
  const deviation = typical === null ? null : median(recent.map(row => Math.abs(row.minutes! - typical)));
  const last = history.at(-1);
  const previousTypical = precedingLast.length >= 3 ? median(precedingLast.map(row => row.minutes!)) : null;
  return { typical, deviation,
    daysSinceLast: last ? (instant(asOf)! - instant(last.gameAt)!) / 86_400_000 : null,
    lastMinutes: last?.minutes ?? null,
    lowWorkloadSignal: !!last && previousTypical !== null && last.minutes! < previousTypical * 0.5 };
}

/** Confidence changes metadata only; it never discounts expected performance. */
export function candidateConfidence(input: {
  currentGames: number; effectiveGames: number; daysSinceLast: number | null;
  minuteDeviation: number | null; roleChange: string; lowWorkloadSignal: boolean; usedFallback: boolean;
}): "high" | "medium" | "low" {
  if (input.currentGames < 5 || input.effectiveGames < 3 || input.daysSinceLast === null || input.daysSinceLast > 21
    || input.roleChange !== "none" || input.usedFallback || input.lowWorkloadSignal) return "low";
  if (input.currentGames >= 15 && input.effectiveGames >= 8 && input.daysSinceLast <= 7 && input.minuteDeviation !== null
    && input.minuteDeviation <= 3) return "high";
  return "medium";
}

export function createNbaCandidate(configuration: NbaCandidateConfig): ProjectionCandidate {
  const config = structuredClone(configuration);
  validateCandidate(config);
  return (context: PredictionContext) => {
    const eligible = context.history.filter(row => row.provider === context.target.provider
      && row.providerPlayerId === context.target.providerPlayerId && row.phase === context.target.phase && modelingEvidence(row).rateEligible);
    const current = eligible.filter(row => row.season === context.target.season);
    const previous = eligible.filter(row => row.season === context.target.season - 1
      && instant(context.target.asOf)! - instant(row.gameAt)! <= 370 * 86_400_000);
    let used = current, fallbackReason: string | null = null;
    if (!current.length) {
      if (!config.priorFallback || !previous.length
        || instant(context.target.asOf)! - instant(previous.at(-1)!.gameAt)! > 240 * 86_400_000) return null;
      used = previous;
      fallbackReason = "Previous-season player history; current role unverified";
    }
    const minutes = estimateMinutes(used, config.minutes)!;
    if (config.sparseMinutesPrior && current.length > 0 && current.length < 5 && previous.length) {
      const priorMinutes = median(previous.slice(-8).map(row => row.minutes!));
      const currentShare = current.length / (current.length + 3);
      minutes.minutes = currentShare * minutes.minutes + (1 - currentShare) * priorMinutes;
      fallbackReason = "Sparse current workload blended with previous season";
    }
    const production = estimateRates(used, used === previous ? [] : previous, config.rates)!;
    const projectedStats = Object.fromEntries(NBA_STATS.map(key => [key, minutes.minutes * production.rates[key]])) as NbaStatLine;
    const workload = workloadContext(used, context.target.asOf);
    return {
      expectedMinutes: minutes.minutes, statRatesPerMinute: production.rates, projectedStats,
      projectedFantasyPoints: scoreNbaStats(projectedStats, context.scoring)!,
      confidence: candidateConfidence({ currentGames: current.length, effectiveGames: Math.min(minutes.effectiveGames, production.effectiveGames),
        daysSinceLast: workload.daysSinceLast, minuteDeviation: workload.deviation, roleChange: minutes.roleChange,
        lowWorkloadSignal: workload.lowWorkloadSignal, usedFallback: fallbackReason !== null }),
      fallbackReason,
      components: { minutesSample: minutes.sample, productionSample: production.sample, currentSeasonGames: current.length,
        previousSeasonGames: previous.length, supportMinutes: production.supportMinutes, productionESS: production.effectiveGames,
        minutesESS: minutes.effectiveGames, typicalMinutes: workload.typical, minuteMAD: workload.deviation,
        lastMinutes: workload.lastMinutes, daysSinceLast: workload.daysSinceLast, lowWorkloadSignal: workload.lowWorkloadSignal ? "yes" : "no",
        downweightedMinuteGames: minutes.downweighted, workloadChange: minutes.roleChange, ratePrior: production.priorSource },
      modelVersion: config.id, asOf: context.target.asOf,
    };
  };
}

/** Fixed one-component-at-a-time tournament, not a Cartesian brute-force search. */
export function nbaCandidateTournament(): NbaCandidateConfig[] {
  const minutes: [string, MinutesConfig][] = [
    ...[5, 8, 10].map(window => [`median${window}`, { kind: "median", window }] as [string, MinutesConfig]),
    ["mean5h2", { kind: "weighted-mean", window: 5, halfLife: 2 }],
    ["mean10h3", { kind: "weighted-mean", window: 10, halfLife: 3 }],
    ["mean10h5", { kind: "weighted-mean", window: 10, halfLife: 5 }],
    ["wmedian8h3", { kind: "weighted-median", window: 8, halfLife: 3 }],
    ...[0.5, 0.8].map(recentShare => [`blend8h3s${recentShare}`, { kind: "blend", window: 8, halfLife: 3, recentShare }] as [string, MinutesConfig]),
    ["robust35i10", { kind: "robust", window: 8, halfLife: 3, lowRatio: 0.35, lowInfluence: 0.1 }],
    ["robust50i25", { kind: "robust", window: 8, halfLife: 3, lowRatio: 0.5, lowInfluence: 0.25 }],
    ["adaptive50i25", { kind: "robust", window: 8, halfLife: 3, lowRatio: 0.5, lowInfluence: 0.25, adapt: true }],
  ];
  const rates: [string, RateConfig][] = [
    ["season", { kind: "season" }],
    ...[5, 10, 15, 20].map(window => [`recent${window}`, { kind: "recent", window }] as [string, RateConfig]),
    ["weighted15h3", { kind: "weighted", window: 15, halfLife: 3 }],
    ["weighted15h5", { kind: "weighted", window: 15, halfLife: 5 }],
    ["weighted20h10", { kind: "weighted", window: 20, halfLife: 10 }],
    ...[0.5, 0.8].map(recentShare => [`blend10s${recentShare}`, { kind: "blend", window: 10, recentShare }] as [string, RateConfig]),
  ];
  const result: NbaCandidateConfig[] = minutes.map(([name, minutes]) => ({ id: `nba-v2-${name}-recent15-v1`, minutes,
    rates: { kind: "recent", window: 15 }, priorFallback: true }));
  for (const [name, rate] of rates) if (name !== "recent15") result.push({ id: `nba-v2-median8-${name}-v1`,
    minutes: { kind: "median", window: 8 }, rates: rate, priorFallback: true });
  for (const priorMinutes of [100, 300]) for (const kind of ["median8", "adaptive50i25"]) {
    result.push({ id: `nba-v2-${kind}-recent15-prior${priorMinutes}-v1`, minutes: minutes.find(([name]) => name === kind)![1],
      rates: { kind: "recent", window: 15, priorMinutes, rareStatPriorMultiplier: 2 }, priorFallback: true });
  }
  result.push({ id: "nba-v2-median8-recent15-prior300-sparseMinutes-v1", minutes: { kind: "median", window: 8 },
    rates: { kind: "recent", window: 15, priorMinutes: 300, rareStatPriorMultiplier: 2 }, priorFallback: true, sparseMinutesPrior: true });
  result.push({ id: "nba-v2-median8-recent15-currentOnly-v1", minutes: { kind: "median", window: 8 },
    rates: { kind: "recent", window: 15 }, priorFallback: false });
  return result;
}
