/** Client-safe Draft projection display and ordering contract. */
export type DraftProjection = {
  projection: number | null;
  source: "nba_v2" | "nfl_v2" | "legacy_nba" | "historical_fantasy_average" | "unavailable";
  modelVersion: string | null;
  confidence: string | null;
  badges?: string[];
};

/** Keeps the established historical 111 fantasy average without mislabeling it as V2. */
export function withHistoricalFantasyAverage(
  cached: DraftProjection | undefined,
  historicalAverage: number | undefined,
): DraftProjection {
  if (cached) return cached;
  return Number.isFinite(Number(historicalAverage)) && Number(historicalAverage) > 0
    ? { projection: Number(historicalAverage), source: "historical_fantasy_average", modelVersion: null, confidence: null }
    : { projection: null, source: "unavailable", modelVersion: null, confidence: null };
}

/** V2 always ranks above an optional legacy fallback; unavailable stays last. */
export function compareDraftProjections(
  left: DraftProjection | undefined,
  right: DraftProjection | undefined,
) {
  const rank = (value: DraftProjection | undefined) =>
    value?.source === "nba_v2" || value?.source === "nfl_v2"
      ? 0
      : value?.projection !== null && value?.projection !== undefined
        ? 1
        : 2;
  const leftRank = rank(left);
  const rightRank = rank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftValue = Number(left?.projection);
  const rightValue = Number(right?.projection);
  const safeLeft = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
  const safeRight = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;
  return safeRight - safeLeft;
}
