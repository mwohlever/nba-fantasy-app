export type NflPosition = "QB" | "RB" | "WR" | "TE";
export type RawStats = { passingYards: number; passingTouchdowns: number; interceptions: number; rushingYards: number; rushingTouchdowns: number; receivingYards: number; receivingTouchdowns: number; receptions: number; fumblesLost: number };
export type ResearchRow = { providerPlayerId: string; position: NflPosition; season: number; eventId: string; gameAt: string; week: number; stats: Record<string, number | null> };

/** Literal copy of getDefaultLeagueRules("nfl").scoring, frozen for this offline experiment. */
export const NFL_RESEARCH_SCORING_V1 = { passingYards: 1 / 25, passingTouchdowns: 4, passingInterceptions: -2, rushingYards: .1, rushingTouchdowns: 6, receivingYards: .1, receivingTouchdowns: 6, receptions: 1, fumblesLost: -2 } as const;
export const NFL_V2_RESEARCH_CANDIDATES = [
  { id: "nfl-v2-baseline-recent5-fp-v1", family: "baseline", complexity: "LOW" },
  { id: "nfl-v2-o1-opportunity5-production8-v1", family: "o1", complexity: "LOW" },
  { id: "nfl-v2-o2-robust-opportunity6-production10-v1", family: "o2", complexity: "LOW" },
  { id: "nfl-v2-o3-robust-opportunity6-production10-prior1game-v1", family: "o3", complexity: "MEDIUM" },
] as const;
export type CandidateId = typeof NFL_V2_RESEARCH_CANDIDATES[number]["id"];

const numeric = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const mean = (rows: readonly { value: number; weight: number }[]) => { const total = rows.reduce((sum, row) => sum + row.weight, 0); return total ? rows.reduce((sum, row) => sum + row.value * row.weight, 0) / total : null; };
const median = (values: readonly number[]) => { const ordered = [...values].sort((a, b) => a - b); if (!ordered.length) return null; const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2; };
const ratio = (rows: readonly ResearchRow[], numerator: string, denominator: string, weights: readonly number[]) => { let top = 0, bottom = 0; rows.forEach((row, index) => { top += numeric(row.stats[numerator]) * weights[index]; bottom += numeric(row.stats[denominator]) * weights[index]; }); return bottom > 0 ? top / bottom : null; };

export function scoreNflResearch(stats: RawStats) { const s = NFL_RESEARCH_SCORING_V1; return stats.passingYards*s.passingYards + stats.passingTouchdowns*s.passingTouchdowns + stats.interceptions*s.passingInterceptions + stats.rushingYards*s.rushingYards + stats.rushingTouchdowns*s.rushingTouchdowns + stats.receivingYards*s.receivingYards + stats.receivingTouchdowns*s.receivingTouchdowns + stats.receptions*s.receptions + stats.fumblesLost*s.fumblesLost; }
export function actualNflResearchStats(row: ResearchRow): RawStats { return { passingYards:numeric(row.stats.passingYards), passingTouchdowns:numeric(row.stats.passingTouchdowns), interceptions:numeric(row.stats.interceptions), rushingYards:numeric(row.stats.rushingYards), rushingTouchdowns:numeric(row.stats.rushingTouchdowns), receivingYards:numeric(row.stats.receivingYards), receivingTouchdowns:numeric(row.stats.receivingTouchdowns), receptions:numeric(row.stats.receptions), fumblesLost:numeric(row.stats.fumblesLost) }; }

type Driver = "passingAttempts" | "rushingAttempts" | "receivingTargets";
function drivers(position: NflPosition): Driver[] { return position === "QB" ? ["passingAttempts", "rushingAttempts"] : position === "RB" ? ["rushingAttempts", "receivingTargets"] : position === "WR" ? ["receivingTargets", "rushingAttempts"] : ["receivingTargets", "rushingAttempts"]; }
/** Position-relevant opportunity used by the frozen O1 opportunity adapters. */
export function hasNflResearchPositionOpportunity(position: NflPosition, row: Pick<ResearchRow, "stats">) { return drivers(position).some(driver => numeric(row.stats[driver]) > 0); }
function robustOpportunity(rows: readonly ResearchRow[], driver: Driver) {
  const recent = rows.slice(-6); let downweighted = 0;
  const estimate = mean(recent.map((row, index) => { const absolute = rows.length - recent.length + index, prior = rows.slice(Math.max(0, absolute - 5), absolute).map(x => numeric(x.stats[driver])); const precedingReference = median(prior.slice(0, -1)); const priorWasLow = precedingReference !== null && numeric(prior.at(-1)) < precedingReference * .5; const low = prior.length >= 3 && numeric(row.stats[driver]) < (median(prior) ?? 0) * .5 && !priorWasLow; if (low) downweighted++; return { value:numeric(row.stats[driver]), weight:low ? .25 : 1 }; }));
  return { value:estimate ?? 0, downweighted, sample:recent.length };
}
function standardOpportunity(rows: readonly ResearchRow[], driver: Driver) { const recent = rows.slice(-5); return { value:mean(recent.map(row => ({ value:numeric(row.stats[driver]), weight:1 }))) ?? 0, downweighted:0, sample:recent.length }; }
function carryover(current: readonly ResearchRow[], previous: readonly ResearchRow[]) {
  // One immediately previous-season game is deliberately the small support
  // amount: it is admitted only before three current-season games exist.
  return current.length >= 3 || !previous.length ? [...current] : [...previous.slice(-1), ...current];
}
function estimateOpportunity(rows: readonly ResearchRow[], driver: Driver, robust: boolean) { return robust ? robustOpportunity(rows, driver) : standardOpportunity(rows, driver); }
function projectedFromWindows(position: NflPosition, opportunityRows: readonly ResearchRow[], production: readonly ResearchRow[], robust: boolean) {
  const weights = production.map(() => 1), opportunity: Record<string, number> = {};
  let downweighted = 0; for (const driver of drivers(position)) { const result = estimateOpportunity(opportunityRows, driver, robust); opportunity[driver] = result.value; downweighted += result.downweighted; }
  const component = (numerator: string, denominator: Driver) => { const rate = ratio(production,numerator,denominator,weights); return rate === null ? 0 : opportunity[denominator] * rate; };
  const totalOpportunity = (row: ResearchRow) => numeric(row.stats.rushingAttempts) + numeric(row.stats.receivingTargets) + (position === "QB" ? numeric(row.stats.passingAttempts) : 0);
  const totalProjectedOpportunity = opportunity.rushingAttempts + (opportunity.receivingTargets ?? 0) + (position === "QB" ? opportunity.passingAttempts : 0);
  let fumbleTop=0,fumbleBottom=0; production.forEach(row=>{fumbleTop+=numeric(row.stats.fumblesLost);fumbleBottom+=totalOpportunity(row)}); const fumblesLost=fumbleBottom ? totalProjectedOpportunity*fumbleTop/fumbleBottom : 0;
  const stats: RawStats = { passingYards:0, passingTouchdowns:0, interceptions:0, rushingYards:component("rushingYards","rushingAttempts"), rushingTouchdowns:component("rushingTouchdowns","rushingAttempts"), receivingYards:component("receivingYards","receivingTargets"), receivingTouchdowns:component("receivingTouchdowns","receivingTargets"), receptions:component("receptions","receivingTargets"), fumblesLost };
  if (position === "QB") { stats.passingYards=component("passingYards","passingAttempts");stats.passingTouchdowns=component("passingTouchdowns","passingAttempts");stats.interceptions=component("interceptions","passingAttempts"); }
  return { stats, opportunity, productionSample:production.length, downweighted };
}
function projectedFromHistory(position: NflPosition, rows: readonly ResearchRow[], robust: boolean) { return projectedFromWindows(position, rows, rows.slice(-(robust ? 10 : 8)), robust); }

/** Raw O1 core for a supplied real-observation window fill; no fantasy scoring or weights are introduced. */
export function projectNflResearchO1RawWithWindows(target: Pick<ResearchRow, "position">, windows: { opportunity: readonly ResearchRow[]; production: readonly ResearchRow[] }) {
  if (!windows.opportunity.length || !windows.production.length) return null;
  const projection = projectedFromWindows(target.position, windows.opportunity.slice(-5), windows.production.slice(-8), false);
  return { projectedStats: projection.stats, components: projection };
}

/** Frozen O1 raw-stat path shared by shadow generation; it deliberately does not score fantasy points. */
export function projectNflResearchO1Raw(target: Pick<ResearchRow, "providerPlayerId" | "position" | "season" | "gameAt">, prior: readonly ResearchRow[]) {
  const history = prior.filter(row => row.providerPlayerId === target.providerPlayerId && row.gameAt < target.gameAt).sort((a,b)=>a.gameAt.localeCompare(b.gameAt)||a.eventId.localeCompare(b.eventId));
  const current = history.filter(row => row.season === target.season);
  if (!current.length) return null;
  const projection = projectNflResearchO1RawWithWindows(target, { opportunity: current, production: current });
  if (!projection) return null;
  return { projectedStats: projection.projectedStats, components: { history: history.length, currentSeasonGames: current.length, previousSeasonGames: history.filter(row=>row.season===target.season-1).length, admitted: current.map(row=>({eventId:row.eventId,season:row.season,weight:1})), ...projection.components } };
}

export function projectNflResearch(candidateId: CandidateId, target: ResearchRow, prior: readonly ResearchRow[]) {
  const history = prior.filter(row => row.providerPlayerId === target.providerPlayerId && row.gameAt < target.gameAt).sort((a,b)=>a.gameAt.localeCompare(b.gameAt)||a.eventId.localeCompare(b.eventId));
  if (!history.length) return null; // Common policy: no factual prior observation means abstain.
  if (candidateId === "nfl-v2-baseline-recent5-fp-v1") { const scores=history.slice(-5).map(row=>scoreNflResearch(actualNflResearchStats(row))); return { projectedFantasyPoints:scores.reduce((a,b)=>a+b,0)/scores.length, projectedStats:null, components:{history:history.length,baselineGames:scores.length} }; }
  const family = NFL_V2_RESEARCH_CANDIDATES.find(c=>c.id===candidateId)!.family, robust=family === "o2" || family === "o3";
  const current=history.filter(row=>row.season===target.season), previous=history.filter(row=>row.season===target.season-1);
  if (family === "o1") {
    const raw = projectNflResearchO1Raw(target, prior);
    if (!raw) return null;
    return { projectedFantasyPoints:scoreNflResearch(raw.projectedStats), projectedStats:raw.projectedStats, components:raw.components };
  }
  const admitted = family === "o3" ? carryover(current,previous) : current;
  if (!admitted.length) return null;
  const projection=projectedFromHistory(target.position,admitted,robust);
  return { projectedFantasyPoints:scoreNflResearch(projection.stats), projectedStats:projection.stats, components:{history:history.length,currentSeasonGames:current.length,previousSeasonGames:previous.length,admitted:admitted.map(row=>({eventId:row.eventId,season:row.season,weight:1})),...projection} };
}
