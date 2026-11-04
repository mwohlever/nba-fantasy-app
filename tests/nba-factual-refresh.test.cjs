/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), test = require('node:test');
const { player, input, gp, pointsChange, build, uuid } = require('./helpers/nba-refresh-fixtures.cjs');
const { applyNbaRefreshStatus } = require('../lib/player-center/nbaRefresh.ts');
const { decodeSeasonCache } = require('../lib/player-center/durableCache.ts');
const { compareHistories } = require('../lib/player-center/comparison.ts');
const { auditNbaAcquisitionIdentities } = require('../lib/player-center/nbaIdentity.ts');
const { runNbaRefresh, providerReader } = require('../scripts/run-nba-player-center-refresh.cjs');
const empty = { filters: [{ name: 'league', value: 'nba' }] };

test('ordinary polls preserve factual history contract while refreshing independent checks', () => {
  const a = build(input()), b = build(input(2));
  assert.equal(a.outcome, 'verified_data'); assert.equal(a.observations.length, 2);
  assert.equal(a.cache.content_hash, b.cache.content_hash);
  assert.notEqual(a.cache.checked_at, b.cache.checked_at);
  assert.notEqual(a.observations[0].observation_hash, b.observations[0].observation_hash);
  assert.equal(a.observations[0].provider_known_at, a.observations[0].provider_fetched_at);
  assert.equal(build(pointsChange(input(3))).cache.complete, true);
});
test('all 45 real reduced ESPN failure cases stay unverified, never zero', () => {
  const cases = require('./fixtures/player-center/nba-no-data-cases.json').cases;
  assert.equal(cases.length, 45);
  for (const c of cases) {
    const value = input(); value.season = c.season; value.player.providerPlayerId = c.providerPlayerId;
    value.log.payload = c.log; value.summary.payload = c.summary;
    const result = build(value);
    assert.equal(result.outcome, 'acquisition_failed', `${c.providerPlayerId}/${c.season}`);
    assert.ok(result.issues.includes('unverified_no_data')); assert.equal(result.cache, null); assert.equal(result.observations.length, 0);
  }
});
test('explicit independent exact-season GP=0 resolves a genuinely empty log only', () => {
  const value = gp(input(), 0); value.log.payload = empty;
  const zero = build(value); assert.equal(zero.outcome, 'verified_zero_appearances'); assert.equal(zero.cache.complete, true);
  assert.equal(zero.cache.expected_games, 0); assert.equal(zero.observations.length, 0);
  const unknown = input(); unknown.log.payload = empty; unknown.summary.payload.categories = [];
  assert.equal(build(unknown).outcome, 'acquisition_failed');
  const wrong = gp(input(), 0); wrong.log.payload = { filters: [{ name: 'league', value: 'mens-college-basketball' }] };
  assert.equal(build(wrong).outcome, 'acquisition_failed');
});
test('coverage mismatch, missing metrics, conflicting GP, wrong season/athlete and HTTP failures are explicit', () => {
  assert.equal(build(gp(input(), 3)).outcome, 'coverage_incomplete');
  const noGp = input(); noGp.summary.payload.categories = []; assert.equal(build(noGp).cache.expected_games, null);
  const conflict = input(); const category = structuredClone(conflict.summary.payload.categories.find(c => c.labels.includes('GP')));
  const index = category.labels.indexOf('GP'); for (const row of category.statistics) if (row.season.year === 2027) row.stats[index] = '99';
  conflict.summary.payload.categories.push(category); assert.ok(build(conflict).issues.includes('conflicting_season_gp'));
  const wrong = input(); wrong.log.payload.filters.find(f => f.name === 'season').value = '2026'; assert.equal(build(wrong).outcome, 'acquisition_failed');
  const athlete = input(); athlete.summary.payload.athlete = { id: '999' }; assert.equal(build(athlete).outcome, 'acquisition_failed');
  const failed = input(); failed.summary = { fetchedAt: failed.attemptedAt, error: 'provider_http_503' };
  const result = build(failed); assert.equal(result.outcome, 'acquisition_failed'); assert.equal(result.cache, null); assert.equal(result.observations.length, 2, 'validated facts remain available to the atomic failure publication');
});
test('failed or missing latest status gates a retained cache; checked times and identity must agree', () => {
  const result = build(input()), now = Date.parse(result.attempted_at) + 100;
  const history = () => decodeSeasonCache(result.cache, player, 2027, now);
  const status = { outcome: result.outcome, run_id: result.cache.rollout_batch_id, as_of: result.cache.as_of,
    provider_player_id: player.providerPlayerId, native_player_id: 2544, last_verified_at: result.cache.checked_at };
  assert.notEqual(applyNbaRefreshStatus(history(), status).coverage.comparisonEligible, false);
  assert.equal(applyNbaRefreshStatus(history(), undefined).coverage.comparisonEligible, false);
  assert.equal(applyNbaRefreshStatus(history(), { ...status, outcome: 'acquisition_failed' }).coverage.freshness, 'stale');
  const parameters = { sport: 'nba', season: 2027, metric: 'points', window: 'last1', ascending: false, scoring: { sport: 'nba', basis: 'legacy_defaults', settings: null } };
  assert.equal(compareHistories(parameters, [applyNbaRefreshStatus(history(), status)], result.cache.as_of, result.cache.checked_at).coverage.canSort, true);
  assert.equal(compareHistories(parameters, [applyNbaRefreshStatus(history(), { ...status, outcome: 'coverage_incomplete' })], result.cache.as_of, null).coverage.canSort, false);
});
test('identity review exposes native/provider claim conflicts without changing eligibility or creating mappings', () => {
  const source = { players: [{ id: 6, name: player.name, nba_player_id: 2544, is_active: true, team_abbreviation: 'LAL' }],
    native: [{ nbaPlayerId: 2544, name: player.name, rostered: true, team: 'LAL' }],
    espn: [{ espnPlayerId: '1966', name: player.name, team: 'LAL', source: 'https://espn.test/roster' }],
    stored: [{ player_id: 6, provider_player_id: '1966', resolution_status: 'resolved' }], nativeSource: 'https://nba.test' };
  const before = JSON.stringify(source); assert.equal(auditNbaAcquisitionIdentities(source)[0].category, 'existing_mapping_corroborated');
  assert.equal(JSON.stringify(source), before);
  source.native[0].rostered = false; assert.equal(auditNbaAcquisitionIdentities(source)[0].category, 'existing_mapping_requires_review'); source.native[0].rostered = true;
  source.espn[0].name = 'Someone Else'; assert.equal(auditNbaAcquisitionIdentities(source)[0].category, 'existing_mapping_requires_review');
  assert.equal(source.players[0].is_active, true);
});

function isolatedApi(players = [player]) {
  const state = { calls: [], receipts: [], count: 0 };
  const api = async body => {
    state.calls.push(body);
    if (body.action === 'cohort') return { players };
    if (body.action === 'health') return { project_ref: 'isolated', append_source_hash: require('../lib/player-center/nbaRefresh.ts').NBA_APPEND_SOURCE_MD5, schema_ok: true, reference_errors: 0, history_count: state.count, current_count: state.count,
      current_checksum: String(state.count), available_bytes: 1048576 * 1000, database_bytes: 100000000, cache_bytes: 1000, wal_bytes: 128 * 1048576, metrics_at: new Date().toISOString() };
    if (body.action === 'receipts') return { receipts: state.receipts };
    if (body.action === 'publish') { const pending = body.publications.filter(p => !state.receipts.some(r => r.player_id === p.player_id));
      const added = pending.reduce((s, p) => s + p.observations.length, 0); state.count += added;
      state.receipts.push(...pending.map(p => ({ player_id: p.player_id, appended_versions: p.observations.length })));
      return { players: body.publications.length, accepted: added, appended: added }; }
    throw Error('Unknown isolated action');
  };
  return { state, api };
}
const sourceReader = async (_player, _season, kind) => ({ payload: structuredClone(kind === 'log' ? input().log.payload : input().summary.payload), fetchedAt: new Date().toISOString() });
test('dry run has zero publications, represents blocked identities, and exposes failures instead of green success', async () => {
  const blocked = { ...player, playerId: 7, identity: 'unresolved', providerPlayerId: null };
  const { state, api } = isolatedApi([player, blocked]);
  const result = await runNbaRefresh({ api, read: sourceReader, season: 2027, expectedProject: 'isolated' });
  assert.equal(state.calls.some(b => b.action === 'publish'), false); assert.equal(result.blocked.length, 1); assert.equal(result.clean, false);
  assert.equal(result.publications.length, 2);
});
test('execution verifies committed receipts and resumes without republishing acknowledged players', async () => {
  const { state, api } = isolatedApi(); let saved;
  const result = await runNbaRefresh({ api, read: sourceReader, season: 2027, execute: true, expectedProject: 'isolated', save: s => { saved = structuredClone(s); } });
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.appended, 2); assert.equal(result.appendedThisAttempt, 2);
  const calls = state.calls.filter(b => b.action === 'publish').length;
  const again = await runNbaRefresh({ api, read: () => { throw Error('Unexpected reacquisition'); }, season: 2027, execute: true, checkpoint: saved, expectedProject: 'isolated' });
  assert.equal(again.appended, 2); assert.equal(again.appendedThisAttempt, 0); assert.equal(state.count, 2); assert.equal(state.calls.filter(b => b.action === 'publish').length, calls + 1);
});
test('storage pressure and cohort drift stop before any publication', async () => {
  const { state, api } = isolatedApi();
  await assert.rejects(runNbaRefresh({ api: async body => body.action === 'health' ? { ...(await api(body)), available_bytes: 256 * 1048576 } : api(body), read: sourceReader, season: 2027, execute: true, expectedProject: 'isolated' }), /gate failed/);
  assert.equal(state.calls.some(b => b.action === 'publish'), false);
  const checkpoint = { version: 1, season: 2027, execute: true, runId: uuid(1), asOf: new Date().toISOString(), players: [player], publications: [], committedPlayers: [], events: [] };
  await assert.rejects(runNbaRefresh({ api: async body => body.action === 'cohort' ? { players: [] } : api(body), read: sourceReader, season: 2027, execute: true, checkpoint, expectedProject: 'isolated' }), /cohort changed/);
});
test('provider retries transient HTTP only with a bounded budget; malformed success is not blind-retried', async () => {
  let now = 1000, calls = 0;
  const reader = providerReader({ now: () => now, sleep: async ms => { now += ms; }, deadline: 100000, maxRequests: 3,
    request: async () => { calls++; return new Response(calls === 1 ? '' : '{}', { status: calls === 1 ? 503 : 200 }); } });
  assert.ok((await reader.read(player, 2027, 'log')).payload); assert.equal(calls, 2);
  const invalid = providerReader({ now: () => now, sleep: async () => {}, deadline: 100000, maxRequests: 2, request: async () => { calls++; return new Response('bad json'); } });
  assert.ok((await invalid.read(player, 2027, 'log')).error); assert.equal(calls, 3);
});

test('a dropped acknowledgement is reconciled by exact replay, not duplicated writes or fresh acquisition', async () => {
  const { state, api } = isolatedApi(); let checkpoint, lost = false;
  const unreliable = async body => { const value = await api(body); if (body.action === 'publish' && !lost) { lost = true; throw Error('acknowledgement dropped'); } return value; };
  await assert.rejects(runNbaRefresh({ api: unreliable, read: sourceReader, season: 2027, execute: true, expectedProject: 'isolated', save: s => { checkpoint = structuredClone(s); } }), /acknowledgement/);
  assert.equal(checkpoint.status, 'STOPPED'); assert.equal(state.count, 2);
  const done = await runNbaRefresh({ api, read: () => { throw Error('Unexpected fetch'); }, season: 2027, execute: true, checkpoint, expectedProject: 'isolated' });
  assert.equal(done.status, 'COMPLETE'); assert.equal(state.count, 2); assert.equal(done.appended, 2);
});
test('provider-wide degradation stops at ten failures and saves published failure statuses', async () => {
  const players = Array.from({ length: 15 }, (_, i) => ({ ...player, playerId: i + 100, providerPlayerId: String(i + 1000), nativePlayerId: String(i + 10000) }));
  const { state, api } = isolatedApi(players); let requests = 0, saved;
  const read = async (_p, _s, kind) => { requests++; return { fetchedAt: new Date().toISOString(), payload: kind === 'log' ? empty : { filters: [{ name: 'league', value: 'nba' }, { name: 'seasontype', value: '2' }], categories: [] } }; };
  await assert.rejects(runNbaRefresh({ api, read, season: 2027, execute: true, expectedProject: 'isolated', save: s => { saved = structuredClone(s); } }), /circuit breaker/);
  assert.equal(requests, 20); assert.equal(saved.failed.length, 10); assert.equal(state.receipts.length, 10); assert.equal(saved.clean, false);
});
