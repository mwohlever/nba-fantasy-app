import type { GolfValuePlayer, GolfValueHistory } from './valueModel';

// Historical provider normalization only; never writes accepted fantasy scoring state.
export const GOLF_ESPN_HISTORY_VERSION = 'espn-golf-history-v2-playoffs';
export type EspnRound = { period?: number; value?: number; displayValue?: string; linescores?: { value?: number; period?: number }[] };
export type EspnPlayer = { id?: string; type?: string; order?: number; score?: string; athlete?: { displayName?: string }; status?: { type?: { name?: string } }; linescores?: EspnRound[] };
export type EspnEvent = { id?: string; name?: string; date?: string; endDate?: string; status?: { type?: { completed?: boolean; name?: string } }; competitions?: { status?: { period?: number; type?: { completed?: boolean } }; competitors?: EspnPlayer[] }[] };
export type GolfValueScoreboard = { events?: EspnEvent[] };
export type GolfEspnDiagnosticReason = 'accepted' | 'target_excluded' | 'future_excluded' | 'other_season' | 'canceled_or_incomplete' | 'unsupported_team_format' | 'missing_competitors' | 'unsupported_round_structure' | 'insufficient_valid_round_cards' | 'invalid_event_identity';
export type GolfEspnEventDiagnostic = { eventId: string | null; name: string | null; reason: GolfEspnDiagnosticReason; detail?: string; completed?: boolean };
export type GolfEspnPlayerDiagnostic = { espnPlayerId: string | null; name: string | null; reason: 'unresolved_player_status' | 'malformed_or_incomplete_player_card' };

const toPar = (s?: string) => s === 'E' ? 0 : s && /^[+-]?\d+$/.test(s) ? Number(s) : null;
function completedRounds(player: EspnPlayer) {
  return (player.linescores ?? []).flatMap(round => {
    const holes = round.linescores ?? [];
    const complete = holes.length === 18 && new Set(holes.map(h => h.period)).size === 18 && holes.every(h => Number.isInteger(h.period) && h.period! >= 1 && h.period! <= 18 && Number.isFinite(h.value) && h.value! > 0);
    const par = toPar(round.displayValue);
    return round.period && round.period >= 1 && round.period <= 4 && complete && par !== null && Number.isFinite(round.value) && round.value! > 0 ? [{ round: round.period, toPar: par }] : [];
  });
}

/** Normalizes one real event without requiring a fantasy slate or target field. */
export function normalizeEspnGolfValueEvent(event: EspnEvent): {
  diagnostic: GolfEspnEventDiagnostic;
  players: Array<{ espnPlayerId: string; name: string; history: GolfValueHistory; diagnostics: GolfEspnPlayerDiagnostic[] }>;
} {
  const base = { eventId: event.id ?? null, name: event.name ?? null };
  const reject = (reason: GolfEspnDiagnosticReason, detail?: string) => ({ diagnostic: { ...base, reason, detail }, players: [] });
  if (!event.id || !event.endDate || !Number.isFinite(Date.parse(event.endDate))) return reject('invalid_event_identity', 'Event ID or end date unavailable');
  const comp = event.competitions?.[0];
  if (!(event.status?.type?.completed || comp?.status?.type?.completed)) return reject('canceled_or_incomplete', event.status?.type?.name);
  if (/zurich|barracuda|match play|ryder|presidents/i.test(event.name ?? '') || comp?.competitors?.some(player => player.type !== 'athlete')) return reject('unsupported_team_format');
  if (!comp?.competitors?.length) return reject('missing_competitors');
  if (comp.competitors.some(player => !player.id || !player.athlete?.displayName) ||
      new Set(comp.competitors.map(player => player.id)).size !== comp.competitors.length)
    return reject('invalid_event_identity', 'Missing or duplicate competitor identity');
  const entries = comp.competitors.map(player => ({ player, rounds: completedRounds(player) }));
  const period = comp.status?.period;
  // Period 5 is sudden-death playoff activity. Require real R4 cards, then use
  // only regulation periods 1–4 for both status and round differentials.
  const regulationRounds = period === 5 && entries.some(entry => entry.rounds.some(round => round.round === 4)) ? 4 : period;
  if (!regulationRounds || ![1, 2, 3, 4].includes(regulationRounds)) return reject('unsupported_round_structure', `competition period ${period ?? 'missing'}`);
  const means = new Map<number, number>();
  for (const round of [1, 2, 3, 4]) {
    const scores = entries.flatMap(entry => entry.rounds.filter(value => value.round === round).map(value => value.toPar));
    if (scores.length >= 10) means.set(round, scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }
  if (!means.size) return reject('insufficient_valid_round_cards');
  const players = entries.flatMap(({ player, rounds }) => {
    if (!player.id || !player.athlete?.displayName) return [];
    const diagnostics: GolfEspnPlayerDiagnostic[] = [];
    if ((player.linescores ?? []).some(round => round.period && round.period >= 1 && round.period <= 4 && !rounds.some(valid => valid.round === round.period))) diagnostics.push({ espnPlayerId: player.id, name: player.athlete.displayName, reason: 'malformed_or_incomplete_player_card' });
    const label = (player.status?.type?.name ?? player.score ?? '').toUpperCase();
    const status: GolfValueHistory['status'] = /WITHDRAW|\bWD\b/.test(label) ? 'withdrawn' : /DISQUAL|\bDQ\b/.test(label) ? 'disqualified' : /DID.NOT.START|\bDNS\b/.test(label) ? 'did_not_start' : /MISSED.CUT|\bCUT\b/.test(label) ? 'cut' : rounds.length === regulationRounds ? 'finished' : 'unknown';
    if (status === 'unknown') diagnostics.push({ espnPlayerId: player.id, name: player.athlete.displayName, reason: 'unresolved_player_status' });
    const playedSuddenDeath = period === 5 && (player.linescores ?? []).some(round => round.period === 5);
    const tied = entries.filter(entry => entry.player.score === player.score && entry.rounds.length === rounds.length && Number.isFinite(entry.player.order));
    // ESPN's final order resolves a playoff even when its display score still
    // ties the regulation leaders. Ordinary score ties keep midpoint ordering.
    const order = playedSuddenDeath ? player.order : tied.length ? tied.reduce((sum, entry) => sum + entry.player.order!, 0) / tied.length : player.order;
    const finishPercentile = status === 'finished' && Number.isFinite(order) && order! >= 1 && order! <= entries.length ? 100 * (entries.length - order!) / Math.max(1, entries.length - 1) : null;
    return [{ espnPlayerId: player.id, name: player.athlete.displayName, diagnostics, history: {
      eventId: event.id!, endedAt: event.endDate!, status, finishPercentile,
      roundDifferentials: rounds.filter(round => means.has(round.round)).map(round => means.get(round.round)! - round.toPar),
    } }];
  });
  return { diagnostic: { ...base, reason: 'accepted' }, players };
}

export function golfValueInputsFromEspn(payload: GolfValueScoreboard, targetId: string) {
  const events = payload.events ?? [];
  const target = events.find(event => event.id === targetId);
  if (!target?.date || !Number.isFinite(Date.parse(target.date))) throw new Error('Target tournament date unavailable');
  const field = target.competitions?.[0]?.competitors ?? [];
  if (!field.length || field.some(player => player.type !== 'athlete' || !player.id || !player.athlete?.displayName)) throw new Error('Individual tournament field unavailable');
  const players: GolfValuePlayer[] = field.map(player => ({ playerId: player.id!, name: player.athlete!.displayName!, history: [] }));
  const histories = new Map(players.map(player => [player.playerId, [] as GolfValueHistory[]]));
  const diagnostics: GolfEspnEventDiagnostic[] = [];
  const playerDiagnostics: GolfEspnPlayerDiagnostic[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const base = { eventId: event.id ?? null, name: event.name ?? null };
    if (event.id === targetId) { diagnostics.push({ ...base, reason: 'target_excluded' }); continue; }
    if (!event.id) { diagnostics.push({ ...base, reason: 'invalid_event_identity' }); continue; }
    if (seen.has(event.id)) throw new Error('Duplicate provider event');
    seen.add(event.id);
    if (!event.endDate || !Number.isFinite(Date.parse(event.endDate))) { diagnostics.push({ ...base, reason: 'invalid_event_identity' }); continue; }
    if (Date.parse(event.endDate) >= Date.parse(target.date)) { diagnostics.push({ ...base, reason: 'future_excluded' }); continue; }
    if (new Date(event.endDate).getUTCFullYear() !== new Date(target.date).getUTCFullYear()) { diagnostics.push({ ...base, reason: 'other_season' }); continue; }
    const normalized = normalizeEspnGolfValueEvent(event);
    diagnostics.push(normalized.diagnostic);
    for (const player of normalized.players) {
      if (!histories.has(player.espnPlayerId)) continue;
      histories.get(player.espnPlayerId)!.push(player.history);
      playerDiagnostics.push(...player.diagnostics);
    }
  }
  return { eventId: targetId, eventName: target.name, startsAt: target.date,
    season: new Date(target.date).getUTCFullYear(), players: players.map(player => ({ ...player, history: histories.get(player.playerId)! })),
    usedEvents: diagnostics.filter(diagnostic => diagnostic.reason === 'accepted').map(diagnostic => diagnostic.eventId!),
    skippedEvents: diagnostics.filter(diagnostic => !['accepted', 'target_excluded', 'future_excluded', 'other_season'].includes(diagnostic.reason)).map(diagnostic => diagnostic.eventId!).filter((id): id is string => Boolean(id)),
    diagnostics, playerDiagnostics };
}
