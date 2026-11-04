/** Retired NBA forecasting entry points. Historical snapshot columns remain untouched. */
type RetiredProjection = { playerId: number; playerName: string; projection: number | null; source: string | null; confidence: string | null; badges: string[]; draftedCount: number; seasonAvg: number | null; recentAvg: number | null; avgFinish: number | null; nbaSeasonAverage: number | null };
export async function getPlayerProjectionsForSeason(_season: string): Promise<{ season: string; nbaSeason: string; projections: Record<number, RetiredProjection>; projectionByPlayerId: Map<number, number> }> {
  void _season;
  throw new Error("NBA/NFL player projections have been retired.");
}
export async function getPlayerProjectionMapForSeason(_season: string): Promise<Map<number, number>> {
  void _season;
  throw new Error("NBA/NFL player projections have been retired.");
}
