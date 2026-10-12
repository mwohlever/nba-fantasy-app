import { scoreBracket, validateBracketResults } from "./scoring";
import { orderedBracketGames, resolveBracketGame } from "./topology";
import type { BracketPicks, BracketResults, BracketScoringRules, BracketTopology } from "./types";
import { derivePersonalGamePath } from "./personalPath";

export type ImplicationEntry = { id: number | null; label: string; picks: BracketPicks; rules: BracketScoringRules };

/** Read-only analysis of one node. A remaining ceiling is pick potential, never a rank prediction. */
export function deriveGameImplications(input: {
  topology: BracketTopology; gameId: string; results: BracketResults;
  subject: ImplicationEntry; rivals: ImplicationEntry[] | null;
}) {
  const { topology, gameId, results, subject } = input;
  const games = orderedBracketGames(topology);
  validateBracketResults(topology, results);
  const game = games.find((candidate) => candidate.id === gameId);
  if (!game) throw new Error("Unknown bracket game.");
  const descendants = new Set<string>();
  for (const node of games) {
    if (node.sources.some((source) => source.type === "winner" &&
      (source.gameId === gameId || descendants.has(source.gameId)))) descendants.add(node.id);
  }
  const winner = results[gameId] ?? null;
  // Reconstruct the opportunities at this result, even when later rounds have finished.
  const before: BracketResults = winner ? Object.fromEntries(Object.entries(results)
    .filter(([id]) => id !== gameId && !descendants.has(id))) : { ...results };
  const participants = resolveBracketGame(topology, gameId, before).teamIds;
  const matchupConfirmed = participants.every((team) => team !== null);
  const candidates = new Map<string, string[]>();
  for (const node of games) {
    candidates.set(node.id, before[node.id] ? [before[node.id]!] : node.sources.flatMap((source) =>
      source.type === "team" ? [source.teamId] : candidates.get(source.gameId) ?? []));
  }
  const eligible = [...new Set(candidates.get(gameId) ?? [])];
  const rivals = input.rivals?.filter((entry) => subject.id === null || entry.id !== subject.id) ?? null;
  const cohort = [subject, ...(rivals ?? [])];
  const scores = cohort.map((entry) => scoreBracket(topology, entry.picks, before, entry.rules));
  const currentScores = cohort.map((entry) => scoreBracket(topology, entry.picks, results, entry.rules));
  const current = currentScores[0];
  const pick = current.breakdown.find((row) => row.gameId === gameId)!;
  const championGame = games.at(-1)!;
  const futurePicks = (index: number, teamId: string) => scores[index].breakdown
    .filter((row) => descendants.has(row.gameId) && row.pickedTeamId === teamId && row.status === "pending")
    .map((row) => ({ gameId: row.gameId, roundKey: row.roundKey, points: row.possiblePoints }));
  const exposure = eligible.map((teamId) => ({
    teamId,
    confirmedParticipant: participants.includes(teamId),
    pickedHere: subject.picks[gameId] === teamId,
    immediatePointsIfWinner: subject.picks[gameId] === teamId ? subject.rules[game.roundKey] : 0,
    futurePicks: futurePicks(0, teamId),
    currentFuturePoints: currentScores[0].breakdown.filter((row) => descendants.has(row.gameId) && row.pickedTeamId === teamId && row.status === "pending").reduce((sum, row) => sum + row.possiblePoints, 0),
    rivalExposure: rivals === null ? null : cohort.slice(1).map((entry, index) => {
      const picks = futurePicks(index + 1, teamId);
      return { entryId: entry.id, label: entry.label,
        pickedHere: entry.picks[gameId] === teamId,
        immediatePointsIfWinner: entry.picks[gameId] === teamId ? entry.rules[game.roundKey] : 0,
        futurePicks: picks, futureCeilingLostIfEliminatedHere: picks.reduce((sum, row) => sum + row.points, 0),
        currentFuturePoints: currentScores[index + 1].breakdown.filter((row) => descendants.has(row.gameId) && row.pickedTeamId === teamId && row.status === "pending").reduce((sum, row) => sum + row.possiblePoints, 0) };
    }),
    selectedCount: input.rivals === null ? null : cohort.filter((entry) => entry.picks[gameId] === teamId).length,
    championEntries: rivals === null ? null : cohort.flatMap((entry, index) => entry.picks[championGame.id] === teamId
      ? [{ entryId: entry.id, label: entry.label, isSubject: index === 0,
        aliveBefore: ["pending", "correct"].includes(scores[index].breakdown.find((row) => row.gameId === championGame.id)!.status),
        alive: ["pending", "correct"].includes(currentScores[index]
          .breakdown.find((row) => row.gameId === championGame.id)!.status) }] : []),
    longerRivalPaths: rivals === null ? null : cohort.slice(1).flatMap((entry, index) => {
      const picks = futurePicks(index + 1, teamId);
      const ownLastRound = Math.max(game.roundOrder, ...futurePicks(0, teamId).map((row) => games.find((g) => g.id === row.gameId)!.roundOrder));
      return picks.some((row) => games.find((g) => g.id === row.gameId)!.roundOrder > ownLastRound)
        ? [{ entryId: entry.id, label: entry.label, futurePicks: picks }] : [];
    }),
    nextDifferentPick: subject.picks[gameId] === teamId ? (() => {
      const next = games.find((node) => descendants.has(node.id) && node.sources.some((source) => source.type === "winner" &&
        (source.gameId === gameId || (descendants.has(source.gameId) && subject.picks[source.gameId] === teamId))) && subject.picks[node.id] && subject.picks[node.id] !== teamId);
      return next ? { gameId: next.id, roundKey: next.roundKey, teamId: subject.picks[next.id]! } : null;
    })() : null,
  }));
  const outcomes = matchupConfirmed ? (winner ? [winner] : eligible).map((teamId) => {
    const loserTeamId = participants.find((id) => id !== teamId)!;
    const impacts = cohort.map((entry, index) => {
      const lostPicks = futurePicks(index, loserTeamId);
      const immediatePoints = entry.picks[gameId] === teamId ? entry.rules[game.roundKey] : 0;
      return { entryId: entry.id, label: entry.label, immediatePoints, lostPicks,
        futureCeilingLost: lostPicks.reduce((sum, row) => sum + row.points, 0) };
    });
    return { teamId, loserTeamId, confirmed: Boolean(winner), subject: impacts[0],
      rivals: rivals === null ? null : impacts.slice(1).map((impact) => ({ ...impact,
        immediateDifference: impacts[0].immediatePoints - impact.immediatePoints })),
      sameImmediatePoints: rivals === null ? null : impacts.slice(1).every((row) => row.immediatePoints === impacts[0].immediatePoints),
    };
  }) : [];
  const complete = games.every((node) => Boolean(results[node.id]));
  const entryStates = cohort.map((entry, index) => ({ entryId: entry.id, label: entry.label, isSubject: index === 0,
    earned: currentScores[index].pointsEarned, remaining: currentScores[index].pointsStillAvailable,
    championPick: entry.picks[championGame.id] ?? null,
    championStatus: currentScores[index].breakdown.find((row) => row.gameId === championGame.id)!.status,
    gamePick: entry.picks[gameId] ?? null,
    gamePoints: currentScores[index].breakdown.find((row) => row.gameId === gameId)!.awardedPoints }));
  const finalStandings = complete && rivals !== null ? [...entryStates].sort((a, b) => b.earned - a.earned || String(a.entryId).localeCompare(String(b.entryId)))
    .map((row, index, rows) => ({ ...row, rank: rows.findIndex((other) => other.earned === row.earned) + 1,
      tied: rows.filter((other) => other.earned === row.earned).length > 1 })) : null;
  const futureSplits = rivals === null ? [] : games.filter((node) => descendants.has(node.id) && !results[node.id]).flatMap((node) => {
    const counts = new Map<string, number>();
    cohort.forEach((entry, index) => {
      const status = currentScores[index].breakdown.find((row) => row.gameId === node.id)!;
      if (status.status === "pending" && status.pickedTeamId) counts.set(status.pickedTeamId, (counts.get(status.pickedTeamId) ?? 0) + 1);
    });
    return counts.size > 1 ? [{ gameId: node.id, roundKey: node.roundKey, teams: [...counts].map(([teamId, count]) => ({ teamId, count })) }] : [];
  });
  return { gameId, roundKey: game.roundKey, matchupConfirmed, participants, officialWinner: winner,
    roundOrder: game.roundOrder, isChampionship: gameId === championGame.id, tournamentComplete: complete,
    championship: { gameId: championGame.id, winner: results[championGame.id] ?? null,
      runnerUp: results[championGame.id] ? resolveBracketGame(topology, championGame.id, results).teamIds.find((id) => id !== results[championGame.id]) ?? null : null },
    entryStates, finalStandings, futureSplits,
    personalPath: derivePersonalGamePath(topology, gameId, subject.picks, results, subject.rules),
    subject: { pick: pick.pickedTeamId, pickStatus: pick.status, eligibleToScore: pick.status === "pending" || pick.status === "correct",
      pointsEarned: current.pointsEarned, remainingPotential: current.pointsStillAvailable,
      gamePointsEarned: pick.awardedPoints },
    totalEntries: rivals === null ? null : cohort.length, otherEntries: rivals?.length ?? null, exposure, outcomes };
}

export type GameImplications = ReturnType<typeof deriveGameImplications>;
