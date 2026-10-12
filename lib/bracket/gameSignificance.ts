import type { GameImplications } from "./gameImplications";

export type StoryKind = "champion_recap" | "result_recap" | "low_impact" | "unique_champion" | "personal_champion" |
  "eliminated_interest" | "shared_dependency" | "conflict" | "elimination_threat" | "unique_pick" | "consensus" | "personal_path";
export type StoryCandidate = { id: string; kind: StoryKind; priority: number; overlap: string[];
  teamId?: string; entryIds?: Array<number | null>; points?: number; nextTeamId?: string };

/** Explainable candidate rules. No rank forecasts, probabilities or thresholds based on round order. */
export function gameSignificance(analysis: GameImplications, allowGroup: boolean) {
  const candidates: StoryCandidate[] = [];
  const add = (candidate: StoryCandidate) => candidates.push(candidate);
  const official = Boolean(analysis.officialWinner);
  const personal = analysis.entryStates.find((row) => row.isSubject)!;
  const group = allowGroup && analysis.otherEntries !== null;
  const immediateDifferent = group && analysis.outcomes.some((row) => !row.sameImmediatePoints);
  const futureDifferent = group && analysis.outcomes.some((row) => row.rivals?.some((rival) => rival.futureCeilingLost !== row.subject.futureCeilingLost));
  const futurePoints = analysis.exposure.some((row) => row.futurePicks.some((pick) => pick.points > 0) || (group && row.rivalExposure?.some((entry) => entry.futureCeilingLostIfEliminatedHere > 0)));
  const lowImpact = analysis.matchupConfirmed && !futurePoints && (group ? !immediateDifferent : analysis.outcomes.every((row) => row.subject.immediatePoints === 0));
  if (official) {
    add({ id: "official", kind: analysis.isChampionship ? "champion_recap" : "result_recap", priority: 120, overlap: ["result"], teamId: analysis.officialWinner! });
    return { candidates, primary: candidates[0], supporting: [], lowImpact, competitiveDifference: Boolean(immediateDifferent || futureDifferent) };
  }
  if (lowImpact) add({ id: "quiet", kind: "low_impact", priority: 110, overlap: ["consensus", "path"] });
  for (const exposure of analysis.exposure) {
    const ownChampion = personal.championPick === exposure.teamId && personal.championStatus === "pending";
    if (ownChampion && !lowImpact) add({ id: `own-title:${exposure.teamId}`, kind: "personal_champion", priority: 104,
      overlap: [`title:${exposure.teamId}`, `exposure:${exposure.teamId}`, "path"], teamId: exposure.teamId });
    if (!group) continue;
    const champions = (exposure.championEntries ?? []).filter((entry) => entry.alive);
    if (champions.length === 1 && analysis.totalEntries! > 1 && !lowImpact) add({ id: `unique-title:${exposure.teamId}`, kind: "unique_champion", priority: champions[0].isSubject ? 114 : 108,
      overlap: [`title:${exposure.teamId}`, `exposure:${exposure.teamId}`, "path"], teamId: exposure.teamId, entryIds: champions.map((entry) => entry.entryId) });
    const entries = [{ entryId: personal.entryId, points: exposure.futurePicks.reduce((sum, row) => sum + row.points, 0), picked: exposure.pickedHere },
      ...(exposure.rivalExposure ?? []).map((entry) => ({ entryId: entry.entryId, points: entry.futureCeilingLostIfEliminatedHere, picked: entry.pickedHere }))];
    const highest = [...entries].sort((a, b) => b.points - a.points)[0];
    if (!analysis.subject.eligibleToScore && highest?.points > 0 && highest.entryId !== personal.entryId) add({ id: `out-interest:${exposure.teamId}`, kind: "eliminated_interest", priority: 118,
      overlap: ["personal-status", `exposure:${exposure.teamId}`], teamId: exposure.teamId, entryIds: [highest.entryId], points: highest.points });
    if (exposure.pickedHere && highest?.entryId !== personal.entryId && highest.picked && highest.points > entries[0].points && highest.points > 0) add({ id: `shared:${exposure.teamId}`, kind: "shared_dependency", priority: highest.points > entries[0].points * 2 && personal.championPick !== exposure.teamId ? 116 : 96,
      overlap: [`exposure:${exposure.teamId}`, "path"], teamId: exposure.teamId, entryIds: [highest.entryId], points: highest.points });
    if (highest?.points > 0 && (exposure.futurePicks.length >= 2 || exposure.rivalExposure?.some((entry) => entry.futurePicks.length >= 2))) add({ id: `threat:${exposure.teamId}`, kind: "elimination_threat", priority: 88,
      overlap: [`exposure:${exposure.teamId}`], teamId: exposure.teamId, entryIds: [highest.entryId], points: highest.points });
    if (exposure.selectedCount === 1 && !lowImpact) add({ id: `unique:${exposure.teamId}`, kind: "unique_pick", priority: 72,
      overlap: ["picks", `title:${exposure.teamId}`], teamId: exposure.teamId, entryIds: entries.filter((entry) => entry.picked).map((entry) => entry.entryId) });
    if (exposure.selectedCount === analysis.totalEntries) add({ id: `together:${exposure.teamId}`, kind: "consensus", priority: 65,
      overlap: ["consensus", "picks"], teamId: exposure.teamId });
  }
  if (group && analysis.matchupConfirmed && analysis.exposure.filter((row) => (row.selectedCount ?? 0) > 0).length > 1 && (immediateDifferent || futureDifferent))
    add({ id: "opposed", kind: "conflict", priority: 90, overlap: ["picks"] });
  if (analysis.personalPath && analysis.subject.eligibleToScore && !lowImpact) add({ id: "own-path", kind: "personal_path", priority: 45, overlap: ["path"], teamId: analysis.personalPath.teamId });
  if (!candidates.length) add({ id: "quiet", kind: "low_impact", priority: 10, overlap: ["path"] });
  candidates.sort((a, b) => b.priority - a.priority || (b.points ?? 0) - (a.points ?? 0) || a.id.localeCompare(b.id));
  const primary = candidates[0];
  const used = new Set(primary.overlap);
  const supporting: StoryCandidate[] = [];
  // A quiet game gets one short story. All others get at most two non-overlapping supporting facts.
  if (primary.kind !== "low_impact") for (const candidate of candidates.slice(1)) {
    if (candidate.overlap.some((key) => used.has(key))) continue;
    supporting.push(candidate); candidate.overlap.forEach((key) => used.add(key));
    if (supporting.length === 2) break;
  }
  return { candidates, primary, supporting, lowImpact, competitiveDifference: Boolean(immediateDifferent || futureDifferent) };
}
