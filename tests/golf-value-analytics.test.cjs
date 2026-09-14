/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, main, options) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, main, options);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { golfValueInputsFromEspn, normalizeEspnGolfValueEvent } = require('../lib/golf/valueEspn.ts');
const { buildGolfValues } = require('../lib/golf/valueModel.ts');
const { planGolfSeasonIngestion, selectGolfAnalyticsHistories, buildGolfBoardInputManifest, preserveGolfOwgrInput,
  summarizeGolfAnalyticsRefresh, buildGolfAnalyticsProviderPlan, bindGolfAnalyticsProviderPlan, golfAnalyticsBeginPayload } = require('../lib/golf/valueAnalytics.ts');
const { fetchGolfSeasonScoreboardPayload } = require('../lib/providers/golf.ts');

const round = period => ({ period, value: 72, displayValue: 'E', linescores: Array.from({ length: 18 }, (_, i) => ({ period: i + 1, value: 4 })) });
const entrant = (i, rounds = 4) => ({ id: String(i), type: 'athlete', order: i, score: i === 1 ? '-2' : 'E',
  athlete: { displayName: `Player ${i}` }, linescores: Array.from({ length: rounds }, (_, n) => round(n + 1)) });
const prior = (id = 'prior', period = 4) => ({ id, name: 'Stroke play', date: '2026-05-01T04:00Z', endDate: '2026-05-04T04:00Z',
  status: { type: { completed: true, name: 'STATUS_FINAL' } }, competitions: [{ status: { period },
    competitors: Array.from({ length: 12 }, (_, i) => entrant(i + 1)) }] });
const target = () => ({ id: 'target', name: 'Target', date: '2026-09-17T04:00Z', endDate: '2026-09-20T04:00Z',
  competitions: [{ competitors: [entrant(1), entrant(2)] }] });
const payload = events => ({ season: { year: 2026 }, events: [...events, target()],
  leagues: [{ calendar: [...events, target()].map(event => ({ id: event.id })) }] });

test('analytics season transport fetches ESPN directly and consumes JSON inside Node, even on Vercel', async () => {
  const source = payload([prior()]);
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    let requests = 0;
    const result = await fetchGolfSeasonScoreboardPayload(2026, async (url, options) => {
      requests++;
      assert.equal(String(url), 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers['User-Agent'], '111-sports-golf-provider/1.0');
      assert.ok(options.signal);
      return new Response(JSON.stringify(source), { status: 200 });
    });
    assert.equal(requests, 1);
    assert.deepEqual(result, source);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test('legacy direct provider helper remains local-only and reports provider failures', async () => {
  await assert.rejects(fetchGolfSeasonScoreboardPayload(2026, async () => new Response('Denied', { status: 403 })), /direct fetch returned HTTP 403/);
  await assert.rejects(fetchGolfSeasonScoreboardPayload(2026, async () => { throw new Error('network unavailable'); }), /direct fetch failed: network unavailable/);
});

test('GitHub begin payload shares provider normalization but excludes all raw ESPN events', () => {
  const providerPlan = buildGolfAnalyticsProviderPlan(payload([prior()]), 2026);
  const begin = golfAnalyticsBeginPayload(providerPlan);
  assert.equal(begin.provider, 'espn_pga');
  assert.equal(begin.events.length, 1);
  assert.ok(!('rawEvent' in begin.events[0]));
  assert.ok(Buffer.byteLength(JSON.stringify(begin)) < Buffer.byteLength(JSON.stringify(providerPlan.events[0].rawEvent)));
  const bound = bindGolfAnalyticsProviderPlan(providerPlan, [{ id: 1001, espn_player_id: '1', display_name: 'Player 1' }]);
  assert.equal(bound.events[0].observations[0].playerId, 1001);
  assert.equal(bound.events[0].observations[1].playerId, null);
  assert.ok(bound.unresolved.some(player => player.espnPlayerId === '2'));
});

test('analytics summaries and protected ingest boundary remain compact and never fetch ESPN from Vercel', () => {
  const plan = planGolfSeasonIngestion(payload([prior()]), 2026, [{ id: 1001, espn_player_id: '1', display_name: 'Player 1' }]);
  const summary = summarizeGolfAnalyticsRefresh(plan, 42, false);
  assert.equal(summary.status, 'ready');
  assert.equal(summary.eventCount, 2);
  assert.equal(summary.acceptedEventCount, 1);
  assert.equal(summary.observationCount, 12);
  assert.equal(summary.unresolvedIdentityCount, 11);
  assert.equal(summary.sourceHash, plan.sourceHash);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 1500);
  assert.ok(!('events' in summary) && !('rawEvent' in summary) && !('diagnostics' in summary));
  const retired = fs.readFileSync(path.join(root, 'app/api/admin/golf/analytics-refresh/route.ts'), 'utf8');
  assert.match(retired, /status: 410/);
  assert.doesNotMatch(retired, /fetchGolfSeasonScoreboardPayload|refreshGolfAnalyticsSeason/);
  const ingestRoute = fs.readFileSync(path.join(root, 'app/api/internal/golf/analytics-ingest/route.ts'), 'utf8');
  assert.match(ingestRoute, /GOLF_ANALYTICS_INGEST_SECRET/);
  assert.match(ingestRoute, /MAX_REQUEST_BYTES = 2_000_000/);
  assert.match(ingestRoute, /timingSafeEqual/);
  assert.doesNotMatch(ingestRoute, /fetchGolfSeasonScoreboardPayload/);
});

test('ordinary four-round and sudden-death period-5 events retain regulation history only', () => {
  const ordinary = prior();
  const playoff = prior('playoff', 5);
  playoff.competitions[0].competitors[0].linescores.push({ period: 5, value: 3, displayValue: '-1', linescores: [{ period: 1, value: 3 }] });
  playoff.competitions[0].competitors[1].linescores.push({ period: 5, value: 4, displayValue: 'E', linescores: [{ period: 1, value: 4 }] });
  playoff.competitions[0].competitors[1].score = playoff.competitions[0].competitors[0].score;
  const result = golfValueInputsFromEspn(payload([ordinary, playoff]), 'target');
  assert.deepEqual(result.usedEvents, ['prior', 'playoff']);
  for (const player of result.players) {
    assert.equal(player.history.length, 2);
    assert.equal(player.history[0].roundDifferentials.length, 4);
    assert.equal(player.history[1].roundDifferentials.length, 4);
    assert.equal(player.history[1].status, 'finished');
  }
  assert.deepEqual(result.players[0].history[1].roundDifferentials, result.players[0].history[0].roundDifferentials);
  assert.ok(result.players[0].history[1].finishPercentile > result.players[1].history[1].finishPercentile);
});

test('team, canceled, future, target and previous-season events stay out with explicit diagnostics', () => {
  const team = { ...prior('team'), name: 'Zurich Classic' };
  const canceled = { ...prior('canceled'), status: { type: { completed: false, name: 'STATUS_CANCELED' } } };
  const future = { ...prior('future'), date: '2026-10-01T04:00Z', endDate: '2026-10-04T04:00Z' };
  const old = { ...prior('old'), date: '2025-05-01T04:00Z', endDate: '2025-05-04T04:00Z' };
  const result = golfValueInputsFromEspn(payload([prior(), team, canceled, future, old]), 'target');
  assert.deepEqual(result.usedEvents, ['prior']);
  assert.deepEqual(Object.fromEntries(result.diagnostics.map(d => [d.eventId, d.reason])), {
    prior: 'accepted', team: 'unsupported_team_format', canceled: 'canceled_or_incomplete',
    future: 'future_excluded', old: 'other_season', target: 'target_excluded',
  });
});

test('partial two-round result retains real round evidence and unresolved-status diagnostic', () => {
  const event = prior();
  event.competitions[0].competitors[0].linescores = [round(1), round(2)];
  const normalized = normalizeEspnGolfValueEvent(event);
  assert.equal(normalized.players[0].history.status, 'unknown');
  assert.equal(normalized.players[0].history.roundDifferentials.length, 2);
  assert.ok(normalized.players[0].diagnostics.some(d => d.reason === 'unresolved_player_status'));
  const value = buildGolfValues({ eventId: 'target', startsAt: target().date, season: 2026,
    players: [{ playerId: '1', name: 'Player 1', history: [normalized.players[0].history] }] }).players[0];
  assert.equal(value.appearances, 1);
  assert.equal(value.rounds, 2);
  assert.equal(value.confidence, 'low');
});

test('same provider version is idempotent; a correction or identity resolution changes the version', () => {
  const source = payload([prior()]);
  const identity = [{ id: 1001, espn_player_id: '1', display_name: 'Player 1' }];
  const first = planGolfSeasonIngestion(source, 2026, identity);
  assert.deepEqual(planGolfSeasonIngestion(source, 2026, identity), first);
  assert.equal(first.events[0].observations[0].playerId, 1001);
  assert.equal(first.events[0].observations[1].playerId, null);
  assert.ok(first.unresolved.some(row => row.espnPlayerId === '2'));
  assert.throws(() => planGolfSeasonIngestion(source, 2026,
    [...identity, { id: 1002, espn_player_id: '1', display_name: 'Conflicting Player' }]), /Ambiguous canonical/);
  const resolved = planGolfSeasonIngestion(source, 2026, [...identity, { id: 1002, espn_player_id: '2', display_name: 'Player 2' }]);
  assert.equal(resolved.sourceHash, first.sourceHash);
  assert.notEqual(resolved.normalizedHash, first.normalizedHash);
  const corrected = structuredClone(source);
  corrected.events[0].competitions[0].competitors[0].linescores[0].displayValue = '-1';
  const next = planGolfSeasonIngestion(corrected, 2026, identity);
  assert.notEqual(next.sourceHash, first.sourceHash);
  assert.notEqual(next.events[0].sourceHash, first.events[0].sourceHash);
  assert.equal(first.events[0].observations[0].history.roundDifferentials.length, 4);
});

test('cache selection uses canonical golfer ID, refresh-pinned versions, target/season/cutoff/as-of filters', () => {
  const history = { eventId: 'prior', endedAt: '2026-05-04T04:00Z', status: 'finished', finishPercentile: 80, roundDifferentials: [1, 2] };
  const version = (id, eventId, end, observed, season = 2026) => ({ id, provider_event_id: eventId, season, ends_at: end,
    observed_at: observed, ready_at: observed, source_hash: String(id), normalized_hash: String(id), eligibility: 'accepted', status: 'ready' });
  const events = [version(1, 'prior', history.endedAt, '2026-05-05T00:00Z'),
    version(2, 'target', '2026-09-20T04:00Z', '2026-09-20T05:00Z'),
    version(3, 'later', '2026-10-04T04:00Z', '2026-10-05T00:00Z'),
    version(4, 'late-correction', '2026-06-04T04:00Z', '2026-09-18T00:00Z'),
    version(5, 'old-season', '2025-05-04T04:00Z', '2025-05-05T00:00Z', 2025)];
  const observations = [{ id: 11, event_version_id: 1, player_id: 1001, provider_player_id: '1', history },
    { id: 12, event_version_id: 1, player_id: null, provider_player_id: '2', history },
    ...events.slice(1).map((event, i) => ({ id: i + 13, event_version_id: event.id, player_id: 1001,
      provider_player_id: '1', history: { ...history, eventId: event.provider_event_id, endedAt: event.ends_at } }))];
  const args = { playerIds: [1001, 1002], targetEventId: 'target', season: 2026,
    targetCutoffAt: '2026-09-17T04:00Z', asOfAt: '2026-09-13T00:00Z', eventVersions: events, observations };
  const selected = selectGolfAnalyticsHistories(args);
  assert.deepEqual(selected.histories.get('1001'), [history]);
  assert.deepEqual(selected.histories.get('1002'), []);
  assert.deepEqual(selected.observations.map(row => row.id), [11]);
  const correctedVersion = version(6, 'prior', history.endedAt, '2026-09-12T00:00Z');
  const correctedHistory = { ...history, finishPercentile: 90 };
  const correctedSelection = selectGolfAnalyticsHistories({ ...args, eventVersions: [correctedVersion], observations: [
    { id: 20, event_version_id: 6, player_id: 1001, provider_player_id: '1', history: correctedHistory }] });
  assert.deepEqual(correctedSelection.histories.get('1001'), [correctedHistory]);
  assert.deepEqual(selected.histories.get('1001'), [history]);
  const teamVersion = { ...version(7, 'team', '2026-06-04T04:00Z', '2026-06-05T00:00Z'), eligibility: 'unsupported_team_format' };
  assert.deepEqual(selectGolfAnalyticsHistories({ ...args, eventVersions: [...events, teamVersion] }).observations.map(row => row.id), [11]);
  const badVersion = { ...teamVersion, id: 8, provider_event_id: 'bad-card', eligibility: 'insufficient_valid_round_cards' };
  assert.throws(() => selectGolfAnalyticsHistories({ ...args, eventVersions: [...events, badVersion] }), /Incomplete Golf analytics event/);
});

test('board manifest pins observation versions and exact eligible OWGR inputs', () => {
  const field = [{ playerId: 1001, espnPlayerId: '1', identityStatus: 'espn_resolved', name: 'Player 1', isAmateur: false,
    owgrRank: 10, owgrUpdatedAt: '2026-09-12T00:00Z' },
    { playerId: 1002, espnPlayerId: 'pga:2', identityStatus: 'pga_unresolved', name: 'Player 2', isAmateur: false,
      owgrRank: 20, owgrUpdatedAt: '2026-09-18T00:00Z' }];
  const asOfAt = '2026-09-13T00:00Z', targetCutoffAt = '2026-09-17T04:00Z';
  assert.equal(preserveGolfOwgrInput(field[1], asOfAt, targetCutoffAt).owgrRank, null);
  const selection = { histories: new Map(), observations: [{ id: 11, eventVersionId: 1, playerId: 1001, providerEventId: 'prior', providerPlayerId: '1', storedPlayerId: 1001, attribution: 'stored_canonical' }], conflicts: [],
    eventVersions: [{ id: 1, providerEventId: 'prior', sourceHash: 'a', normalizedHash: 'b' }] };
  const args = { targetEventId: 'target', targetCutoffAt, asOfAt,
    refresh: { id: 5, source_hash: 's', normalized_hash: 'n', observed_at: '2026-09-12T00:00Z', last_checked_at: asOfAt },
    field, selection };
  const manifest = buildGolfBoardInputManifest(args);
  assert.equal(manifest.field[0].owgrRank, 10);
  assert.deepEqual(manifest.field[0].analyticsAttribution, ['stored_canonical']);
  assert.equal(manifest.field[1].owgrRank, null);
  assert.deepEqual(manifest.observations, selection.observations);
  assert.equal(buildGolfBoardInputManifest(args).inputHash, manifest.inputHash);
  assert.notEqual(buildGolfBoardInputManifest({ ...args, selection: { ...selection, observations: [] } }).inputHash, manifest.inputHash);
  assert.notEqual(buildGolfBoardInputManifest({ ...args, field: [{ ...field[0], identityStatus: 'pga_unresolved' }, field[1]] }).inputHash, manifest.inputHash);
});

test('read-time provider attribution is pinned and conflicting canonical evidence is not reused', () => {
  const history = { eventId: 'prior', endedAt: '2026-05-04T04:00Z', status: 'finished', finishPercentile: 80, roundDifferentials: [1, 2] };
  const version = { id: 1, provider_event_id: 'prior', season: 2026, ends_at: history.endedAt, observed_at: '2026-05-05T00:00Z', ready_at: '2026-05-05T00:00Z', source_hash: 'a', normalized_hash: 'b', eligibility: 'accepted', status: 'ready' };
  const args = { playerIds: [7], targetEventId: 'target', season: 2026, targetCutoffAt: '2026-09-17T04:00Z', asOfAt: '2026-09-13T00:00Z', eventVersions: [version], espnPlayerIdsByPlayerId: new Map([[7, '101']]) };
  const readTime = selectGolfAnalyticsHistories({ ...args, observations: [{ id: 1, event_version_id: 1, player_id: null, provider_player_id: '101', history }] });
  assert.equal(readTime.observations[0].attribution, 'read_time_provider_reconciliation');
  assert.equal(readTime.observations[0].providerPlayerId, '101');
  const conflict = selectGolfAnalyticsHistories({ ...args, observations: [{ id: 2, event_version_id: 1, player_id: 99, provider_player_id: '101', history }] });
  assert.deepEqual(conflict.histories.get('7'), []);
  assert.deepEqual(conflict.conflicts, [{ playerId: 7, providerPlayerId: '101', storedPlayerId: 99 }]);
});
