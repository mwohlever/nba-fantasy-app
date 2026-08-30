export const GOLF_TOURNAMENT_ROUNDS = 4;

export type GolfRoundScoreInput = {
  roundNumber: number;
  scoreToPar: number | null;
  holesCompleted: number;
};

export function calculateGolfPenaltyStrokes(input: {
  status: string;
  roundsCompleted: number;
  penaltyPerRound: number;
}): number {
  if (input.penaltyPerRound <= 0) {
    return 0;
  }

  const receivesMissingRoundPenalty = [
    "cut",
    "withdrawn",
    "disqualified",
  ].includes(input.status);

  if (!receivesMissingRoundPenalty) {
    return 0;
  }

  const missedRounds = Math.max(
    0,
    GOLF_TOURNAMENT_ROUNDS - input.roundsCompleted,
  );

  return missedRounds * input.penaltyPerRound;
}

/**
 * Decompose the already-settled canonical golfer score into four rounds.
 *
 * Actual round scoring is retained even for a partial round. The persisted
 * missing-round penalty is allocated to incomplete rounds using the same
 * per-round value used by tournament scoring. Any remaining difference is
 * assigned to the last incomplete round (or R4) so the decomposition always
 * reconciles to the persisted canonical fantasy score.
 */
export function decomposeGolfFantasyScoreByRound(input: {
  rounds: GolfRoundScoreInput[];
  penaltyStrokes: number;
  penaltyPerRound: number;
  fantasyScore: number;
}): [number, number, number, number] {
  const contributions: [number, number, number, number] = [0, 0, 0, 0];
  const incompleteRoundIndexes: number[] = [];

  const roundByNumber = new Map(
    input.rounds
      .filter(
        (round) =>
          Number.isInteger(round.roundNumber) &&
          round.roundNumber >= 1 &&
          round.roundNumber <= GOLF_TOURNAMENT_ROUNDS,
      )
      .map((round) => [round.roundNumber, round]),
  );

  for (let roundNumber = 1; roundNumber <= GOLF_TOURNAMENT_ROUNDS; roundNumber += 1) {
    const round = roundByNumber.get(roundNumber);
    const score = Number(round?.scoreToPar);

    if (
      round?.scoreToPar !== null &&
      round?.scoreToPar !== undefined &&
      Number.isFinite(score)
    ) {
      contributions[roundNumber - 1] = score;
    }

    if (Number(round?.holesCompleted ?? 0) < 18) {
      incompleteRoundIndexes.push(roundNumber - 1);
    }
  }

  let penaltyRemaining = Math.max(0, Number(input.penaltyStrokes) || 0);
  const perRoundPenalty = Math.max(0, Number(input.penaltyPerRound) || 0);

  for (const roundIndex of incompleteRoundIndexes) {
    if (penaltyRemaining <= 0) {
      break;
    }

    const allocation = Math.min(perRoundPenalty, penaltyRemaining);
    contributions[roundIndex] += allocation;
    penaltyRemaining -= allocation;
  }

  if (penaltyRemaining > 0) {
    const fallbackIndex = incompleteRoundIndexes.at(-1) ?? 3;
    contributions[fallbackIndex] += penaltyRemaining;
  }

  const decomposedTotal = contributions.reduce(
    (total, contribution) => total + contribution,
    0,
  );
  const reconciliation = input.fantasyScore - decomposedTotal;

  if (reconciliation !== 0) {
    const reconciliationIndex = incompleteRoundIndexes.at(-1) ?? 3;
    contributions[reconciliationIndex] += reconciliation;
  }

  return contributions;
}
