import { fetchEspnNbaGameLog } from '../providers/espnNbaGameLog';
import { observationRecordFromNbaObservation, resolveStoredNbaProviderIdentity, type NbaObservationRecord, type NbaProviderIdentity } from './projectionInfrastructure';

export type NbaProjectionIngestionRepository = {
  loadProviderIdentities(): Promise<NbaProviderIdentity[]>;
  upsertObservations(rows: readonly NbaObservationRecord[]): Promise<void>;
};

export type NbaGameLogFetcher = typeof fetchEspnNbaGameLog;

/** Trusted worker payload path: validate again, bind only reviewed identities, and append immutable evidence. */
export async function persistNbaProjectionObservations(input: { repository: NbaProjectionIngestionRepository; observations: readonly import('./types').NbaObservation[] }) {
  const identities = await input.repository.loadProviderIdentities();
  const records: NbaObservationRecord[] = [], skipped: string[] = [];
  for (const observation of input.observations) {
    const resolved = resolveStoredNbaProviderIdentity(observation.providerPlayerId, identities);
    const record = observationRecordFromNbaObservation(observation, resolved.playerId);
    if (record) records.push(record); else skipped.push(`${observation.providerPlayerId}:${observation.eventId}`);
  }
  if (records.length) await input.repository.upsertObservations(records);
  return { accepted: records.length, unresolved: records.filter(record => record.local_player_id === null).length, skipped };
}

/**
 * Bounded, server-side ESPN acquisition. It stores only eligible final regular
 * season appearances; DNP/in-progress/incomplete provider rows cannot enter
 * the normalized table. Corrections append a new immutable content version.
 */
export async function ingestNbaProjectionObservations(input: {
  repository: NbaProjectionIngestionRepository; season: number; providerPlayerIds?: readonly string[];
  fetchGameLog?: NbaGameLogFetcher;
}) {
  if (!Number.isInteger(input.season) || input.season < 2000 || input.season > 2100) throw new Error('Valid NBA season required');
  const identities = await input.repository.loadProviderIdentities();
  const requested = input.providerPlayerIds ? new Set(input.providerPlayerIds) : null;
  const selected = identities.filter(identity => requested === null || requested.has(identity.providerPlayerId));
  if (selected.length > 50) throw new Error('NBA projection ingestion accepts at most 50 provider athletes per batch');
  const fetchGameLog = input.fetchGameLog ?? fetchEspnNbaGameLog;
  const records: NbaObservationRecord[] = [];
  const diagnostics: Array<{ providerPlayerId: string; season: number; error: string }> = [];
  for (const identity of selected) {
    for (const season of [input.season - 1, input.season]) {
      try {
        const result = await fetchGameLog({ espnPlayerId: identity.providerPlayerId, season });
        const resolved = resolveStoredNbaProviderIdentity(identity.providerPlayerId, identities);
        for (const observation of result.observations) {
          const record = observationRecordFromNbaObservation(observation, resolved.playerId);
          if (record) records.push(record);
        }
      } catch (error) {
        diagnostics.push({ providerPlayerId: identity.providerPlayerId, season, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  if (records.length) await input.repository.upsertObservations(records);
  return { requestedAthletes: selected.length, observationsUpserted: records.length,
    resolvedObservations: records.filter(record => record.local_player_id !== null).length,
    unresolvedObservations: records.filter(record => record.local_player_id === null).length, diagnostics };
}
