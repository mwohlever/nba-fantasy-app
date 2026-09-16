import { createNbaCandidate } from './candidates';
import { statCacheRecordFromProjection, type NbaObservationRecord, type NbaProjectionStatCacheRecord } from './projectionInfrastructure';
import { nbaObservationFromRecord } from './projectionInfrastructure';

export type NbaProjectionGenerationRepository = {
  loadHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }): Promise<Map<number, {
    observations: readonly NbaObservationRecord[]; latestGameAt: string | null; latestUpdatedAt: string | null;
  }>>;
  upsertStatCache(rows: readonly NbaProjectionStatCacheRecord[]): Promise<void>;
};

export const NBA_PROJECTION_V2 = 'nba-v2-robust50i25-recent15-v1' as const;
const selectedCandidate = createNbaCandidate({ id: NBA_PROJECTION_V2,
  minutes: { kind: 'robust', window: 8, halfLife: 3, lowRatio: .5, lowInfluence: .25 },
  rates: { kind: 'recent', window: 15 }, priorFallback: true });

/** Generates rule-independent stat-line cache rows. Slate-specific scoring occurs on read. */
export async function generateNbaProjectionStatCache(input: {
  repository: NbaProjectionGenerationRepository; playerIds: readonly number[]; targetSeason: number; asOf: string; generatedAt?: string;
}) {
  const histories = await input.repository.loadHistories(input);
  const generated: Array<{ playerId: string }> = [];
  const unavailable: number[] = [];
  const cacheRows: NbaProjectionStatCacheRecord[] = [];
  for (const playerId of [...new Set(input.playerIds)].filter(id => Number.isSafeInteger(id) && id > 0)) {
    const history = histories.get(playerId);
    if (!history?.observations.length) { unavailable.push(playerId); continue; }
    const observations = history.observations.map(nbaObservationFromRecord);
    const candidate = selectedCandidate({ target: { id: `cache:${playerId}`, provider: 'espn', providerPlayerId: history.observations[0].provider_player_id,
      eventId: `cache:${playerId}`, gameAt: input.asOf, asOf: input.asOf, season: input.targetSeason, phase: 'regular' }, history: observations,
      scoring: { points: 1, rebounds: 1.2, assists: 1.5, steals: 2, blocks: 2, turnovers: -1 } });
    const projection = candidate && { playerId: `111:nba:players:${playerId}`, modelVersion: candidate.modelVersion, asOf: candidate.asOf,
      generatedAt: input.generatedAt ?? input.asOf, projectedStats: candidate.projectedStats!, projectedParticipation: { expectedMinutes: candidate.expectedMinutes! },
      confidence: candidate.confidence, sample: { currentSeasonGames: candidate.components.currentSeasonGames, productionESS: candidate.components.productionESS,
        minutesESS: candidate.components.minutesESS }, components: candidate.components, fallbackReason: candidate.fallbackReason };
    if (!projection) { unavailable.push(playerId); continue; }
    generated.push(projection);
    cacheRows.push(statCacheRecordFromProjection({ projection, sourceLatestGameAt: history?.latestGameAt ?? null,
      sourceLatestUpdatedAt: history?.latestUpdatedAt ?? null }));
  }
  if (cacheRows.length) await input.repository.upsertStatCache(cacheRows);
  return { modelVersion: NBA_PROJECTION_V2, generated, unavailable, cached: cacheRows.length };
}
