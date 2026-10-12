import { downstreamGameIds } from "./dependencies";
import { deriveGameImplications } from "./gameImplications";
import { resolveBracketGame, validateBracketPicks } from "./topology";
import { scoreBracket, validateBracketResults } from "./scoring";
import type { BracketPicks, BracketResults, BracketSource, BracketTopology } from "./types";
import type { ImplicationSelection, ImplicationSubject, ImplicationsResponse } from "./gameImplications.server";
import type { BracketGameCenterMatchup } from "./gameCenter";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import { bracketContestLockContext } from "./lifecycle";
import { bracketInsightVisibility } from "./insights";

// Fictional IDs, teams and entrants. This module has no database, provider or network dependencies.
const team = (seed: number): BracketSource => ({ type: "team", teamId: `sim-team-${seed}` });
const winner = (gameId: string): BracketSource => ({ type: "winner", gameId });
const game = (id: string, roundKey: string, roundOrder: number, gameOrder: number, a: BracketSource, b: BracketSource) => ({ id, roundKey, roundOrder, gameOrder, sources: [a, b] as [BracketSource, BracketSource] });
export const simulationTopology: BracketTopology = { games: [
  game("r1-1", "first_round", 1, 1, team(8), team(9)), game("r1-2", "first_round", 1, 2, team(5), team(12)),
  game("r1-3", "first_round", 1, 3, team(7), team(10)), game("r1-4", "first_round", 1, 4, team(6), team(11)),
  game("qf-1", "quarterfinal", 2, 1, team(1), winner("r1-1")), game("qf-2", "quarterfinal", 2, 2, team(4), winner("r1-2")),
  game("qf-3", "quarterfinal", 2, 3, team(2), winner("r1-3")), game("qf-4", "quarterfinal", 2, 4, team(3), winner("r1-4")),
  game("sf-1", "semifinal", 3, 1, winner("qf-1"), winner("qf-2")), game("sf-2", "semifinal", 3, 2, winner("qf-3"), winner("qf-4")),
  game("champ", "championship", 4, 1, winner("sf-1"), winner("sf-2")),
] };
const teamLabels = ["Summit Eagles", "Harbor Bears", "Canyon Wolves", "Prairie Hawks", "Forest Owls", "Valley Foxes", "Mesa Rams", "River Rebels", "Lake Lions", "Coastal Sharks", "Desert Knights", "Mountain Bulls"];
export const simulationTeams = teamLabels.map((displayName, index) => ({ seed: index + 1, providerTeamId: `sim-team-${index + 1}`, displayName,
  abbreviation: displayName.split(" ")[0], logoUrl: `/simulation/cfp-team.svg` }));
const selections = [
  [8, 5, 7, 6, 8, 5, 2, 3, 5, 2, 5], // Alex wins with River today, then loses to Forest in the semi.
  [8, 5, 7, 6, 8, 5, 2, 3, 8, 2, 8], // Jordan's champion depends on three future River wins.
  [9, 12, 10, 11, 9, 12, 10, 11, 9, 10, 9], // Casey's major upset bracket.
  [8, 5, 7, 6, 1, 4, 2, 3, 1, 2, 2], // Taylor wins today but loses River in the next round.
];
export const simulationEntries = ["Alex", "Jordan", "Casey", "Taylor"].map((name, index) => ({ id: index + 1, label: `${name} (fictional) · Bracket 1`,
  picks: Object.fromEntries(simulationTopology.games.map((node, i) => [node.id, `sim-team-${selections[index][i]}`])) as BracketPicks,
  rules: index === 2 ? { first_round: 7, quarterfinal: 19, semifinal: 33, championship: 61 }
    : { first_round: 10, quarterfinal: 20, semifinal: 40, championship: 80 } }));

export type SimulationPhase = "pregame" | "live" | "provider_final" | "official_final";
export type SimulationState = { results: BracketResults; phases: Record<string, SimulationPhase>; winners: Record<string, string>; revision: number; preset?: string };
export const initialSimulationState = (): SimulationState => ({ results: {}, phases: {}, winners: {}, revision: 0 });

/** A correction/removal invalidates descendants before rebuilding the official result map. */
export function transitionSimulation(state: SimulationState, gameId: string, phase: SimulationPhase, winnerId?: string): SimulationState {
  validateBracketResults(simulationTopology, state.results);
  const participants = resolveBracketGame(simulationTopology, gameId, state.results).teamIds;
  if (phase !== "pregame" && participants.some((id) => id === null)) throw new Error("Finalize the feeder games first to establish this matchup.");
  const chosen = winnerId ?? state.winners[gameId] ?? participants[0];
  if ((phase === "provider_final" || phase === "official_final") && (!chosen || !participants.includes(chosen))) throw new Error("Choose a legal participant as the simulated winner.");
  const next = { ...state, results: { ...state.results }, phases: { ...state.phases }, winners: { ...state.winners }, revision: state.revision + 1 };
  const oldResult = state.results[gameId] ?? null;
  const newResult = phase === "official_final" ? chosen : null;
  if (oldResult !== newResult) for (const id of downstreamGameIds(simulationTopology, gameId)) {
    delete next.results[id]; delete next.phases[id]; delete next.winners[id];
  }
  delete next.results[gameId];
  next.phases[gameId] = phase;
  if (chosen && participants.includes(chosen)) next.winners[gameId] = chosen; else delete next.winners[gameId];
  if (newResult) next.results[gameId] = newResult;
  validateBracketResults(simulationTopology, next.results);
  return next;
}

/** Convenience for later-round testing: establishes legal feeders using an explicitly chosen fictional bracket. */
export function prepareSimulationMatchup(state: SimulationState, gameId: string, entryId: number): SimulationState {
  const entry = simulationEntriesFor(state).find((row) => row.id === entryId);
  if (!entry) throw new Error("Unknown fictional entrant.");
  let next = state;
  const visit = (id: string) => {
    const node = simulationTopology.games.find((node) => node.id === id);
    if (!node) throw new Error("Unknown simulation game.");
    for (const source of node.sources) if (source.type === "winner") {
      visit(source.gameId);
      const participants = resolveBracketGame(simulationTopology, source.gameId, next.results).teamIds;
      const pick = entry.picks[source.gameId];
      const selected = pick && participants.includes(pick) ? pick : participants.find((id) => id !== null)!;
      next = transitionSimulation(next, source.gameId, "official_final", selected);
    }
  };
  visit(gameId);
  return next;
}

export function simulationMatchup(state: SimulationState, gameId: string): { matchup: BracketGameCenterMatchup; provider: LiveScoreGame | null } {
  const node = resolveBracketGame(simulationTopology, gameId, state.results);
  const phase = state.phases[gameId] ?? "pregame";
  const participant = (id: string | null, index: number) => id ? { status: "resolved" as const, team: simulationTeams.find((team) => team.providerTeamId === id)! }
    : { status: "unresolved" as const, sourceLabel: node.sources[index].type === "winner" ? `Winner of ${node.sources[index].gameId}` : "TBD" };
  const matchup: BracketGameCenterMatchup = { gameKey: gameId, gameOrder: node.gameOrder, scheduledAt: null,
    officialStatus: phase === "official_final" ? "final" : phase === "live" ? "in_progress" : "scheduled",
    participants: { a: participant(node.teamIds[0], 0), b: participant(node.teamIds[1], 1) }, provider: { mappingState: "unmapped" } };
  if (phase === "pregame" || node.teamIds.some((id) => !id)) return { matchup, provider: null };
  const selected = state.winners[gameId] ?? node.teamIds[0];
  const live = phase === "live";
  const toTeam = (id: string) => {
    const team = simulationTeams.find((team) => team.providerTeamId === id)!;
    return { id, displayName: team.displayName, abbreviation: team.abbreviation, logo: team.logoUrl, rank: team.seed,
      record: null, conferenceId: null, score: id === selected ? live ? 14 : 27 : live ? 7 : 17, winner: !live && id === selected };
  };
  return { matchup, provider: { espnEventId: `simulation-${gameId}`, name: "Simulated CFP game", shortName: null, kickoffAt: "",
    awayTeam: toTeam(node.teamIds[0]!), homeTeam: toTeam(node.teamIds[1]!), status: live ? "in" : "post", statusDetail: live ? "Q3 · 8:42 (simulated)" : "Final (simulated)",
    completed: !live, winnerTeamId: live ? null : selected, odds: null } };
}

export function simulationResponse(state: SimulationState, gameId: string | undefined, selection?: ImplicationSelection, preLock = false): ImplicationsResponse {
  const entries = simulationEntriesFor(state);
  const subjects: ImplicationSubject[] = entries.map((entry, index) => ({ contestId: "cfp-simulation", competitionId: 0,
    entryId: entry.id, masterBracketId: `sim-master-${entry.id}`, entrantId: `sim-entrant-${entry.id}`, entrantName: ["Alex", "Jordan", "Casey", "Taylor"][index],
    isAccountOwner: index === 0, bracketNumber: 1, label: entry.label, snapshotStatus: "frozen" }));
  const subject = subjects.find((row) => row.entryId === selection?.entryId) ?? null;
  const node = gameId ? simulationTopology.games.find((row) => row.id === gameId) : undefined;
  if (gameId && !node) throw new Error("Unknown simulation game.");
  const entry = subject ? entries.find((entry) => entry.id === subject.entryId)! : null;
  // Fictional contest control: game phases never independently change privacy.
  const lock = { contestStatus: preLock ? "open" : "locked", contestLockAt: null };
  const evaluatedAt = new Date();
  const contestLock = bracketContestLockContext(lock, evaluatedAt);
  const visibility = bracketInsightVisibility(lock, entries.map((entry) => ({ id: entry.id, entrantId: `sim-entrant-${entry.id}`,
    lockedAt: "2000-01-01T00:00:00.000Z", picks: entry.picks, rulesSnapshot: { scoring: { roundPoints: entry.rules } } })), evaluatedAt);
  return { groupId: "simulation-only", contestId: "cfp-simulation", competitionId: 0, subjects, subject,
    contestLock, poolState: visibility.pool, readiness: subject ? "available" : "selection_required",
    game: node ? { gameId: node.id, bracketGameId: simulationTopology.games.indexOf(node) + 1, providerEventId: null,
      officialStatus: state.results[node.id] ? "final" : state.phases[node.id] === "live" ? "in_progress" : "scheduled", officialWinner: state.results[node.id] ?? null } : null,
    analysis: node && entry ? deriveGameImplications({ topology: simulationTopology, gameId: node.id, results: state.results, subject: entry,
      rivals: visibility.pool === "available" ? entries : null }) : null,
    teamNames: Object.fromEntries(simulationTeams.map((team) => [team.providerTeamId, team.displayName])),
    freshness: { readAt: new Date().toISOString(), topologyVersion: 1, resultsVersion: String(state.revision) } };
}

export function simulationStandings(state: SimulationState) {
  return simulationEntriesFor(state).map((entry) => ({ id: entry.id, label: entry.label, ...scoreBracket(simulationTopology, entry.picks, state.results, entry.rules) }));
}

export const simulationPresets = [
  { id: "default", label: "Original conflicting paths" }, { id: "unanimous", label: "Everyone agrees; later picks split" },
  { id: "quiet", label: "Low-impact early game" }, { id: "unique", label: "Unique championship pick threatened" },
  { id: "opposed", label: "Opposing semifinal picks" }, { id: "shared", label: "Earn today; preserve a rival’s bigger path" },
  { id: "eliminated", label: "Viewed pick already eliminated" }, { id: "upset", label: "Major upset and lost future picks" },
  { id: "championship", label: "Championship: split contest" }, { id: "complete", label: "Completed tournament and final positions" },
];

export function simulationEntriesFor(state: SimulationState) {
  const entries = simulationEntries.map((entry) => ({ ...entry, picks: { ...entry.picks }, rules: { ...entry.rules } }));
  if (state.preset === "quiet") for (const entry of entries) { entry.picks = { ...simulationEntries[3].picks }; entry.rules = { ...simulationEntries[0].rules }; }
  if (state.preset === "unanimous") for (const [index, entry] of entries.entries()) {
    entry.picks = { ...simulationEntries[0].picks, "qf-1": "sim-team-8", "qf-2": index < 2 ? "sim-team-5" : "sim-team-4",
      "sf-1": index < 2 ? "sim-team-5" : "sim-team-4", champ: "sim-team-2" };
    entry.rules = { ...simulationEntries[0].rules };
  }
  if (state.preset === "championship" || state.preset === "complete") for (const [index, entry] of entries.entries()) {
    entry.picks = { ...simulationEntries[3].picks, champ: index < 2 ? "sim-team-1" : "sim-team-2" };
    entry.rules = { ...simulationEntries[0].rules };
  }
  for (const entry of entries) validateBracketPicks(simulationTopology, entry.picks);
  return entries;
}

export function loadSimulationPreset(preset: string, revision = 0) {
  if (!simulationPresets.some((row) => row.id === preset)) throw new Error("Unknown simulation preset.");
  let state: SimulationState = { ...initialSimulationState(), preset, revision: revision + 1 };
  let gameId = "r1-1", entryId = preset === "unique" ? 2 : 1;
  if (preset === "eliminated") { state = transitionSimulation(state, "r1-1", "official_final", "sim-team-9"); gameId = "qf-1"; entryId = 2; }
  if (preset === "upset") { state = transitionSimulation(state, "r1-1", "official_final", "sim-team-9"); entryId = 2; }
  if (preset === "opposed") { state = prepareSimulationMatchup(state, "sf-1", 1); gameId = "sf-1"; }
  if (preset === "championship" || preset === "complete") {
    state = prepareSimulationMatchup(state, "champ", 4); gameId = "champ";
    if (preset === "complete") state = transitionSimulation(state, "champ", "official_final", "sim-team-2");
  }
  return { state, gameId, entryId, contestLocked: true };
}

// Validate the authored fixture with the same validators as real entries.
for (const entry of simulationEntries) validateBracketPicks(simulationTopology, entry.picks);
export const simulationAvailable = (environment: string | undefined) => environment === "development";
