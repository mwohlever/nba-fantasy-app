export const DEFAULT_GOLF_CUT_SIZE = 65;

export type GolfCutLineInput = {
  score?: number | null;
  status?: string | null;
  position?: number | null;
  holesCompleted?: number | null;
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

  const official = rows.some(
    (row) =>
      String(
        row.status ?? "",
      ).toLowerCase() === "cut",
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
