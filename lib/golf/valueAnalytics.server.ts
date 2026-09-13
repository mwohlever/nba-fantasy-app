import 'server-only';

import { fetchGolfSeasonScoreboardPayload } from '@/lib/providers/golf';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { GOLF_VALUE_CACHE_MAX_AGE_MS, planGolfSeasonIngestion, selectGolfAnalyticsHistories, summarizeGolfAnalyticsRefresh,
  type CachedGolfEventVersion, type CachedGolfObservation, type GolfAnalyticsIdentity } from './valueAnalytics';
import type { GolfValueScoreboard } from './valueEspn';

const db = supabaseAdmin;
const batches = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
function fail(label: string, error: { message: string } | null) { if (error) throw new Error(`${label}: ${error.message}`); }

/** Manual, protected refresh only. No fantasy slate or Group is consulted. */
export async function refreshGolfAnalyticsSeason(season: number) {
  const payload = await fetchGolfSeasonScoreboardPayload(season) as GolfValueScoreboard & { season?: { year?: number } };
  const observedAt = new Date().toISOString();
  const espnIds = [...new Set((payload.events ?? []).flatMap(event => event.competitions?.[0]?.competitors?.map(player => player.id).filter((id): id is string => Boolean(id)) ?? []))];
  const identities: GolfAnalyticsIdentity[] = [];
  for (const group of batches(espnIds, 100)) {
    const result = await db.from('golf_players').select('id,espn_player_id,display_name').in('espn_player_id', group);
    fail('Golf identity lookup failed', result.error);
    identities.push(...(result.data ?? []) as GolfAnalyticsIdentity[]);
  }
  const plan = planGolfSeasonIngestion(payload, season, identities);
  const key = { provider: 'espn_pga', season, source_hash: plan.sourceHash, normalized_hash: plan.normalizedHash,
    normalization_version: plan.normalizationVersion };
  const existing = await db.from('golf_analytics_season_refreshes').select('id,status').match(key).maybeSingle();
  fail('Golf analytics refresh lookup failed', existing.error);
  if (existing.data?.status === 'ready') {
    const checked = await db.from('golf_analytics_season_refreshes').update({ last_checked_at: observedAt }).eq('id', existing.data.id);
    fail('Golf analytics refresh check failed', checked.error);
    return summarizeGolfAnalyticsRefresh(plan, Number(existing.data.id), true);
  }
  if (!existing.data) {
    const inserted = await db.from('golf_analytics_season_refreshes').upsert({ ...key, source_bytes: plan.sourceBytes,
      observed_at: observedAt, last_checked_at: observedAt, status: 'ingesting', event_ids: plan.eventIds,
      diagnostics: plan.diagnostics }, { onConflict: 'provider,season,source_hash,normalized_hash,normalization_version', ignoreDuplicates: true });
    fail('Golf analytics refresh creation failed', inserted.error);
  }
  const refresh = await db.from('golf_analytics_season_refreshes').select('id,status').match(key).single();
  fail('Golf analytics refresh unavailable', refresh.error);
  const versionIds: number[] = [];
  for (const event of plan.events) {
    const eventKey = { provider: 'espn_pga', provider_event_id: event.eventId, source_hash: event.sourceHash,
      normalized_hash: event.normalizedHash, normalization_version: plan.normalizationVersion };
    const inserted = await db.from('golf_analytics_event_versions').upsert({ ...eventKey, season, event_name: event.name,
      starts_at: event.startsAt, ends_at: event.endsAt, observed_at: observedAt,
      eligibility: event.diagnostic.reason, diagnostics: event.diagnostic, raw_event: JSON.stringify(event.rawEvent),
      status: 'ingesting' }, { onConflict: 'provider,provider_event_id,source_hash,normalized_hash,normalization_version', ignoreDuplicates: true });
    fail(`Golf event ${event.eventId} version creation failed`, inserted.error);
    const version = await db.from('golf_analytics_event_versions').select('id,status').match(eventKey).single();
    fail(`Golf event ${event.eventId} version unavailable`, version.error);
    versionIds.push(Number(version.data!.id));
    if (version.data!.status === 'ready') continue;
    for (const group of batches(event.observations, 200)) {
      const saved = await db.from('golf_analytics_observations').upsert(group.map(player => ({
        event_version_id: version.data!.id, provider_player_id: player.providerPlayerId,
        player_id: player.playerId, provider_name: player.name, history: player.history,
        diagnostics: player.playerId === null ? [...player.diagnostics, 'unresolved_player_identity'] : player.diagnostics,
      })), { onConflict: 'event_version_id,provider_player_id', ignoreDuplicates: true });
      fail(`Golf event ${event.eventId} observations failed`, saved.error);
    }
    const ready = await db.from('golf_analytics_event_versions').update({ status: 'ready', ready_at: new Date().toISOString() })
      .eq('id', version.data!.id).eq('status', 'ingesting');
    fail(`Golf event ${event.eventId} readiness failed`, ready.error);
  }
  const finished = await db.from('golf_analytics_season_refreshes').update({ status: 'ready', ready_at: new Date().toISOString(),
    last_checked_at: observedAt, event_version_ids: versionIds, diagnostics: plan.diagnostics })
    .eq('id', refresh.data!.id).eq('status', 'ingesting');
  fail('Golf analytics season readiness failed', finished.error);
  return summarizeGolfAnalyticsRefresh(plan, Number(refresh.data!.id), false);
}

export async function loadGolfAnalyticsHistory(input: {
  playerIds: readonly number[]; espnPlayerIds: readonly string[]; targetEventId: string; targetCutoffAt: string; asOfAt: string; season: number;
}) {
  if (!input.targetEventId || !input.playerIds.length) throw new Error('Golf target event and field required');
  const asOf = Date.parse(input.asOfAt), cutoff = Date.parse(input.targetCutoffAt);
  if (!Number.isFinite(asOf) || !Number.isFinite(cutoff) || asOf >= cutoff || asOf > Date.now()) throw new Error('Golf salary generation must precede target start');
  const refresh = await db.from('golf_analytics_season_refreshes')
    .select('id,source_hash,normalized_hash,observed_at,ready_at,last_checked_at,event_ids,event_version_ids')
    .eq('provider', 'espn_pga').eq('season', input.season).eq('status', 'ready')
    .lte('observed_at', input.asOfAt).lte('ready_at', input.asOfAt).lte('last_checked_at', input.asOfAt)
    .order('last_checked_at', { ascending: false }).limit(1).maybeSingle();
  fail('Golf analytics cache lookup failed', refresh.error);
  if (!refresh.data || asOf - Date.parse(refresh.data.last_checked_at) > GOLF_VALUE_CACHE_MAX_AGE_MS)
    throw new Error('Golf analytics cache is unavailable or stale; refresh the ESPN season before generating salaries');
  if (!Array.isArray(refresh.data.event_ids) || !refresh.data.event_ids.includes(input.targetEventId))
    throw new Error('Target tournament is absent from the verified ESPN season schedule');
  const ids = (refresh.data.event_version_ids as unknown[]).map(Number);
  if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Golf analytics cache has no completed event versions');
  const eventVersions: CachedGolfEventVersion[] = [];
  for (const group of batches(ids, 100)) {
    const result = await db.from('golf_analytics_event_versions').select('id,provider_event_id,season,ends_at,observed_at,ready_at,source_hash,normalized_hash,eligibility,status').in('id', group);
    fail('Golf event versions unavailable', result.error);
    eventVersions.push(...(result.data ?? []) as CachedGolfEventVersion[]);
  }
  if (eventVersions.length !== ids.length || eventVersions.some(event => event.status !== 'ready')) throw new Error('Golf analytics cache contains incomplete evidence');
  const observations: CachedGolfObservation[] = [];
  const eligibleVersionIds = eventVersions.filter(event => event.eligibility === 'accepted' && event.provider_event_id !== input.targetEventId &&
    Date.parse(event.ends_at) < cutoff && Date.parse(event.observed_at) <= asOf && Date.parse(event.ready_at) <= asOf).map(event => event.id);
  const unresolvedIds = new Set<string>();
  for (const versionGroup of batches(eligibleVersionIds, 50)) {
    for (const espnGroup of batches(input.espnPlayerIds, 100)) {
      const unresolved = await db.from('golf_analytics_observations').select('provider_player_id')
        .in('event_version_id', versionGroup).in('provider_player_id', espnGroup).is('player_id', null);
      fail('Golf analytics identity audit unavailable', unresolved.error);
      for (const row of unresolved.data ?? []) unresolvedIds.add(row.provider_player_id);
    }
  }
  if (unresolvedIds.size) throw new Error(`Golf analytics has unresolved target golfer ESPN IDs: ${[...unresolvedIds].join(', ')}`);
  for (const versionGroup of batches(eligibleVersionIds, 50)) {
    for (const playerGroup of batches(input.playerIds, 100)) {
      for (let start = 0; ; start += 1000) {
        const result = await db.from('golf_analytics_observations').select('id,event_version_id,player_id,provider_player_id,history')
          .in('event_version_id', versionGroup).in('player_id', playerGroup).order('id').range(start, start + 999);
        fail('Golf analytics observations unavailable', result.error);
        observations.push(...(result.data ?? []) as CachedGolfObservation[]);
        if ((result.data ?? []).length < 1000) break;
      }
    }
  }
  return { refresh: refresh.data, selection: selectGolfAnalyticsHistories({ ...input, eventVersions, observations }) };
}
