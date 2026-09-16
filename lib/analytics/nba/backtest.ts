import type { NbaScoringRules } from "../../rules/leagueRules";
import { recencyWeight, weightedMean } from "../statistics";
import { observationsAsOf, type HistoryPolicy } from "./history";
import { modelingEvidence } from "./participation";
import { scoreNbaStats, targetNbaScoring } from "./scoring";
import { completeStats, instant, type NbaObservation, type NbaStatLine, type SeasonPhase } from "./types";

/** Only pregame metadata belongs here. Do not pass the actual observation to a candidate. */
export type PredictionTarget = {
  id: string;
  provider: NbaObservation["provider"];
  providerPlayerId: string;
  eventId: string;
  gameAt: string;
  asOf: string;
  season: number;
  phase: SeasonPhase;
  rulesSnapshot: Record<string, unknown> | null;
  allowLegacyRules?: boolean;
};
export type ProjectionOutput = {
  expectedMinutes?: number;
  statRatesPerMinute?: NbaStatLine;
  projectedStats?: NbaStatLine;
  projectedFantasyPoints: number;
  confidence: "high" | "medium" | "low";
  fallbackReason: string | null;
  components: Record<string, number | string | null>;
  modelVersion: string;
  asOf: string;
};
export type PredictionContext = {
  readonly target: Readonly<Omit<PredictionTarget, "rulesSnapshot" | "allowLegacyRules">>;
  readonly history: readonly NbaObservation[];
  readonly scoring: Readonly<NbaScoringRules>;
};
export type ProjectionCandidate = (context: PredictionContext) => ProjectionOutput | null;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function evaluatePredictions(rows: readonly { predicted: number; actual: number }[]) {
  if (!rows.every(row => Number.isFinite(row.predicted) && Number.isFinite(row.actual))) throw new Error("Invalid evaluation score");
  const errors = rows.map(row => row.predicted - row.actual);
  return { predictions: rows.length,
    mae: weightedMean(errors.map(value => ({ value: Math.abs(value), weight: 1 }))),
    rmse: errors.length ? Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length) : null,
    bias: weightedMean(errors.map(value => ({ value, weight: 1 }))) };
}

/** Candidate gets cloned/frozen, cutoff-filtered history only; scoring happens under TARGET rules. */
export function backtestNba(input: {
  history: readonly NbaObservation[];
  targets: readonly PredictionTarget[];
  /** Explicit final truth set, one revision per player/event. Not exposed to candidates. */
  actuals: readonly NbaObservation[];
  policy: HistoryPolicy;
  candidate: ProjectionCandidate;
}) {
  const ids = new Set<string>(), targetKeys = new Set<string>();
  for (const target of input.targets) {
    const at = instant(target.gameAt), cutoff = instant(target.asOf);
    const key = `${target.provider}:${target.providerPlayerId}:${target.eventId}`;
    if (!target.id || !["espn", "nba"].includes(target.provider) || !/^\d+$/.test(target.providerPlayerId)
      || typeof target.eventId !== "string" || !target.eventId.trim() || !Number.isInteger(target.season)
      || !["regular", "postseason", "preseason", "unknown"].includes(target.phase)) throw new Error("Invalid NBA prediction target identity");
    if (at === null || cutoff === null || cutoff > at) throw new Error("Prediction must be at or before target tipoff");
    if (ids.has(target.id) || targetKeys.has(key)) throw new Error("Duplicate backtest target");
    ids.add(target.id); targetKeys.add(key);
  }
  const rows: { targetId: string; predicted: number; actual: number; error: number; projection: ProjectionOutput; historyCount: number }[] = [];
  const skipped: { targetId: string; reason: string }[] = [];
  for (const target of [...input.targets].sort((a, b) => instant(a.asOf)! - instant(b.asOf)! || a.id.localeCompare(b.id))) {
    const scoring = targetNbaScoring(target.rulesSnapshot, target.allowLegacyRules);
    const selected = observationsAsOf(input.history, target.asOf, {
      provider: target.provider, providerPlayerId: target.providerPlayerId, excludeEventIds: [target.eventId],
    }, input.policy);
    // Explicit allowlist prevents accidental truth/season-total extras from leaking via target objects.
    const safeTarget = { id: target.id, provider: target.provider, providerPlayerId: target.providerPlayerId,
      eventId: target.eventId, gameAt: target.gameAt, asOf: target.asOf, season: target.season, phase: target.phase };
    const projection = input.candidate(freeze({ target: safeTarget, history: selected.observations, scoring }));
    if (projection === null) { skipped.push({ targetId: target.id, reason: "candidate-abstained" }); continue; }
    if (!Number.isFinite(projection.projectedFantasyPoints) || instant(projection.asOf) !== instant(target.asOf)
      || !projection.modelVersion || !["low", "medium", "high"].includes(projection.confidence)) throw new Error("Invalid candidate output");
    if (projection.expectedMinutes !== undefined && (!Number.isFinite(projection.expectedMinutes) || projection.expectedMinutes < 0)) throw new Error("Invalid expected minutes");
    if (projection.statRatesPerMinute !== undefined && !completeStats(projection.statRatesPerMinute)) throw new Error("Invalid stat production rates");
    if (projection.projectedStats) {
      const scored = scoreNbaStats(projection.projectedStats, scoring);
      if (scored === null || Math.abs(scored - projection.projectedFantasyPoints) > 1e-8) throw new Error("Projection does not match target scoring");
    }
    const actuals = input.actuals.filter(row => row.sport === "nba" && row.provider === target.provider
      && row.providerPlayerId === target.providerPlayerId && row.eventId === target.eventId);
    if (actuals.length !== 1) { skipped.push({ targetId: target.id, reason: "missing-or-duplicate-actual" }); continue; }
    const truth = actuals[0];
    const actual = scoreNbaStats(truth.stats, scoring);
    if (!modelingEvidence(truth).rateEligible || actual === null || instant(truth.gameAt) !== instant(target.gameAt)
      || truth.season !== target.season || truth.phase !== target.phase) {
      skipped.push({ targetId: target.id, reason: "incomplete-or-mismatched-actual" }); continue;
    }
    rows.push({ targetId: target.id, predicted: projection.projectedFantasyPoints, actual,
      error: projection.projectedFantasyPoints - actual, projection: structuredClone(projection), historyCount: selected.observations.length });
  }
  return { metrics: evaluatePredictions(rows), rows, skipped, policy: structuredClone(input.policy),
    byConfidence: Object.fromEntries(["high", "medium", "low"].map(confidence => [confidence,
      evaluatePredictions(rows.filter(row => row.projection.confidence === confidence))])) };
}

/** Clean offline benchmark. Retains early exits and zero/negative fantasy outcomes. Not a V2 formula. */
export function nbaAverageBaseline(options: { kind: "season-to-date" | "recent"; games?: number; halfLifeGames?: number }): ProjectionCandidate {
  if (options.kind !== "season-to-date" && options.kind !== "recent") throw new Error("Unknown baseline kind");
  if (options.kind === "recent" && (!Number.isInteger(options.games) || options.games! < 1)) throw new Error("Recent baseline needs a positive game count");
  if (options.halfLifeGames !== undefined) recencyWeight(0, options.halfLifeGames);
  return ({ target, history, scoring }) => {
    let sample = history.filter(row => row.season === target.season && row.phase === target.phase && modelingEvidence(row).rateEligible);
    if (options.kind === "recent") sample = sample.slice(-options.games!);
    const projected = weightedMean(sample.map((row, index) => ({ value: scoreNbaStats(row.stats, scoring)!,
      weight: options.halfLifeGames === undefined ? 1 : recencyWeight(sample.length - 1 - index, options.halfLifeGames) })));
    return projected === null ? null : {
      projectedFantasyPoints: projected, confidence: "low", fallbackReason: "Untuned backtest benchmark",
      components: { sampleSize: sample.length, games: options.games ?? null, halfLifeGames: options.halfLifeGames ?? null },
      modelVersion: `nba-baseline-${options.kind}-v1`, asOf: target.asOf,
    };
  };
}
