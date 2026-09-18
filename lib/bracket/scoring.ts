import {
  BracketPicks,
  BracketResults,
  BracketScore,
  BracketScoringRules,
  BracketTopology,
} from "./types";
import {
  orderedBracketGames,
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

export function scoreBracket(
  topology: BracketTopology,
  picks: BracketPicks,
  results: BracketResults,
  scoringRules: BracketScoringRules,
): BracketScore {
  validateBracketTopology(topology);
  validateBracketPicks(topology, picks);

  let points = 0;
  let possibleSettledPoints = 0;
  let correctPicks = 0;
  let incorrectPicks = 0;
  let unsettledPicks = 0;
  let unmadePicks = 0;

  const breakdown = orderedBracketGames(topology).map((game) => {
    const possiblePoints = pointsForRound(game.roundKey, scoringRules);
    const pickedTeamId = picks[game.id] ?? null;
    const winnerTeamId = results[game.id] ?? null;

    let awardedPoints = 0;
    let correct: boolean | null = null;

    if (pickedTeamId === null) {
      unmadePicks += 1;
    } else if (winnerTeamId === null) {
      unsettledPicks += 1;
    } else {
      possibleSettledPoints += possiblePoints;
      correct = pickedTeamId === winnerTeamId;

      if (correct) {
        awardedPoints = possiblePoints;
        points += possiblePoints;
        correctPicks += 1;
      } else {
        incorrectPicks += 1;
      }
    }

    return {
      gameId: game.id,
      roundKey: game.roundKey,
      pickedTeamId,
      winnerTeamId,
      possiblePoints,
      awardedPoints,
      correct,
    };
  });

  return {
    points,
    possibleSettledPoints,
    correctPicks,
    incorrectPicks,
    unsettledPicks,
    unmadePicks,
    breakdown,
  };
}

export function maximumPossibleBracketPoints(
  topology: BracketTopology,
  picks: BracketPicks,
  results: BracketResults,
  scoringRules: BracketScoringRules,
): number {
  const score = scoreBracket(topology, picks, results, scoringRules);

  return score.breakdown.reduce((total, game) => {
    if (game.pickedTeamId === null) {
      return total;
    }

    if (game.winnerTeamId === null || game.correct === true) {
      return total + game.possiblePoints;
    }

    return total;
  }, 0);
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

  const eliminatedTeams = new Set<string>();

  return orderedBracketGames(topology).map((game) => {
    const pickedTeamId = picks[game.id] ?? null;
    const winnerTeamId = results[game.id] ?? null;

    if (winnerTeamId !== null) {
      for (const source of game.sources) {
        if (source.type === "team" && source.teamId !== winnerTeamId) {
          eliminatedTeams.add(source.teamId);
        }

        if (source.type === "winner") {
          const sourcePick = picks[source.gameId] ?? null;
          const sourceWinner = results[source.gameId] ?? null;

          if (
            sourceWinner !== null &&
            sourcePick !== null &&
            sourcePick !== sourceWinner
          ) {
            eliminatedTeams.add(sourcePick);
          }
        }
      }
    }

    if (pickedTeamId === null) {
      return {
        gameId: game.id,
        pickedTeamId,
        status: "unmade",
      };
    }

    if (winnerTeamId !== null) {
      return {
        gameId: game.id,
        pickedTeamId,
        status:
          pickedTeamId === winnerTeamId
            ? "correct"
            : "incorrect",
      };
    }

    return {
      gameId: game.id,
      pickedTeamId,
      status: eliminatedTeams.has(pickedTeamId)
        ? "eliminated"
        : "alive",
    };
  });
}
