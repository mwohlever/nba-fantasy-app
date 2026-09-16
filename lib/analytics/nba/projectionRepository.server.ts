import 'server-only';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { nbaObservationFromRecord, type NbaObservationRecord, type NbaProjectionStatCacheRecord, type NbaProviderIdentity } from './projectionInfrastructure';

const db = supabaseAdmin;
const batches = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_value, index) => items.slice(index * size, (index + 1) * size));
function fail(label: string, error: { message: string } | null) { if (error) throw new Error(`${label}: ${error.message}`); }

export type NbaProjectionHistory = {
  playerId: number;
  observations: ReturnType<typeof nbaObservationFromRecord>[];
  latestGameAt: string | null;
  latestUpdatedAt: string | null;
};

function asObservationRecord(row: Record<string, unknown>): NbaObservationRecord {
  const numeric = (key: string) => Number(row[key]);
  const text = (key: string) => row[key] == null ? null : String(row[key]);
  const required = (key: string) => String(row[key] ?? '');
  return { provider: 'espn', provider_player_id: required('provider_player_id'), provider_event_id: required('provider_event_id'),
    local_player_id: row.local_player_id === null ? null : numeric('local_player_id'), season: numeric('season'), phase: 'regular',
    game_at: required('game_at'), completed_at: text('completed_at'), team_provider_id: text('team_provider_id'), team_abbreviation: text('team_abbreviation'),
    opponent_provider_id: text('opponent_provider_id'), opponent_abbreviation: text('opponent_abbreviation'),
    home_away: row.home_away === 'home' || row.home_away === 'away' ? row.home_away : null,
    minutes: numeric('minutes'), points: numeric('points'), rebounds: numeric('rebounds'), assists: numeric('assists'), steals: numeric('steals'), blocks: numeric('blocks'), turnovers: numeric('turnovers'),
    source_url: required('source_url'), provider_fetched_at: required('provider_fetched_at'), provider_known_at: text('provider_known_at'),
    normalization_version: String(row.normalization_version) as NbaObservationRecord['normalization_version'], observation_hash: required('observation_hash') };
}

export async function loadNbaProjectionHistory(input: { playerId: number; targetSeason: number; asOf: string }): Promise<NbaProjectionHistory> {
  const result = await db.from('nba_player_game_observations').select('*').eq('local_player_id', input.playerId)
    .in('season', [input.targetSeason - 1, input.targetSeason]).lt('game_at', input.asOf).order('game_at', { ascending: true });
  fail('NBA projection history lookup failed', result.error);
  const rows = (result.data ?? []).map(row => asObservationRecord(row as Record<string, unknown>));
  return { playerId: input.playerId, observations: rows.map(nbaObservationFromRecord),
    latestGameAt: rows.at(-1)?.game_at ?? null, latestUpdatedAt: (result.data ?? []).at(-1)?.provider_fetched_at ? String((result.data ?? []).at(-1)!.provider_fetched_at) : null };
}

/** One bounded query per chunk, rather than one query per player. */
export async function loadNbaProjectionHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }) {
  const requested = [...new Set(input.playerIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  const histories = new Map<number, NbaProjectionHistory>(requested.map(playerId => [playerId, { playerId, observations: [], latestGameAt: null, latestUpdatedAt: null }]));
  for (const group of batches(requested, 200)) {
    const result = await db.from('nba_player_game_observations').select('*').in('local_player_id', group)
      .in('season', [input.targetSeason - 1, input.targetSeason]).lt('game_at', input.asOf).order('game_at', { ascending: true });
    fail('NBA batched projection history lookup failed', result.error);
    for (const raw of result.data ?? []) {
      const row = asObservationRecord(raw as Record<string, unknown>);
      if (row.local_player_id === null) continue;
      const history = histories.get(row.local_player_id)!;
      history.observations.push(nbaObservationFromRecord(row));
      history.latestGameAt = row.game_at;
      history.latestUpdatedAt = raw.provider_fetched_at ? String(raw.provider_fetched_at) : history.latestUpdatedAt;
    }
  }
  return histories;
}

export function nbaProjectionGenerationRepository() {
  return {
    async loadHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }) {
      const requested = [...new Set(input.playerIds.filter(id => Number.isSafeInteger(id) && id > 0))];
      const output = new Map<number, { observations: NbaObservationRecord[]; latestGameAt: string | null; latestUpdatedAt: string | null }>(
        requested.map(playerId => [playerId, { observations: [], latestGameAt: null, latestUpdatedAt: null }]),
      );
      for (const group of batches(requested, 200)) {
        const result = await db.from('nba_player_game_observations').select('*').in('local_player_id', group)
          .in('season', [input.targetSeason - 1, input.targetSeason]).lt('game_at', input.asOf).order('game_at', { ascending: true });
        fail('NBA batched projection generation history lookup failed', result.error);
        for (const raw of result.data ?? []) {
          const row = asObservationRecord(raw as Record<string, unknown>);
          if (row.local_player_id === null) continue;
          const history = output.get(row.local_player_id)!;
          history.observations.push(row); history.latestGameAt = row.game_at;
          history.latestUpdatedAt = raw.provider_fetched_at ? String(raw.provider_fetched_at) : history.latestUpdatedAt;
        }
      }
      return output;
    },
    upsertStatCache: upsertNbaProjectionStatCache,
  };
}

export async function loadNbaProviderIdentities(): Promise<NbaProviderIdentity[]> {
  const result = await db.from('nba_player_provider_identities')
    .select('provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked').eq('provider', 'espn');
  fail('NBA provider identity lookup failed', result.error);
  return (result.data ?? []).map(row => ({ provider: 'espn', providerPlayerId: String(row.provider_player_id),
    playerId: row.player_id === null ? null : Number(row.player_id), providerName: row.provider_name === null ? null : String(row.provider_name),
    status: row.resolution_status as NbaProviderIdentity['status'], method: row.resolution_method as NbaProviderIdentity['method'],
    evidence: String(row.evidence), locked: Boolean(row.is_locked) }));
}

export async function upsertNbaProjectionObservations(rows: readonly NbaObservationRecord[]) {
  for (const group of batches(rows, 200)) {
    // Evidence is append-only by content hash. A provider correction is a new
    // version; an identical repeated refresh is a harmless no-op.
    const result = await db.from('nba_player_game_observation_versions').upsert(group,
      { onConflict: 'provider,provider_player_id,provider_event_id,observation_hash', ignoreDuplicates: true });
    fail('NBA projection observation upsert failed', result.error);
  }
}

export async function upsertNbaProjectionStatCache(rows: readonly NbaProjectionStatCacheRecord[]) {
  for (const group of batches(rows, 200)) {
    const result = await db.from('nba_projection_stat_cache').upsert(group, { onConflict: 'player_id,model_version' });
    fail('NBA projection stat cache upsert failed', result.error);
  }
}

export async function loadActiveResolvedNbaPlayerIds() {
  const identities = await db.from('nba_player_provider_identities').select('player_id').eq('provider', 'espn').eq('resolution_status', 'resolved');
  fail('NBA resolved identity lookup failed', identities.error);
  const ids = [...new Set((identities.data ?? []).map(row => Number(row.player_id)).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const players = await db.from('players').select('id').in('id', ids).eq('is_active', true);
  fail('NBA active player lookup failed', players.error);
  return (players.data ?? []).map(row => Number(row.id));
}

export async function loadActiveResolvedNbaProviderPlayerIds() {
  const [identities, activePlayerIds] = await Promise.all([loadNbaProviderIdentities(), loadActiveResolvedNbaPlayerIds()]);
  const active = new Set(activePlayerIds);
  return identities.filter(identity => identity.status === 'resolved' && identity.playerId !== null && active.has(identity.playerId))
    .map(identity => identity.providerPlayerId).sort((left, right) => Number(left) - Number(right));
}
