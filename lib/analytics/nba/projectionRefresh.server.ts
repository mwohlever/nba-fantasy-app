import 'server-only';

import { generateNbaProjectionStatCache } from './projectionGeneration.server';
import { ingestNbaProjectionObservations } from './projectionIngestion.server';
import { loadActiveResolvedNbaPlayerIds, loadNbaProviderIdentities, nbaProjectionGenerationRepository, upsertNbaProjectionObservations } from './projectionRepository.server';

/** One bounded operational batch: ingest current/prior history, then refresh global stat-line cache. */
export async function refreshNbaProjectionBatch(input: { season: number; providerPlayerIds?: readonly string[]; asOf: string; generatedAt?: string }) {
  const identities = await loadNbaProviderIdentities();
  const activePlayerIds = new Set(await loadActiveResolvedNbaPlayerIds());
  const selected = identities.filter(identity => identity.status === 'resolved' && identity.playerId !== null && activePlayerIds.has(identity.playerId)
    && (input.providerPlayerIds === undefined || input.providerPlayerIds.includes(identity.providerPlayerId)));
  const ingestion = await ingestNbaProjectionObservations({ season: input.season, providerPlayerIds: selected.map(identity => identity.providerPlayerId),
    repository: { loadProviderIdentities: async () => identities, upsertObservations: upsertNbaProjectionObservations } });
  const projections = await generateNbaProjectionStatCache({ repository: nbaProjectionGenerationRepository(), playerIds: selected.map(identity => identity.playerId!),
    targetSeason: input.season, asOf: input.asOf, generatedAt: input.generatedAt });
  return { ...ingestion, generated: projections.generated.length, unavailable: projections.unavailable, modelVersion: projections.modelVersion };
}
