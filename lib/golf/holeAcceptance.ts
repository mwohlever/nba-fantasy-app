/** Provider evidence, never UI intent, determines acceptance. Times are fetch START times. */
export type HoleEvidence = {
  source: "espn" | "shotcast";
  observedAt: string;
  providerUpdatedAt?: string;
  final: boolean;
  officialValidated?: boolean;
  operation?: "score" | "retract";
  correctionReason?: string;
};
export type AcceptedHole = {
  hole_number: number;
  strokes: number | null;
  relative_to_par: number | null;
  score_display?: string | null;
  reconciliation?: HoleEvidence;
};
export type HoleObservation = AcceptedHole & { reconciliation: HoleEvidence };

export function acceptGolfHole(current: AcceptedHole | undefined, next: HoleObservation): boolean {
  const evidence = next.reconciliation;
  const time = Date.parse(evidence.observedAt);
  if (!Number.isFinite(time) || !Number.isInteger(next.hole_number) || next.hole_number < 1 || next.hole_number > 18) return false;
  if (evidence.providerUpdatedAt && !Number.isFinite(Date.parse(evidence.providerUpdatedAt))) return false;
  const prior = current?.reconciliation;
  if (prior && time <= Date.parse(prior.observedAt)) return false;
  if (prior?.providerUpdatedAt && evidence.providerUpdatedAt &&
      Date.parse(evidence.providerUpdatedAt) < Date.parse(prior.providerUpdatedAt)) return false;
  if (evidence.operation === "retract") {
    // Neither adapter infers this from an absent/null/zero score. Reserved for explicit official evidence.
    return !!current && evidence.source === "espn" && evidence.officialValidated === true &&
      !!evidence.correctionReason?.trim() && Number.isFinite(Date.parse(evidence.providerUpdatedAt ?? "")) &&
      next.strokes === null && next.relative_to_par === null;
  }
  if (!evidence.final || !Number.isInteger(next.strokes) || next.strokes! < 1 || next.strokes! > 20 ||
      !Number.isInteger(next.relative_to_par) || next.strokes! - next.relative_to_par! < 3 ||
      next.strokes! - next.relative_to_par! > 6) return false;
  if (current?.strokes != null && current.relative_to_par != null) {
    const differs = current.strokes !== next.strokes || current.relative_to_par !== next.relative_to_par;
    // Reconstruction can fill missing official holes, but cannot correct a scored official card.
    if (differs && evidence.source === "shotcast" && prior?.source !== "shotcast") return false;
    // A different official score must be corroborated by coherent round aggregates and coverage.
    if (differs && evidence.source === "espn" && !evidence.officialValidated) return false;
    if (evidence.source === "espn" && prior?.source === "shotcast" && !evidence.officialValidated) return false;
    // A repeated ShotCast fetch must not demote official provenance even when scores agree.
    if (!differs && evidence.source === "shotcast" && prior?.source === "espn") return false;
  }
  if (prior?.operation === "retract" && !evidence.officialValidated) return false;
  return true;
}

export function golfScoreDisplay(value: number | null) {
  return value == null ? null : value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}

export function summarizeGolfHoles(holes: AcceptedHole[]) {
  const completed = holes.filter(h => h.strokes != null && h.relative_to_par != null);
  return {
    holes_completed: completed.length,
    strokes: completed.length ? completed.reduce((s, h) => s + h.strokes!, 0) : null,
    score_to_par: completed.length ? completed.reduce((s, h) => s + h.relative_to_par!, 0) : null,
  };
}

/** No public provider timestamps/retractions are exposed by the current normalized adapters. */
export function shotcastObservation(input: {
  holeNumber: number; par: number | null;
  shots: Array<{ strokeNumber: number; finalStroke: boolean }>;
}, observedAt: string): HoleObservation | null {
  const numbers = [...new Set(input.shots.map(s => s.strokeNumber))].sort((a,b) => a-b);
  const strokes = numbers.at(-1);
  // Require an unbroken sequence ending at the explicitly final stroke; never max(strokes) alone.
  if (!strokes || input.par == null || numbers.some((n,i) => n !== i+1) ||
      !input.shots.some(s => s.strokeNumber === strokes && s.finalStroke) ||
      input.shots.some(s => s.finalStroke && s.strokeNumber !== strokes)) return null;
  return {
    hole_number: input.holeNumber, strokes, relative_to_par: strokes - input.par,
    reconciliation: { source: "shotcast", observedAt, final: true },
  };
}
