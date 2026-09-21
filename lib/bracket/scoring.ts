import {
  BracketPicks,
  BracketPickStatus,
  BracketResults,
  BracketScore,
  BracketScoreBreakdown,
  BracketScoringRules,
  BracketTopology,
} from "./types";
import {
  orderedBracketGames,
  resolveBracketGame,
  validateBracketPicks,
  validateBracketTopology,
} from "./topology";

function pointsForRound(
  roundKey: string,
  scoringRules: BracketScoringRules,
): number {
  const points = scoringRules[roundKey];

  if (
    typeof points !== "number" ||
    !Number.isFinite(points) ||
    points < 0
  ) {
    throw new Error(`Missing or invalid scoring value for round ${roundKey}.`);
  }

  return points;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the round-value map stored in a frozen contest/entry rule snapshot.
 * New snapshots should use `{ scoring: { roundPoints: { [roundKey]: number } } }`.
 * The direct `scoring` map is accepted for the early Bracket Challenge snapshot
 * shape, but no mutable contest rule is ever consulted here.
 */
export function bracketScoringRulesFromSnapshot(
  rulesSnapshot: unknown,
  topology: BracketTopology,
): BracketScoringRules {
  if (!isRecord(rulesSnapshot) || !isRecord(rulesSnapshot.scoring)) {
    throw new Error("Frozen bracket entry is missing a scoring rules snapshot.");
  }

  const scoring = rulesSnapshot.scoring;
  const nested = isRecord(scoring.roundPoints)
    ? scoring.roundPoints
    : isRecord(scoring.round_points)
      ? scoring.round_points
      : scoring;
  const rules: BracketScoringRules = {};

  for (const game of topology.games) {
    const points = nested[game.roundKey];

    if (typeof points !== "number" || !Number.isFinite(points) || points < 0) {
      throw new Error(
        `Frozen bracket scoring rules are missing a valid value for round ${game.roundKey}.`,
      );
    }

    rules[game.roundKey] = points;
  }

  return rules;
}

/**
 * Produces the result map consumed by the scorer from persisted/provider game
 * state. Only a final game has an authoritative winner.
 */
export function bracketResultsFromOfficialGames(
  games: Array<{
    gameId: string;
    status: string;
    winnerTeamId: string | null;
  }>,
): BracketResults {
  const results: BracketResults = {};

  for (const game of games) {
    if (game.status !== "final") {
      if (game.winnerTeamId !== null) {
        throw new Error(
          `Non-final bracket game ${game.gameId} cannot have an official winner.`,
        );
      }
      continue;
    }

    if (!game.winnerTeamId) {
      throw new Error(
        `Final bracket game ${game.gameId} is missing its official winner.`,
      );
    }

    results[game.gameId] = game.winnerTeamId;
  }

  return results;
}

/**
 * Official results must follow the actual bracket path, not an entrant's
 * predicted path. This catches malformed provider/manual corrections before
 * they can score an entry incorrectly.
 */
export function validateBracketResults(
  topology: BracketTopology,
  results: BracketResults,
): void {
  validateBracketTopology(topology);

  const gameIds = new Set(topology.games.map((game) => game.id));

  for (const [gameId, winnerTeamId] of Object.entries(results)) {
    if (winnerTeamId != null && !gameIds.has(gameId)) {
      throw new Error(`Result references unknown bracket game ${gameId}.`);
    }
  }

  for (const game of orderedBracketGames(topology)) {
    const winnerTeamId = results[game.id] ?? null;

    if (winnerTeamId === null) continue;

    const actualGame = resolveBracketGame(topology, game.id, results);

    if (actualGame.teamIds.includes(null)) {
      throw new Error(
        `Official result for bracket game ${game.id} is missing an earlier official result.`,
      );
    }

    if (!actualGame.teamIds.includes(winnerTeamId)) {
      throw new Error(
        `Official winner ${winnerTeamId} is not eligible for bracket game ${game.id}.`,
      );
    }
  }
}

function eliminatedTeamsFromResults(
  topology: BracketTopology,
  results: BracketResults,
): Set<string> {
  const eliminated = new Set<string>();

  for (const game of orderedBracketGames(topology)) {
    const winnerTeamId = results[game.id] ?? null;

    if (winnerTeamId === null) continue;

    const actualGame = resolveBracketGame(topology, game.id, results);

    for (const teamId of actualGame.teamIds) {
      if (teamId !== null && teamId !== winnerTeamId) {
        eliminated.add(teamId);
      }
    }
  }

  return eliminated;
}

function statusForPick(input: {
  pickedTeamId: string | null;
  winnerTeamId: string | null;
  eliminatedTeams: Set<string>;
}): BracketPickStatus {
  if (input.pickedTeamId === null) return "unmade";

  if (input.winnerTeamId !== null) {
    return input.pickedTeamId === input.winnerTeamId
      ? "correct"
      : "incorrect";
  }

  return input.eliminatedTeams.has(input.pickedTeamId)
    ? "eliminated"
    : "pending";
}

export function scoreBracket(
  topology: BracketTopology,
  picks: BracketPicks,
  results: BracketResults,
  scoringRules: BracketScoringRules,
): BracketScore {
  validateBracketTopology(topology);
  validateBracketPicks(topology, picks);
  validateBracketResults(topology, results);

  const eliminatedTeams = eliminatedTeamsFromResults(topology, results);
  let pointsEarned = 0;
  let pointsStillAvailable = 0;
  let totalPotentialAtLock = 0;
  let possibleSettledPoints = 0;
  let correctPicks = 0;
  let incorrectPicks = 0;
  let pendingPicks = 0;
  let eliminatedPicks = 0;
  let unmadePicks = 0;

  const breakdown: BracketScoreBreakdown[] = orderedBracketGames(topology).map(
    (game) => {
      const possiblePoints = pointsForRound(game.roundKey, scoringRules);
      const pickedTeamId = picks[game.id] ?? null;
      const winnerTeamId = results[game.id] ?? null;
      const status = statusForPick({
        pickedTeamId,
        winnerTeamId,
        eliminatedTeams,
      });
      const correct =
        status === "correct" ? true : status === "incorrect" ? false : null;
      const awardedPoints = status === "correct" ? possiblePoints : 0;

      if (pickedTeamId !== null) totalPotentialAtLock += possiblePoints;

      switch (status) {
        case "correct":
          possibleSettledPoints += possiblePoints;
          pointsEarned += awardedPoints;
          correctPicks += 1;
          break;
        case "incorrect":
          possibleSettledPoints += possiblePoints;
          incorrectPicks += 1;
          break;
        case "pending":
          pointsStillAvailable += possiblePoints;
          pendingPicks += 1;
          break;
        case "eliminated":
          eliminatedPicks += 1;
          break;
        case "unmade":
          unmadePicks += 1;
          break;
      }

      return {
        gameId: game.id,
        roundKey: game.roundKey,
        pickedTeamId,
        winnerTeamId,
        status,
        possiblePoints,
        awardedPoints,
        correct,
      };
    },
  );

  const rounds = [
    ...new Map(
      orderedBracketGames(topology).map((game) => [
        game.roundKey,
        {
          roundKey: game.roundKey,
          roundOrder: game.roundOrder,
          pointsEarned: 0,
          pointsStillAvailable: 0,
          maxPossibleScore: 0,
          correctPicks: 0,
          incorrectPicks: 0,
          pendingPicks: 0,
          eliminatedPicks: 0,
          unmadePicks: 0,
        },
      ]),
    ).values(),
  ];
  const roundByKey = new Map(rounds.map((round) => [round.roundKey, round]));

  for (const pick of breakdown) {
    const round = roundByKey.get(pick.roundKey)!;
    if (pick.status === "correct") {
      round.pointsEarned += pick.awardedPoints;
      round.correctPicks += 1;
    } else if (pick.status === "incorrect") {
      round.incorrectPicks += 1;
    } else if (pick.status === "pending") {
      round.pointsStillAvailable += pick.possiblePoints;
      round.pendingPicks += 1;
    } else if (pick.status === "eliminated") {
      round.eliminatedPicks += 1;
    } else {
      round.unmadePicks += 1;
    }
  }

  for (const round of rounds) {
    round.maxPossibleScore = round.pointsEarned + round.pointsStillAvailable;
  }

  return {
    points: pointsEarned,
    pointsEarned,
    pointsStillAvailable,
    maxPossibleScore: pointsEarned + pointsStillAvailable,
    totalPotentialAtLock,
    pointsLost: totalPotentialAtLock - pointsEarned - pointsStillAvailable,
    possibleSettledPoints,
    correctPicks,
    incorrectPicks,
    pendingPicks,
    eliminatedPicks,
    unsettledPicks: pendingPicks,
    unmadePicks,
    breakdown,
    rounds,
  };
}

export function maximumPossibleBracketPoints(
  topology: BracketTopology,
  picks: BracketPicks,
  results: BracketResults,
  scoringRules: BracketScoringRules,
): number {
  const score = scoreBracket(topology, picks, results, scoringRules);

  return score.maxPossibleScore;
}

export type BracketPickViability = {
  gameId: string;
  pickedTeamId: string | null;
  status: "unmade" | "alive" | "correct" | "incorrect" | "eliminated";
};

export function bracketPickViability(
  topology: BracketTopology,
  picks: BracketPicks,
  results: BracketResults,
): BracketPickViability[] {
  validateBracketTopology(topology);
  validateBracketPicks(topology, picks);

  return scoreBracket(
    topology,
    picks,
    results,
    Object.fromEntries(topology.games.map((game) => [game.roundKey, 0])),
  ).breakdown.map((pick) => ({
    gameId: pick.gameId,
    pickedTeamId: pick.pickedTeamId,
    status: pick.status === "pending" ? "alive" : pick.status,
  }));
}
