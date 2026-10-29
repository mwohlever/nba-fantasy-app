import 'server-only';

import { ingestNbaProjectionObservations } from './projectionIngestion.server';
import { loadActiveResolvedNbaPlayerIds, loadNbaProviderIdentities, upsertNbaProjectionObservations } from './projectionRepository.server';

/** One bounded operational batch: ingest current/prior history, no forecast generation. */
export async function refreshNbaProjectionBatch(input: { season: number; providerPlayerIds?: readonly string[]; asOf: string; generatedAt?: string }) {
  const identities = await loadNbaProviderIdentities();
  const activePlayerIds = new Set(await loadActiveResolvedNbaPlayerIds());
  const selected = identities.filter(identity => identity.status === 'resolved' && identity.playerId !== null && activePlayerIds.has(identity.playerId)
    && (input.providerPlayerIds === undefined || input.providerPlayerIds.includes(identity.providerPlayerId)));
  const ingestion = await ingestNbaProjectionObservations({ season: input.season, providerPlayerIds: selected.map(identity => identity.providerPlayerId),
    repository: { loadProviderIdentities: async () => identities, upsertObservations: upsertNbaProjectionObservations } });
  return { ...ingestion, generated: 0, projectionRetired: true };
}
