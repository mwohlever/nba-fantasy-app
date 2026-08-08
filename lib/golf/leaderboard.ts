export type GolfLeaderboardRankInput = {
  id: number;
  score?: number | null;
  fallbackOrder?: number | null;
  status?: string | null;
};

export type GolfLeaderboardRank = {
  position: number;
  tied: boolean;
  display: string;
};

const EXCLUDED_STATUSES = new Set([
  "withdrawn",
  "disqualified",
  "did_not_start",
]);

export function buildGolfLeaderboardRanks(
  rows: GolfLeaderboardRankInput[],
) {
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
        normalizedStatus: String(
          row.status ?? "",
        ).toLowerCase(),
      };
    })
    .filter(
      (
        row,
      ): row is typeof row & {
        score: number;
      } =>
        row.score !== null &&
        Number.isFinite(row.score) &&
        !EXCLUDED_STATUSES.has(
          row.normalizedStatus,
        ),
    )
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }

      return (
        Number(
          a.fallbackOrder ??
            Number.MAX_SAFE_INTEGER,
        ) -
        Number(
          b.fallbackOrder ??
            Number.MAX_SAFE_INTEGER,
        )
      );
    });

  const countByScore =
    new Map<number, number>();

  for (const row of scored) {
    countByScore.set(
      row.score,
      (countByScore.get(row.score) ?? 0) +
        1,
    );
  }

  const firstRankByScore =
    new Map<number, number>();

  scored.forEach((row, index) => {
    if (
      !firstRankByScore.has(row.score)
    ) {
      firstRankByScore.set(
        row.score,
        index + 1,
      );
    }
  });

  const result =
    new Map<number, GolfLeaderboardRank>();

  for (const row of scored) {
    const position =
      firstRankByScore.get(row.score)!;

    const tied =
      (countByScore.get(row.score) ?? 0) >
      1;

    result.set(row.id, {
      position,
      tied,
      display: tied
        ? `T${position}`
        : String(position),
    });
  }

  return result;
}
