export const DEFAULT_GOLF_CUT_SIZE = 65;

export type GolfCutLineInput = {
  score?: number | null;
  status?: string | null;
  position?: number | null;
  holesCompleted?: number | null;
  roundsCompleted?: number | null;
  currentRound?: number | null;
};

export type GolfCutLine = {
  score: number;
  display: string;
  inside: number;
  tiedAtCut: number;
  outside: number;
  official: boolean;
  cutSize: number;
  ruleLabel: string;
};

export function formatGolfCutScore(
  value: number,
) {
  if (value === 0) return "E";
  return value > 0
    ? `+${value}`
    : String(value);
}

export function calculateGolfCutLine(
  rows: GolfCutLineInput[],
  cutSize = DEFAULT_GOLF_CUT_SIZE,
): GolfCutLine | null {
  const excludedStatuses =
    new Set([
      "withdrawn",
      "disqualified",
      "did_not_start",
    ]);

  const scored = rows
    .map((row) => {
      const score =
        row.score === null ||
        row.score === undefined
          ? null
          : Number(row.score);

      return {
        ...row,
        score,
        normalizedStatus:
          String(
            row.status ?? "",
          ).toLowerCase(),
      };
    })
    .filter(
      (row) =>
        row.score !== null &&
        Number.isFinite(row.score) &&
        !excludedStatuses.has(
          row.normalizedStatus,
        ),
    );

  /*
   * Do not manufacture a projected cut before enough golfers have
   * posted a score to establish Top 65 + ties.
   */
  if (scored.length < cutSize) {
    return null;
  }

  const hasTournamentActivity =
    scored.some(
      (row) =>
        Number(
          row.holesCompleted ?? 0,
        ) > 0 ||
        [
          "active",
          "round_complete",
          "finished",
          "cut",
        ].includes(
          row.normalizedStatus,
        ),
    );

  if (!hasTournamentActivity) {
    return null;
  }

  const ordered = [...scored].sort(
    (a, b) => {
      const scoreDifference =
        Number(a.score) -
        Number(b.score);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return (
        Number(
          a.position ??
            Number.MAX_SAFE_INTEGER,
        ) -
        Number(
          b.position ??
            Number.MAX_SAFE_INTEGER,
        )
      );
    },
  );

  const cutScore =
    Number(
      ordered[cutSize - 1].score,
    );

  const inside = ordered.filter(
    (row) =>
      Number(row.score) <= cutScore,
  ).length;

  const tiedAtCut = ordered.filter(
    (row) =>
      Number(row.score) === cutScore,
  ).length;

  const outside = ordered.filter(
    (row) =>
      Number(row.score) > cutScore,
  ).length;

  const cutAlreadyReported =
    rows.some(
      (row) =>
        String(
          row.status ?? "",
        ).toLowerCase() === "cut",
    );

  /*
   * The cut becomes official when Round 2 is settled for every
   * scored golfer still relevant to the leaderboard.
   *
   * Do not depend on the provider already saying "cut": some feeds
   * leave everybody as round_complete between R2 and R3.
   */
  const roundTwoTerminalStatuses =
    new Set([
      "cut",
      "withdrawn",
      "disqualified",
      "did_not_start",
    ]);

  function hasSettledRoundTwo(
    row: (typeof scored)[number],
  ) {
    if (
      roundTwoTerminalStatuses.has(
        row.normalizedStatus,
      )
    ) {
      return true;
    }

    if (
      Number(
        row.roundsCompleted ?? 0,
      ) >= 2
    ) {
      return true;
    }

    if (
      Number(
        row.holesCompleted ?? 0,
      ) >= 36
    ) {
      return true;
    }

    /*
     * ESPN can report completion state before its aggregate
     * roundsCompleted / holesCompleted counters catch up.
     *
     * Either of these proves Round 2 is settled:
     *
     *   currentRound = 2 + round_complete
     *   currentRound >= 3
     *
     * The second case matters once the tournament has advanced to
     * Saturday: our normalizer can correctly mark a made-cut golfer
     * as scheduled for Round 3 even while ESPN's aggregate counters
     * still lag behind.
     */
    const currentRound =
      Number(
        row.currentRound ?? 0,
      );

    if (currentRound >= 3) {
      return true;
    }

    return (
      row.normalizedStatus ===
        "round_complete" &&
      currentRound >= 2
    );
  }

  const hasCompletedRoundTwo =
    scored.some(
      hasSettledRoundTwo,
    );

  const roundTwoIsSettled =
    scored.length > 0 &&
    scored.every(
      hasSettledRoundTwo,
    );

  const official =
    cutAlreadyReported ||
    (
      hasCompletedRoundTwo &&
      roundTwoIsSettled
    );

  return {
    score: cutScore,
    display:
      formatGolfCutScore(cutScore),
    inside,
    tiedAtCut,
    outside,
    official,
    cutSize,
    ruleLabel:
      `Top ${cutSize} + ties`,
  };
}
