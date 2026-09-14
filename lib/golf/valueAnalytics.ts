import { createHash } from 'node:crypto';
import { GOLF_ESPN_HISTORY_VERSION, normalizeEspnGolfValueEvent, type GolfValueScoreboard, type GolfEspnEventDiagnostic } from './valueEspn';
import { GOLF_VALUE_VERSION, type GolfValueHistory } from './valueModel';

export const GOLF_VALUE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const golfAnalyticsHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type GolfAnalyticsIdentity = { id: number; espn_player_id: string; display_name: string };
export const GOLF_ANALYTICS_PROVIDER = 'espn_pga' as const;
export type GolfAnalyticsProviderEvent = {
  eventId: string; name: string; startsAt: string; endsAt: string; sourceHash: string;
  rawEvent?: unknown; diagnostic: GolfEspnEventDiagnostic;
  observations: Array<{ providerPlayerId: string; name: string; history: GolfValueHistory; diagnostics: string[] }>;
};
export type GolfAnalyticsProviderPlan = {
  provider: typeof GOLF_ANALYTICS_PROVIDER; season: number; sourceHash: string; sourceBytes: number;
  normalizationVersion: string; eventIds: string[]; diagnostics: GolfEspnEventDiagnostic[];
  events: GolfAnalyticsProviderEvent[];
};
export type GolfEventPlan = {
  eventId: string; name: string; startsAt: string; endsAt: string; sourceHash: string; normalizedHash: string;
  rawEvent?: unknown; diagnostic: GolfEspnEventDiagnostic;
  observations: Array<{ providerPlayerId: string; playerId: number | null; name: string; history: GolfValueHistory; diagnostics: string[] }>;
};

/** Shared, canonical-provider normalization. It is safe for the GitHub worker: no database or environment access. */
export function buildGolfAnalyticsProviderPlan(payload: GolfValueScoreboard & { season?: { year?: number }; leagues?: Array<{ calendar?: Array<{ id?: string }> }> }, season: number): GolfAnalyticsProviderPlan {
  if (payload.season?.year !== season || !Array.isArray(payload.events)) throw new Error('ESPN Golf season payload mismatch');
  const calendarIds = payload.leagues?.[0]?.calendar?.map(event => event.id).filter((id): id is string => Boolean(id)) ?? [];
  const responseIds = payload.events.map(event => event.id).filter((id): id is string => Boolean(id));
  if (!calendarIds.length || calendarIds.length !== responseIds.length ||
      calendarIds.some(id => !responseIds.includes(id))) throw new Error('ESPN Golf season calendar/event coverage mismatch');
  const seen = new Set<string>();
  const diagnostics: GolfEspnEventDiagnostic[] = [];
  const events: GolfAnalyticsProviderEvent[] = [];
  for (const event of payload.events) {
    if (!event.id || seen.has(event.id)) throw new Error('Missing or duplicate ESPN Golf event ID');
    seen.add(event.id);
    const normalized = normalizeEspnGolfValueEvent(event);
    const completed = Boolean(event.status?.type?.completed || event.competitions?.[0]?.status?.type?.completed);
    const diagnostic = { ...normalized.diagnostic, completed };
    diagnostics.push(diagnostic);
    // Retain versioned raw evidence for completed events only. Future/canceled
    // schedule entries remain in the lightweight season refresh manifest.
    if (!completed) continue;
    if (!event.date || !event.endDate || !Number.isFinite(Date.parse(event.date)) || !Number.isFinite(Date.parse(event.endDate))) throw new Error(`Completed Golf event ${event.id} lacks dates`);
    const observations = normalized.players.map(player => ({ providerPlayerId: player.espnPlayerId, name: player.name,
      history: player.history, diagnostics: player.diagnostics.map(diagnostic => diagnostic.reason) }));
    const sourceHash = golfAnalyticsHash(event);
    events.push({ eventId: event.id, name: event.name ?? event.id, startsAt: event.date, endsAt: event.endDate,
      sourceHash, rawEvent: event, diagnostic, observations });
  }
  if (!events.length) throw new Error('ESPN Golf season has no completed event evidence');
  return { provider: GOLF_ANALYTICS_PROVIDER, season, sourceHash: golfAnalyticsHash(payload), sourceBytes: Buffer.byteLength(JSON.stringify(payload)),
    normalizationVersion: GOLF_ESPN_HISTORY_VERSION, eventIds: [...seen], diagnostics, events };
}

/** Server-side canonical identity binding. A changed resolution deliberately changes the normalized version. */
export function bindGolfAnalyticsProviderPlan(providerPlan: GolfAnalyticsProviderPlan, identities: readonly GolfAnalyticsIdentity[]) {
  if (providerPlan.provider !== GOLF_ANALYTICS_PROVIDER || !Number.isInteger(providerPlan.season) || !providerPlan.events.length) {
    throw new Error('Invalid Golf analytics provider plan');
  }
  if (new Set(identities.map(player => player.espn_player_id)).size !== identities.length ||
      new Set(identities.map(player => player.id)).size !== identities.length)
    throw new Error('Ambiguous canonical ESPN Golf identity mapping');
  const byEspnId = new Map(identities.map(player => [player.espn_player_id, player.id]));
  const unresolved = new Map<string, string>();
  const events: GolfEventPlan[] = providerPlan.events.map(event => {
    const observations = event.observations.map(player => {
      const playerId = byEspnId.get(player.providerPlayerId) ?? null;
      if (playerId === null) unresolved.set(player.providerPlayerId, player.name);
      return { ...player, playerId };
    });
    return { ...event, observations, normalizedHash: golfAnalyticsHash({ version: providerPlan.normalizationVersion,
      diagnostic: event.diagnostic, observations }) };
  });
  const normalizedHash = golfAnalyticsHash(events.map(event => [event.eventId, event.sourceHash, event.normalizedHash])
    .sort((left, right) => left[0].localeCompare(right[0])));
  return { ...providerPlan, normalizedHash, events,
    unresolved: [...unresolved].map(([espnPlayerId, name]) => ({ espnPlayerId, name })) };
}

/** Deterministic convenience wrapper for local/server paths that already own the full provider payload. */
export function planGolfSeasonIngestion(payload: GolfValueScoreboard & { season?: { year?: number }; leagues?: Array<{ calendar?: Array<{ id?: string }> }> }, season: number, identities: readonly GolfAnalyticsIdentity[]) {
  return bindGolfAnalyticsProviderPlan(buildGolfAnalyticsProviderPlan(payload, season), identities);
}

/** Bounded begin payload. Raw event snapshots are sent one event at a time afterwards. */
export function golfAnalyticsBeginPayload(plan: GolfAnalyticsProviderPlan) {
  return { provider: plan.provider, season: plan.season, sourceHash: plan.sourceHash, sourceBytes: plan.sourceBytes,
    normalizationVersion: plan.normalizationVersion, eventIds: plan.eventIds, diagnostics: plan.diagnostics,
    events: plan.events.map(event => ({ eventId: event.eventId, name: event.name, startsAt: event.startsAt, endsAt: event.endsAt,
      sourceHash: event.sourceHash, diagnostic: event.diagnostic, observations: event.observations })) };
}

/** Small operator response; the raw provider payload and player cards stay server-side. */
export function summarizeGolfAnalyticsRefresh(plan: ReturnType<typeof planGolfSeasonIngestion>, refreshId: number, alreadyReady: boolean) {
  const diagnosticCounts: Record<string, number> = {};
  for (const diagnostic of plan.diagnostics) diagnosticCounts[diagnostic.reason] = (diagnosticCounts[diagnostic.reason] ?? 0) + 1;
  const acceptedEventCount = plan.events.filter(event => event.diagnostic.reason === 'accepted').length;
  return { provider: 'espn_pga', season: plan.season, refreshId, status: 'ready', alreadyReady,
    sourceHash: plan.sourceHash, normalizedHash: plan.normalizedHash, normalizationVersion: plan.normalizationVersion,
    eventCount: plan.eventIds.length, completedEventCount: plan.events.length, acceptedEventCount,
    skippedCompletedEventCount: plan.events.length - acceptedEventCount,
    observationCount: plan.events.reduce((count, event) => count + event.observations.length, 0),
    unresolvedIdentityCount: plan.unresolved.length, diagnosticCounts };
}

export type CachedGolfEventVersion = { id: number; provider_event_id: string; season: number; ends_at: string; observed_at: string; ready_at: string; source_hash: string; normalized_hash: string; eligibility: string; status: string };
export type CachedGolfObservation = { id: number; event_version_id: number; player_id: number | null; provider_player_id: string; history: GolfValueHistory };
export type GolfHistorySelection = { histories: Map<string, GolfValueHistory[]>; observations: Array<{ id: number; eventVersionId: number; playerId: number; providerEventId: string; providerPlayerId: string; storedPlayerId: number | null; attribution: 'stored_canonical' | 'read_time_provider_reconciliation' }>;
  conflicts: Array<{ playerId: number; providerPlayerId: string; storedPlayerId: number }>;
  eventVersions: Array<{ id: number; providerEventId: string; sourceHash: string; normalizedHash: string }> };

export function selectGolfAnalyticsHistories(input: {
  playerIds: readonly number[]; targetEventId: string; season: number; targetCutoffAt: string; asOfAt: string;
  eventVersions: readonly CachedGolfEventVersion[]; observations: readonly CachedGolfObservation[];
  espnPlayerIdsByPlayerId?: ReadonlyMap<number, string>;
}): GolfHistorySelection {
  const cutoff = Date.parse(input.targetCutoffAt), asOf = Date.parse(input.asOfAt);
  if (!Number.isFinite(cutoff) || !Number.isFinite(asOf) || asOf >= cutoff) throw new Error('Valid pre-tournament Golf value cutoff required');
  const wanted = new Set(input.playerIds);
  const playerIdByEspnId = new Map<number | string, number>();
  for (const [playerId, espnPlayerId] of input.espnPlayerIdsByPlayerId ?? []) playerIdByEspnId.set(espnPlayerId, playerId);
  const histories = new Map(input.playerIds.map(id => [String(id), [] as GolfValueHistory[]]));
  const priorVersions = input.eventVersions.filter(event => event.status === 'ready' &&
    event.provider_event_id !== input.targetEventId && event.season === input.season &&
    Date.parse(event.ends_at) < cutoff && Date.parse(event.observed_at) <= asOf && Date.parse(event.ready_at) <= asOf &&
    new Date(event.ends_at).getUTCFullYear() === input.season);
  const malformed = priorVersions.find(event => !['accepted', 'unsupported_team_format'].includes(event.eligibility));
  if (malformed) throw new Error(`Incomplete Golf analytics event ${malformed.provider_event_id}: ${malformed.eligibility}`);
  const eventVersions = priorVersions.filter(event => event.eligibility === 'accepted');
  if (new Set(eventVersions.map(event => event.provider_event_id)).size !== eventVersions.length) throw new Error('Ambiguous Golf event version selection');
  const byVersion = new Map(eventVersions.map(event => [event.id, event]));
  const selected: GolfHistorySelection['observations'] = [];
  const conflicts: GolfHistorySelection['conflicts'] = [];
  for (const observation of input.observations) {
    const event = byVersion.get(observation.event_version_id);
    if (!event) continue;
    const providerMappedPlayerId = playerIdByEspnId.get(observation.provider_player_id);
    if (providerMappedPlayerId !== undefined && observation.player_id !== null && observation.player_id !== providerMappedPlayerId) {
      conflicts.push({ playerId: providerMappedPlayerId, providerPlayerId: observation.provider_player_id, storedPlayerId: observation.player_id });
      continue;
    }
    const resolvedPlayerId = providerMappedPlayerId ?? observation.player_id;
    if (resolvedPlayerId === undefined || resolvedPlayerId === null || !wanted.has(resolvedPlayerId)) continue;
    const expectedProviderId = input.espnPlayerIdsByPlayerId?.get(resolvedPlayerId);
    if (expectedProviderId && expectedProviderId !== observation.provider_player_id) continue;
    if (observation.history.eventId !== event.provider_event_id || Date.parse(observation.history.endedAt) !== Date.parse(event.ends_at)) throw new Error('Golf analytics observation provenance mismatch');
    histories.get(String(resolvedPlayerId))!.push(observation.history);
    selected.push({ id: observation.id, eventVersionId: event.id, playerId: resolvedPlayerId, providerEventId: event.provider_event_id,
      providerPlayerId: observation.provider_player_id, storedPlayerId: observation.player_id,
      attribution: observation.player_id === null ? 'read_time_provider_reconciliation' : 'stored_canonical' });
  }
  selected.sort((a, b) => a.playerId - b.playerId || a.providerEventId.localeCompare(b.providerEventId));
  return { histories, observations: selected, conflicts: [...new Map(conflicts.map(conflict => [`${conflict.playerId}:${conflict.providerPlayerId}:${conflict.storedPlayerId}`, conflict])).values()], eventVersions: eventVersions.map(event => ({ id: event.id, providerEventId: event.provider_event_id,
    sourceHash: event.source_hash, normalizedHash: event.normalized_hash })).sort((a, b) => a.providerEventId.localeCompare(b.providerEventId)) };
}

export type GolfBoardFieldInput = { playerId: number; espnPlayerId: string; identityStatus: 'espn_resolved' | 'pga_unresolved'; name: string; isAmateur: boolean; owgrRank: number | null; owgrUpdatedAt: string | null };
export function preserveGolfOwgrInput(field: GolfBoardFieldInput, asOfAt: string, targetCutoffAt: string) {
  const observed = field.owgrUpdatedAt ? Date.parse(field.owgrUpdatedAt) : NaN;
  const eligible = Number.isInteger(field.owgrRank) && field.owgrRank! > 0 && Number.isFinite(observed) &&
    observed <= Date.parse(asOfAt) && observed < Date.parse(targetCutoffAt);
  return { ...field, owgrRank: eligible ? field.owgrRank : null,
    owgrReason: eligible ? 'observed_before_cutoff' : field.owgrRank === null ? 'rank_unavailable' : 'rank_time_unverified_or_after_cutoff' };
}

export function buildGolfBoardInputManifest(input: { targetEventId: string; targetCutoffAt: string; asOfAt: string;
  refresh: { id: number; source_hash: string; normalized_hash: string; observed_at: string; last_checked_at: string };
  field: readonly GolfBoardFieldInput[]; selection: GolfHistorySelection }) {
  const attributionByPlayerId = new Map<number, Set<'stored_canonical' | 'read_time_provider_reconciliation'>>();
  for (const observation of input.selection.observations) {
    const modes = attributionByPlayerId.get(observation.playerId) ?? new Set();
    modes.add(observation.attribution);
    attributionByPlayerId.set(observation.playerId, modes);
  }
  const manifest = { provider: 'espn_pga', modelVersion: GOLF_VALUE_VERSION, normalizationVersion: GOLF_ESPN_HISTORY_VERSION,
    targetEventId: input.targetEventId, targetCutoffAt: input.targetCutoffAt, asOfAt: input.asOfAt,
    refresh: { id: input.refresh.id, sourceHash: input.refresh.source_hash, normalizedHash: input.refresh.normalized_hash,
      observedAt: input.refresh.observed_at, lastCheckedAt: input.refresh.last_checked_at },
    field: input.field.map(player => ({ ...preserveGolfOwgrInput(player, input.asOfAt, input.targetCutoffAt),
      analyticsAttribution: [...(attributionByPlayerId.get(player.playerId) ?? new Set())].sort() })).sort((a, b) => a.playerId - b.playerId),
    eventVersions: input.selection.eventVersions, observations: input.selection.observations,
    identityConflicts: input.selection.conflicts };
  return { ...manifest, inputHash: golfAnalyticsHash(manifest) };
}
