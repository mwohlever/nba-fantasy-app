import { type NbaObservationRecord, type NbaProjectionStatCacheRecord } from './projectionInfrastructure';

export type NbaProjectionGenerationRepository = {
  loadHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }): Promise<Map<number, {
    observations: readonly NbaObservationRecord[]; latestGameAt: string | null; latestUpdatedAt: string | null;
  }>>;
  upsertStatCache(rows: readonly NbaProjectionStatCacheRecord[]): Promise<void>;
};

export const NBA_PROJECTION_V2 = 'nba-v2-robust50i25-recent15-v1' as const;
/** Generates rule-independent stat-line cache rows. Slate-specific scoring occurs on read. */
export async function generateNbaProjectionStatCache(input: {
  repository: NbaProjectionGenerationRepository; playerIds: readonly number[]; targetSeason: number; asOf: string; generatedAt?: string;
}) {
  void input;
  throw new Error("NBA/NFL player projection generation has been retired.");
}
