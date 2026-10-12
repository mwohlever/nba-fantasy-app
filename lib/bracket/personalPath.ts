import { downstreamGameIds } from "./dependencies";
import { orderedBracketGames, resolveBracketGame } from "./topology";
import { scoreBracket } from "./scoring";
import type { BracketPicks, BracketResults, BracketScoringRules, BracketTopology } from "./types";

/** Personal-only path facts. Predicted opponents are predictions, never official matchups. */
export function derivePersonalGamePath(topology: BracketTopology, gameId: string, picks: BracketPicks,
  results: BracketResults, rules: BracketScoringRules) {
  const games = orderedBracketGames(topology);
  const score = scoreBracket(topology, picks, results, rules);
  const selected = score.breakdown.find((row) => row.gameId === gameId);
  if (!selected) throw new Error("Unknown personal path game.");
  const teamId = selected.pickedTeamId;
  if (!teamId) return null;
  const descendants = new Set(downstreamGameIds(topology, gameId));
  const route = games.filter((node) => node.id === gameId || descendants.has(node.id));
  const wins = route.filter((node) => picks[node.id] === teamId).map((node) => {
    const status = score.breakdown.find((row) => row.gameId === node.id)!;
    const predictedTeams = resolveBracketGame(topology, node.id, picks).teamIds;
    return { gameId: node.id, roundKey: node.roundKey, roundOrder: node.roundOrder, points: status.possiblePoints,
      status: status.status, predictedOpponentId: predictedTeams.find((id) => id && id !== teamId) ?? null };
  });
  const loss = route.find((node) => picks[node.id] && picks[node.id] !== teamId &&
    resolveBracketGame(topology, node.id, picks).teamIds.includes(teamId));
  const futureWins = wins.filter((row) => row.gameId !== gameId && row.status === "pending");
  const ownRound = games.find((node) => node.id === gameId)!.roundOrder;
  return { teamId, status: selected.status, champion: picks[games.at(-1)!.id] === teamId,
    lastSelectedWin: wins.at(-1) ?? null, wins, futureWins,
    additionalPoints: futureWins.reduce((sum, row) => sum + row.points, 0),
    pointsAtRisk: (selected.status === "pending" ? selected.possiblePoints : 0) + futureWins.reduce((sum, row) => sum + row.points, 0),
    nextLoss: loss ? { gameId: loss.id, roundKey: loss.roundKey, roundOrder: loss.roundOrder,
      nextRound: loss.roundOrder === ownRound + 1, pickedWinnerId: picks[loss.id]! } : null };
}
