import { type NflObservationVersionRecord, type NflProjectionCacheRecord } from "./projectionInfrastructure";
import type { NflEligiblePlayer } from "./observationIngestion";

export type NflProjectionGenerationRepository = {
  loadHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }): Promise<Map<number, NflObservationVersionRecord[]>>;
  appendStatCache(rows: readonly NflProjectionCacheRecord[]): Promise<void>;
};

/** Generates global raw-stat shadow cache rows only. No scoring, slate, or group enters this path. */
export async function generateNflProjectionStatCache(input: { repository: NflProjectionGenerationRepository; players: readonly NflEligiblePlayer[]; targetSeason: number; asOf: string; generatedAt?: string }) {
  void input;
  throw new Error("NBA/NFL player projection generation has been retired.");
}
