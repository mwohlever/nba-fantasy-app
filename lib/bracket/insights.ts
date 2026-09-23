import { shouldFreezeBracketEntry, type BracketLockState } from "./lifecycle";
import { bracketResultsFromOfficialGames, bracketScoringRulesFromSnapshot, scoreBracket } from "./scoring";
import type { BracketPicks, BracketTopology } from "./types";

export type FrozenInsightEntry = {
  id: number;
  entrantId: string;
  lockedAt: string | null;
  picks: BracketPicks | null;
  rulesSnapshot: Record<string, unknown> | null;
};

export function bracketInsightVisibility(lock: BracketLockState, entries: FrozenInsightEntry[], now = new Date()) {
  if (!shouldFreezeBracketEntry(lock, now)) return { personal: "available" as const, pool: "pre_lock" as const };
  return {
    personal: "available" as const,
    pool: entries.every((entry) => entry.lockedAt && entry.picks && entry.rulesSnapshot)
      ? "available" as const : "freezing" as const,
  };
}

export function deriveBracketIdentity(input: {
  topology: BracketTopology;
  picks: BracketPicks;
  officialGames: Array<{ gameId: string; status: string; winnerTeamId: string | null }>;
  rulesSnapshot?: Record<string, unknown> | null;
}) {
  const ordered = [...input.topology.games].sort((a, b) => b.roundOrder - a.roundOrder || b.gameOrder - a.gameOrder);
  const topRound = ordered[0]?.roundOrder;
  const championPick = ordered[0] ? input.picks[ordered[0].id] ?? null : null;
  const deepRoundPicks = ordered.filter((game) => game.roundOrder === topRound || game.roundOrder === topRound - 1)
    .filter((game) => input.picks[game.id])
    .map((game) => ({ gameId: game.id, roundKey: game.roundKey, roundOrder: game.roundOrder, teamId: input.picks[game.id]! }));
  const selectedPicks = Object.values(input.picks).filter(Boolean).length;
  const score = input.rulesSnapshot
    ? scoreBracket(input.topology, input.picks,
      bracketResultsFromOfficialGames(input.officialGames),
      bracketScoringRulesFromSnapshot(input.rulesSnapshot, input.topology))
    : null;
  return {
    championPick, deepRoundPicks, selectedPicks, totalGames: input.topology.games.length,
    correctPicks: score?.correctPicks ?? null,
    incorrectPicks: score?.incorrectPicks ?? null,
    alivePicks: score?.pendingPicks ?? null,
    bustedPicks: score ? score.incorrectPicks + score.eliminatedPicks : null,
  };
}

/** Counts entries, never distinct owners. A downstream pick means team in this game/round, not a side of a predicted matchup. */
export function deriveBracketConsensus(topology: BracketTopology, entries: FrozenInsightEntry[]) {
  const totalBrackets = entries.length;
  const counts = new Map<string, Map<string, number>>();
  for (const game of topology.games) counts.set(game.id, new Map());
  for (const entry of entries) {
    if (!entry.picks) throw new Error("Consensus requires complete frozen cohort.");
    for (const game of topology.games) {
      const teamId = entry.picks[game.id];
      if (!teamId) continue;
      const gameCounts = counts.get(game.id)!;
      gameCounts.set(teamId, (gameCounts.get(teamId) ?? 0) + 1);
    }
  }
  const games = topology.games.map((game) => ({
    gameId: game.id, roundKey: game.roundKey,
    teams: [...counts.get(game.id)!].map(([teamId, count]) => ({
      teamId, count, denominator: totalBrackets,
      percentage: totalBrackets ? Math.round(100 * count / totalBrackets) : 0,
      unanimous: totalBrackets > 0 && count === totalBrackets,
      unique: count === 1,
    })).sort((a, b) => b.count - a.count || a.teamId.localeCompare(b.teamId)),
  }));
  const championGame = [...topology.games].sort((a, b) => b.roundOrder - a.roundOrder || b.gameOrder - a.gameOrder)[0];
  const mostDivisiveGames = games
    .filter((game) => game.teams.length > 1 && game.teams.reduce((sum, team) => sum + team.count, 0) === totalBrackets)
    .sort((a, b) => a.teams[0].count - b.teams[0].count || a.gameId.localeCompare(b.gameId))
    .slice(0, 3).map((game) => game.gameId);
  const rarePicks = games.flatMap((game) => game.teams
    .filter((team) => team.count > 1 && team.percentage <= 20)
    .map((team) => ({ gameId: game.gameId, roundKey: game.roundKey, ...team })));
  return { totalBrackets, games, champion: games.find((game) => game.gameId === championGame?.id)?.teams ?? [], mostDivisiveGames, rarePicks };
}
