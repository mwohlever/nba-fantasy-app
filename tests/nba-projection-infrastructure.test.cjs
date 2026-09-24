/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);

const { observationRecordFromNbaObservation, resolveStoredNbaProviderIdentity, uniqueExactNameCandidate, selectNbaProjectionHistoryRecords,
  scoreCachedNbaProjection, statCacheRecordFromProjection } = require('../lib/analytics/nba/projectionInfrastructure.ts');
const { ingestNbaProjectionObservations } = require('../lib/analytics/nba/projectionIngestion.server.ts');
const { generateNbaProjectionStatCache } = require('../lib/analytics/nba/projectionGeneration.server.ts');

const stats = { points: 10, rebounds: 2, assists: 1, steals: 0, blocks: 0, turnovers: 1 };
function observation({ id = 'event', season = 2026, day = 1, minutes = 20, values = stats, status = 'final', participation = 'played', missing = [] } = {}) {
  return { sport: 'nba', identity: { status: 'unresolved', canonicalPlayerId: null, reason: 'test' }, provider: 'espn', providerPlayerId: '42', eventId: id,
    season, phase: 'regular', gameAt: `2026-01-${String(day).padStart(2, '0')}T18:00:00Z`, completedAt: null,
    team: { providerId: '1', abbreviation: 'AAA' }, opponent: { providerId: '2', abbreviation: 'BBB' }, homeAway: 'home', gameStatus: status,
    finalEvidence: 'explicit', participation, minutes: participation === 'dnp' ? null : minutes, starter: null, stats: values,
    shooting: { fieldGoalsMade: null, fieldGoalsAttempted: null, freeThrowsMade: null, freeThrowsAttempted: null, threePointersMade: null, threePointersAttempted: null },
    provenance: { source: 'https://espn.test/log', fetchedAt: '2026-01-20T00:00:00Z', knownAt: null }, missing };
}
const identity = { provider: 'espn', providerPlayerId: '42', playerId: 7, providerName: 'Known Player', status: 'resolved', method: 'reviewed_provider_evidence', evidence: 'Reviewed ESPN profile', locked: true };
function record(input) { const result = observationRecordFromNbaObservation(observation(input), 7); assert.ok(result); return result; }

test('identity resolution uses only reviewed crosswalk evidence and never promotes name candidates', () => {
  assert.deepEqual(resolveStoredNbaProviderIdentity('42', [identity]), { playerId: 7, status: 'resolved', reason: 'Reviewed ESPN profile' });
  assert.equal(resolveStoredNbaProviderIdentity('99', [identity]).playerId, null);
  assert.deepEqual(uniqueExactNameCandidate('Known Player', [{ id: 7, name: 'Known Player' }]), { playerId: 7, status: 'candidate' });
  assert.equal(uniqueExactNameCandidate('Known Player', [{ id: 7, name: 'Known Player' }, { id: 8, name: 'Known Player' }]), null);
  assert.equal(resolveStoredNbaProviderIdentity('42', [{ ...identity, status: 'unresolved', playerId: null, method: 'unresolved' }]).playerId, null);
});

test('only complete final played games become stored observations', () => {
  assert.ok(observationRecordFromNbaObservation(observation(), 7));
  assert.equal(observationRecordFromNbaObservation(observation({ participation: 'dnp', values: { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 } }), 7), null);
  assert.equal(observationRecordFromNbaObservation(observation({ status: 'in_progress' }), 7), null);
  assert.equal(observationRecordFromNbaObservation(observation({ values: { ...stats, blocks: null } }), 7), null);
});

test('ingestion is idempotent, updates corrected final stats, and preserves unresolved observations', async () => {
  const saved = new Map(); let calls = 0;
  const repository = { loadProviderIdentities: async () => [identity, { ...identity, providerPlayerId: '99', playerId: null, status: 'unresolved', method: 'unresolved', evidence: 'Awaiting review' }],
    upsertObservations: async rows => rows.forEach(row => saved.set(`${row.provider}:${row.provider_player_id}:${row.provider_event_id}`, row)) };
  const fetchGameLog = async ({ espnPlayerId, season }) => ({ observations: [observation({ id: `same-${season}`, season, values: { ...stats, points: ++calls } })] });
  await ingestNbaProjectionObservations({ repository, season: 2026, providerPlayerIds: ['42'], fetchGameLog });
  await ingestNbaProjectionObservations({ repository, season: 2026, providerPlayerIds: ['42'], fetchGameLog });
  assert.equal(saved.size, 2); // one stable event ID per season
  assert.equal([...saved.values()].find(row => row.season === 2026).points, 4);
  const unresolvedFetch = async ({ espnPlayerId, season }) => ({ observations: [{ ...observation({ id: `u${season}`, season }), providerPlayerId: espnPlayerId }] });
  const result = await ingestNbaProjectionObservations({ repository, season: 2026, providerPlayerIds: ['99'], fetchGameLog: unresolvedFetch });
  assert.equal(result.unresolvedObservations, 2); assert.equal([...saved.values()].filter(row => row.local_player_id === null).length, 2);
});

test('repository history selection retains only current/prior seasons before asOf', () => {
  const rows = [record({ id: 'prior', season: 2025, day: 1 }), record({ id: 'current', day: 2 }), record({ id: 'future', day: 25 }), record({ id: 'old', season: 2024, day: 1 })];
  const selected = selectNbaProjectionHistoryRecords({ rows, playerId: 7, targetSeason: 2026, asOf: '2026-01-20T00:00:00Z' });
  assert.deepEqual(selected.map(row => row.provider_event_id), ['prior', 'current']);
});

test('batch generation feeds normalized history into V1, caches model version/freshness, and returns no-history cleanly', async () => {
  const rows = [...Array.from({ length: 8 }, (_, i) => record({ id: `p${i}`, season: 2025, day: i + 1, minutes: 20 })),
    ...Array.from({ length: 8 }, (_, i) => record({ id: `c${i}`, season: 2026, day: i + 10, minutes: 20 }))];
  const writes = [];
  const result = await generateNbaProjectionStatCache({ playerIds: [7, 8], targetSeason: 2026, asOf: '2026-01-20T00:00:00Z', generatedAt: '2026-01-20T01:00:00Z',
    repository: { loadHistories: async () => new Map([[7, { observations: rows, latestGameAt: '2026-01-17T18:00:00Z', latestUpdatedAt: '2026-01-20T00:30:00Z' }], [8, { observations: [], latestGameAt: null, latestUpdatedAt: null }]]),
      upsertStatCache: async cache => writes.push(...cache) } });
  assert.equal(result.generated.length, 1); assert.deepEqual(result.unavailable, [8]); assert.equal(writes[0].model_version, 'nba-v2-robust50i25-recent15-v1');
  assert.equal(writes[0].generated_at, '2026-01-20T01:00:00Z'); assert.equal(writes[0].source_latest_game_at, '2026-01-17T18:00:00Z');
});

test('one cached stat line scores differently under separate frozen NBA snapshots without cache leakage', () => {
  const cache = statCacheRecordFromProjection({ projection: { playerId: '111:nba:players:7', sport: 'nba', modelVersion: 'nba_projection_v1', generatedAt: '2026-01-20T01:00:00Z', asOf: '2026-01-20T00:00:00Z',
    projectedScore: 0, projectedStats: { points: 10, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 }, projectedParticipation: { expectedMinutes: 20 }, confidence: 'medium',
    sample: { currentGames: 5, priorGames: 8, currentMinutes: 100, priorMinutes: 160, effectiveSampleSize: 4, priorAvailable: true, lowWorkload: false, roleChange: false, fallbackReason: null } }, sourceLatestGameAt: null, sourceLatestUpdatedAt: null });
  assert.equal(scoreCachedNbaProjection(cache, { sport: 'nba', scoring: { points: 1 } }), 10);
  assert.equal(scoreCachedNbaProjection(cache, { sport: 'nba', scoring: { points: 2 } }), 20);
});

test('batched projection history retrieval paginates beyond the Supabase 1,000-row response limit', () => {
  const source = fs.readFileSync(require.resolve('../lib/analytics/nba/projectionRepository.server.ts'), 'utf8');

  assert.match(source, /const NBA_HISTORY_PAGE_SIZE = 1000;/);
  assert.match(source, /\.range\(from,\s*from \+ NBA_HISTORY_PAGE_SIZE - 1\)/);
  assert.match(source, /if \(page\.length < NBA_HISTORY_PAGE_SIZE\) break;/);
  assert.match(source, /\.order\('game_at', \{ ascending: true \}\)\s*\.order\('id', \{ ascending: true \}\)/);
});

test('batched history narrows by resolved ESPN IDs without changing view, player, season, date, or page semantics', async () => {
  const asOf = '2026-09-24T00:00:00Z';
  const makeRow = (event, localPlayerId, providerPlayerId, overrides = {}) => ({
    id: Number(event.replace(/\D/g, '')) + 1, provider: 'espn', provider_player_id: providerPlayerId,
    provider_event_id: event, local_player_id: localPlayerId, season: 2026,
    game_at: '2026-01-20T00:00:00Z', provider_fetched_at: '2026-01-21T00:00:00Z',
    points: 1, rebounds: 1, assists: 1, steals: 0, blocks: 0, turnovers: 0, minutes: 20,
    ...overrides,
  });
  const versions = [
    ...Array.from({ length: 1005 }, (_, i) => makeRow(`event${i}`, 7, '42')),
    makeRow('event0', 7, '42', { id: 2000, points: 99, provider_fetched_at: '2026-01-22T00:00:00Z' }),
    makeRow('other1', 8, '43'), makeRow('tail1', 298, '55'),
    makeRow('unrequested1', 9, '44'), makeRow('wrongLocal1', 9, '42'),
    makeRow('unresolved1', null, '99'),
    makeRow('prior1', 7, '42', { season: 2025, game_at: '2025-12-20T00:00:00Z' }),
    makeRow('old1', 7, '42', { season: 2024 }),
    makeRow('future1', 7, '42', { game_at: '2026-10-01T00:00:00Z' }),
  ];
  const identities = [
    { provider: 'espn', resolution_status: 'resolved', player_id: 7, provider_player_id: '42' },
    { provider: 'espn', resolution_status: 'resolved', player_id: 8, provider_player_id: '43' },
    { provider: 'espn', resolution_status: 'resolved', player_id: 9, provider_player_id: '44' },
    { provider: 'espn', resolution_status: 'resolved', player_id: 298, provider_player_id: '55' },
    { provider: 'espn', resolution_status: 'unresolved', player_id: null, provider_player_id: '99' },
  ];
  const queries = [];
  const db = { from(table) {
    const query = { table, filters: [], orders: [], rangeArgs: null };
    queries.push(query);
    const builder = {
      select() { return this; },
      eq(key, value) { query.filters.push([key, 'eq', value]); return this; },
      in(key, value) { query.filters.push([key, 'in', value]); return this; },
      lt(key, value) { query.filters.push([key, 'lt', value]); return this; },
      order(key) { query.orders.push(key); return this; },
      range(from, to) { query.rangeArgs = [from, to]; return this; },
      then(resolve, reject) {
        let data = identities;
        if (table === 'nba_player_game_observations') {
          // Model the SQL view: latest version per provider/player/event, before outer filters.
          const latest = new Map();
          for (const row of versions) {
            const key = `${row.provider}:${row.provider_player_id}:${row.provider_event_id}`;
            const previous = latest.get(key);
            if (!previous || row.provider_fetched_at > previous.provider_fetched_at
              || (row.provider_fetched_at === previous.provider_fetched_at && row.id > previous.id)) latest.set(key, row);
          }
          data = [...latest.values()];
        }
        for (const [key, op, value] of query.filters) {
          data = data.filter(row => op === 'eq' ? row[key] === value : op === 'in' ? value.includes(row[key]) : row[key] < value);
        }
        if (query.orders.length) data.sort((a, b) => a.game_at.localeCompare(b.game_at) || a.id - b.id);
        if (query.rangeArgs) data = data.slice(query.rangeArgs[0], query.rangeArgs[1] + 1);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
  const source = fs.readFileSync(require.resolve('../lib/analytics/nba/projectionRepository.server.ts'), 'utf8');
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabaseAdmin') return { supabaseAdmin: db };
    if (name === './projectionInfrastructure') return { nbaObservationFromRecord: row => row };
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);

  const playerIds = [7, 8, ...Array.from({ length: 199 }, (_, i) => i + 100)];
  const input = { playerIds, targetSeason: 2026, asOf };
  const generated = await module.exports.nbaProjectionGenerationRepository().loadHistories(input);
  const histories = await module.exports.loadNbaProjectionHistories(input);
  for (const result of [generated, histories]) {
    assert.deepEqual([...result.keys()], playerIds);
    assert.equal(result.get(7).observations.length, 1006);
    assert.equal(result.get(8).observations.length, 1);
    assert.equal(result.get(298).observations.length, 1);
    assert.equal(result.get(100).observations.length, 0);
    assert.equal(result.get(7).observations.find(row => row.provider_event_id === 'event0').points, 99);
    assert.equal(result.get(7).observations[0].provider_event_id, 'prior1');
    assert.ok(result.get(7).observations.every(row => [2025, 2026].includes(row.season) && row.game_at < asOf));
  }
  const historyQueries = queries.filter(query => query.table === 'nba_player_game_observations');
  assert.deepEqual(historyQueries.map(query => query.rangeArgs), [
    [0, 999], [1000, 1999], [0, 999], [0, 999], [1000, 1999], [0, 999],
  ]);
  for (const query of historyQueries.filter(query => query.filters.some(([key, op, value]) => key === 'local_player_id' && op === 'in' && value.includes(7)))) {
    assert.deepEqual(query.filters, [
      ['provider', 'eq', 'espn'], ['provider_player_id', 'in', ['42', '43']],
      ['local_player_id', 'in', playerIds.slice(0, 200)], ['season', 'in', [2025, 2026]], ['game_at', 'lt', asOf],
    ]);
  }
  for (const query of historyQueries.filter(query => query.filters.some(([key, op, value]) => key === 'local_player_id' && op === 'in' && value.includes(298)))) {
    assert.deepEqual(query.filters, [
      ['provider', 'eq', 'espn'], ['provider_player_id', 'in', ['55']],
      ['local_player_id', 'in', [298]], ['season', 'in', [2025, 2026]], ['game_at', 'lt', asOf],
    ]);
  }
  assert.equal(queries.filter(query => query.table === 'nba_player_provider_identities').length, 4);
});
