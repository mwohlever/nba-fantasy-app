import { NFL_PROJECTION_V2, nflProjectionCacheRecord, projectNflV2O1Raw, type NflObservationVersionRecord, type NflProjectionCacheRecord } from "./projectionInfrastructure";
import type { NflEligiblePlayer } from "./observationIngestion";

export type NflProjectionGenerationRepository = {
  loadHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }): Promise<Map<number, NflObservationVersionRecord[]>>;
  appendStatCache(rows: readonly NflProjectionCacheRecord[]): Promise<void>;
};

/** Generates global raw-stat shadow cache rows only. No scoring, slate, or group enters this path. */
export async function generateNflProjectionStatCache(input: { repository: NflProjectionGenerationRepository; players: readonly NflEligiblePlayer[]; targetSeason: number; asOf: string; generatedAt?: string }) {
  const players = [...new Map(input.players.map(player => [player.localPlayerId, player])).values()].sort((a, b) => a.localPlayerId - b.localPlayerId);
  const histories = await input.repository.loadHistories({ playerIds: players.map(player => player.localPlayerId), targetSeason: input.targetSeason, asOf: input.asOf });
  const cacheRows: NflProjectionCacheRecord[] = [], unavailable: Array<{ playerId: number; reason: "zero_current_season_history" }> = [];
  for (const player of players) {
    const projection = projectNflV2O1Raw({ playerId: player.localPlayerId, providerPlayerId: player.providerPlayerId, position: player.position, season: input.targetSeason, asOf: input.asOf, history: histories.get(player.localPlayerId) ?? [] });
    if (!projection) { unavailable.push({ playerId: player.localPlayerId, reason: "zero_current_season_history" }); continue; }
    cacheRows.push(nflProjectionCacheRecord({ playerId: player.localPlayerId, providerPlayerId: player.providerPlayerId, position: player.position, season: input.targetSeason, asOf: input.asOf, generatedAt: input.generatedAt ?? input.asOf, projection }));
  }
  if (cacheRows.length) await input.repository.appendStatCache(cacheRows);
  return { modelVersion: NFL_PROJECTION_V2, generated: cacheRows, unavailable, cached: cacheRows.length };
}
