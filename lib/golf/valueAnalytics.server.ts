import 'server-only';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { GOLF_ANALYTICS_PROVIDER, GOLF_VALUE_CACHE_MAX_AGE_MS, bindGolfAnalyticsProviderPlan, buildGolfAnalyticsProviderPlan,
  golfAnalyticsHash, selectGolfAnalyticsHistories, summarizeGolfAnalyticsRefresh,
  type CachedGolfEventVersion, type CachedGolfObservation, type GolfAnalyticsIdentity, type GolfAnalyticsProviderPlan } from './valueAnalytics';
import { GOLF_ESPN_HISTORY_VERSION, type EspnEvent } from './valueEspn';

const db = supabaseAdmin;
const batches = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
function fail(label: string, error: { message: string } | null) { if (error) throw new Error(`${label}: ${error.message}`); }

async function loadGolfAnalyticsIdentities(espnIds: readonly string[]) {
  const identities: GolfAnalyticsIdentity[] = [];
  for (const group of batches(espnIds, 100)) {
    const result = await db.from('golf_players').select('id,espn_player_id,display_name').in('espn_player_id', group);
    fail('Golf identity lookup failed', result.error);
    identities.push(...(result.data ?? []) as GolfAnalyticsIdentity[]);
  }
  return identities;
}

function providerIds(plan: GolfAnalyticsProviderPlan) {
  return [...new Set(plan.events.flatMap(event => event.observations.map(player => player.providerPlayerId)))];
}

function assertProviderPlan(plan: GolfAnalyticsProviderPlan) {
  if (plan?.provider !== GOLF_ANALYTICS_PROVIDER || plan.normalizationVersion !== GOLF_ESPN_HISTORY_VERSION || !Number.isInteger(plan.season) || plan.season < 2000 || plan.season > 2100 ||
      !/^[a-f0-9]{64}$/.test(plan.sourceHash) || !Number.isSafeInteger(plan.sourceBytes) || plan.sourceBytes <= 0 ||
      !Array.isArray(plan.eventIds) || !Array.isArray(plan.diagnostics) || !Array.isArray(plan.events) || !plan.events.length ||
      plan.events.some(event => !event || !event.eventId || !event.name || !event.startsAt || !event.endsAt ||
        !/^[a-f0-9]{64}$/.test(event.sourceHash) || !Array.isArray(event.observations))) {
    throw new Error('Invalid Golf analytics begin payload');
  }
  if (new Set(plan.eventIds).size !== plan.eventIds.length || new Set(plan.events.map(event => event.eventId)).size !== plan.events.length)
    throw new Error('Duplicate Golf analytics provider event ID');
  if (plan.events.some(event => !plan.eventIds.includes(event.eventId) || !plan.diagnostics.some(diagnostic => diagnostic.eventId === event.eventId && diagnostic.completed === true)))
    throw new Error('Golf analytics completed-event manifest mismatch');
}

/** GitHub owns ESPN acquisition; this server-only path owns canonical identity binding and persistence. */
export async function beginGolfAnalyticsIngestion(providerPlan: GolfAnalyticsProviderPlan) {
  assertProviderPlan(providerPlan);
  const identities = await loadGolfAnalyticsIdentities(providerIds(providerPlan));
  const plan = bindGolfAnalyticsProviderPlan(providerPlan, identities);
  const observedAt = new Date().toISOString();
  const key = { provider: GOLF_ANALYTICS_PROVIDER, season: plan.season, source_hash: plan.sourceHash, normalized_hash: plan.normalizedHash,
    normalization_version: plan.normalizationVersion };
  const existing = await db.from('golf_analytics_season_refreshes').select('id,status').match(key).maybeSingle();
  fail('Golf analytics refresh lookup failed', existing.error);
  if (existing.data?.status === 'ready') {
    const checked = await db.from('golf_analytics_season_refreshes').update({ last_checked_at: observedAt }).eq('id', existing.data.id);
    fail('Golf analytics refresh check failed', checked.error);
    return { ...summarizeGolfAnalyticsRefresh(plan, Number(existing.data.id), true), eventManifest: [] };
  }
  if (!existing.data) {
    const inserted = await db.from('golf_analytics_season_refreshes').upsert({ ...key, source_bytes: plan.sourceBytes,
      observed_at: observedAt, last_checked_at: observedAt, status: 'ingesting', event_ids: plan.eventIds,
      diagnostics: plan.diagnostics }, { onConflict: 'provider,season,source_hash,normalized_hash,normalization_version', ignoreDuplicates: true });
    fail('Golf analytics refresh creation failed', inserted.error);
  }
  const refresh = await db.from('golf_analytics_season_refreshes').select('id,status').match(key).single();
  fail('Golf analytics refresh unavailable', refresh.error);
  return { ...summarizeGolfAnalyticsRefresh(plan, Number(refresh.data!.id), false), status: 'ingesting',
    eventManifest: plan.events.map(event => ({ eventId: event.eventId, sourceHash: event.sourceHash, normalizedHash: event.normalizedHash })) };
}

/** One raw ESPN event per request keeps the worker-to-Vercel request well below function body limits. */
export async function ingestGolfAnalyticsEvent(input: { refreshId: number; eventId: string; expectedNormalizedHash: string; rawEvent: unknown }) {
  if (!Number.isSafeInteger(input.refreshId) || input.refreshId <= 0 || !input.eventId || !/^[a-f0-9]{64}$/.test(input.expectedNormalizedHash))
    throw new Error('Invalid Golf analytics event payload');
  const refresh = await db.from('golf_analytics_season_refreshes').select('id,season,normalization_version,status,diagnostics')
    .eq('id', input.refreshId).eq('provider', GOLF_ANALYTICS_PROVIDER).single();
  fail('Golf analytics refresh unavailable', refresh.error);
  if (refresh.data!.status !== 'ingesting') throw new Error('Golf analytics refresh is not accepting event batches');
  const rawEvent = input.rawEvent as EspnEvent;
  const providerPlan = buildGolfAnalyticsProviderPlan({ season: { year: Number(refresh.data!.season) }, events: [rawEvent],
    leagues: [{ calendar: [{ id: rawEvent?.id }] }] }, Number(refresh.data!.season));
  const event = providerPlan.events[0];
  const expectedIds = (refresh.data!.diagnostics as Array<{ eventId?: string; completed?: boolean }> ?? [])
    .filter(diagnostic => diagnostic.completed === true).map(diagnostic => diagnostic.eventId);
  if (event.eventId !== input.eventId || !expectedIds.includes(event.eventId)) throw new Error('Golf analytics event is absent from the refresh manifest');
  const identities = await loadGolfAnalyticsIdentities(providerIds(providerPlan));
  const bound = bindGolfAnalyticsProviderPlan(providerPlan, identities).events[0];
  if (bound.normalizedHash !== input.expectedNormalizedHash) throw new Error('Golf analytics canonical identity mapping changed; restart the refresh');
  const eventKey = { provider: GOLF_ANALYTICS_PROVIDER, provider_event_id: bound.eventId, source_hash: bound.sourceHash,
    normalized_hash: bound.normalizedHash, normalization_version: String(refresh.data!.normalization_version) };
  const inserted = await db.from('golf_analytics_event_versions').upsert({ ...eventKey, season: refresh.data!.season, event_name: bound.name,
    starts_at: bound.startsAt, ends_at: bound.endsAt, observed_at: new Date().toISOString(), eligibility: bound.diagnostic.reason,
    diagnostics: bound.diagnostic, raw_event: JSON.stringify(rawEvent), status: 'ingesting' },
  { onConflict: 'provider,provider_event_id,source_hash,normalized_hash,normalization_version', ignoreDuplicates: true });
  fail(`Golf event ${bound.eventId} version creation failed`, inserted.error);
  const version = await db.from('golf_analytics_event_versions').select('id,status').match(eventKey).single();
  fail(`Golf event ${bound.eventId} version unavailable`, version.error);
  if (version.data!.status !== 'ready') {
    for (const group of batches(bound.observations, 200)) {
      const saved = await db.from('golf_analytics_observations').upsert(group.map(player => ({ event_version_id: version.data!.id,
        provider_player_id: player.providerPlayerId, player_id: player.playerId, provider_name: player.name, history: player.history,
        diagnostics: player.playerId === null ? [...player.diagnostics, 'unresolved_player_identity'] : player.diagnostics,
      })), { onConflict: 'event_version_id,provider_player_id', ignoreDuplicates: true });
      fail(`Golf event ${bound.eventId} observations failed`, saved.error);
    }
    const ready = await db.from('golf_analytics_event_versions').update({ status: 'ready', ready_at: new Date().toISOString() })
      .eq('id', version.data!.id).eq('status', 'ingesting');
    fail(`Golf event ${bound.eventId} readiness failed`, ready.error);
  }
  return { eventId: bound.eventId, sourceHash: bound.sourceHash, normalizedHash: bound.normalizedHash,
    eventVersionId: Number(version.data!.id), alreadyReady: version.data!.status === 'ready' };
}

export async function finalizeGolfAnalyticsIngestion(input: { refreshId: number; eventManifest: Array<{ eventId: string; sourceHash: string; normalizedHash: string }> }) {
  if (!Number.isSafeInteger(input.refreshId) || input.refreshId <= 0 || !Array.isArray(input.eventManifest) || !input.eventManifest.length ||
      input.eventManifest.some(event => !event.eventId || !/^[a-f0-9]{64}$/.test(event.sourceHash) || !/^[a-f0-9]{64}$/.test(event.normalizedHash)) ||
      new Set(input.eventManifest.map(event => event.eventId)).size !== input.eventManifest.length)
    throw new Error('Invalid Golf analytics finalize payload');
  const refresh = await db.from('golf_analytics_season_refreshes').select('id,normalized_hash,normalization_version,status,diagnostics')
    .eq('id', input.refreshId).eq('provider', GOLF_ANALYTICS_PROVIDER).single();
  fail('Golf analytics refresh unavailable', refresh.error);
  if (refresh.data!.status === 'ready') return { refreshId: input.refreshId, status: 'ready', alreadyReady: true };
  const expectedIds = (refresh.data!.diagnostics as Array<{ eventId?: string; completed?: boolean }> ?? [])
    .filter(diagnostic => diagnostic.completed === true && diagnostic.eventId).map(diagnostic => diagnostic.eventId!);
  if (expectedIds.length !== input.eventManifest.length || expectedIds.some(id => !input.eventManifest.some(event => event.eventId === id)))
    throw new Error('Golf analytics finalize manifest is incomplete');
  const normalizedHash = golfAnalyticsHash(input.eventManifest.map(event => [event.eventId, event.sourceHash, event.normalizedHash])
    .sort((left, right) => left[0].localeCompare(right[0])));
  if (normalizedHash !== refresh.data!.normalized_hash) throw new Error('Golf analytics finalize version manifest mismatch');
  const versionIds: number[] = [];
  for (const event of input.eventManifest) {
    const version = await db.from('golf_analytics_event_versions').select('id,status').match({ provider: GOLF_ANALYTICS_PROVIDER,
      provider_event_id: event.eventId, source_hash: event.sourceHash, normalized_hash: event.normalizedHash,
      normalization_version: refresh.data!.normalization_version }).single();
    fail(`Golf event ${event.eventId} is unavailable for finalization`, version.error);
    if (version.data!.status !== 'ready') throw new Error(`Golf event ${event.eventId} is not ready`);
    versionIds.push(Number(version.data!.id));
  }
  const now = new Date().toISOString();
  const finished = await db.from('golf_analytics_season_refreshes').update({ status: 'ready', ready_at: now,
    last_checked_at: now, event_version_ids: versionIds }).eq('id', input.refreshId).eq('status', 'ingesting');
  fail('Golf analytics season readiness failed', finished.error);
  return { refreshId: input.refreshId, status: 'ready', alreadyReady: false, eventVersionCount: versionIds.length };
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
  for (const versionGroup of batches(eligibleVersionIds, 50)) {
    for (const espnGroup of batches(input.espnPlayerIds, 100)) {
      for (let start = 0; ; start += 1000) {
        const result = await db.from('golf_analytics_observations').select('id,event_version_id,player_id,provider_player_id,history')
          .in('event_version_id', versionGroup).in('provider_player_id', espnGroup).order('id').range(start, start + 999);
        fail('Golf analytics observations unavailable', result.error);
        observations.push(...(result.data ?? []) as CachedGolfObservation[]);
        if ((result.data ?? []).length < 1000) break;
      }
    }
  }
  const espnPlayerIdsByPlayerId = new Map(input.playerIds.map((playerId, index) => [playerId, input.espnPlayerIds[index]! ]));
  if (espnPlayerIdsByPlayerId.size !== input.playerIds.length || new Set(input.espnPlayerIds).size !== input.espnPlayerIds.length)
    throw new Error('Ambiguous Golf field ESPN identity mapping');
  return { refresh: refresh.data, selection: selectGolfAnalyticsHistories({ ...input, eventVersions, observations, espnPlayerIdsByPlayerId }) };
}
