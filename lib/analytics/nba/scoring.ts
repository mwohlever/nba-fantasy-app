import { calculateCorrectionFantasyPoints } from "../../corrections/correctionPolicy";
import { resolveLeagueRules, type NbaScoringRules } from "../../rules/leagueRules";
import { completeStats, type NbaObservation } from "./types";

/** Accept the TARGET snapshot only. Legacy fallback must be explicitly requested. */
export function targetNbaScoring(snapshot: Record<string, unknown> | null, legacyFallback = false): NbaScoringRules {
  if (snapshot === null && !legacyFallback) throw new Error("Target frozen rules required");
  if (snapshot !== null && (typeof snapshot !== "object" || Array.isArray(snapshot))) throw new Error("Invalid target snapshot");
  if (snapshot?.sport !== undefined && snapshot.sport !== "nba") throw new Error("Not an NBA snapshot");
  return { ...resolveLeagueRules({ sport: "nba", settings: snapshot }).scoring } as NbaScoringRules;
}

/** Reject missing stats before calling the existing scorer (which otherwise defaults missing to zero). */
export function scoreNbaStats(stats: NbaObservation["stats"], scoring: NbaScoringRules): number | null {
  const complete = completeStats(stats);
  if (!complete) return null;
  if (!Object.keys(complete).every(key => Number.isFinite(scoring[key as keyof NbaScoringRules]))) {
    throw new Error("Invalid NBA scoring coefficients");
  }
  return calculateCorrectionFantasyPoints({ sport: "nba", stats: complete, scoring });
}
