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
