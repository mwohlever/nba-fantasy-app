/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);

const { projectNbaV1, NBA_PROJECTION_V1 } = require('../lib/analytics/nba/projectionV1.ts');

const AS_OF = '2026-02-01T18:00:00Z';
const STATS = { points: 10, rebounds: 2, assists: 1, steals: 0, blocks: 0, turnovers: 1 };
function row({ id, season = 2026, day, minutes = 20, stats = STATS, participation = 'played', status = 'final' }) {
  return {
    sport: 'nba', identity: { status: 'unresolved', canonicalPlayerId: null, reason: 'test' }, provider: 'espn', providerPlayerId: '42',
    eventId: id, season, phase: 'regular', gameAt: `2026-01-${String(day).padStart(2, '0')}T18:00:00Z`, completedAt: null,
    team: { providerId: '1', abbreviation: 'AAA' }, opponent: { providerId: '2', abbreviation: 'BBB' }, homeAway: 'home',
    gameStatus: status, finalEvidence: 'explicit', participation, minutes: participation === 'dnp' ? null : minutes,
    starter: null, stats, shooting: { fieldGoalsMade: null, fieldGoalsAttempted: null, freeThrowsMade: null, freeThrowsAttempted: null, threePointersMade: null, threePointersAttempted: null },
    provenance: { source: 'test', fetchedAt: '2026-01-01T00:00:00Z', knownAt: null }, missing: [],
  };
}
function current(count, options = {}) {
  return Array.from({ length: count }, (_, index) => row({ id: `c${index}`, day: index + 1, ...options }));
}
function prior(count, options = {}) {
  return Array.from({ length: count }, (_, index) => row({ id: `p${index}`, season: 2025, day: index + 1, ...options }));
}
function run(observations, extra = {}) {
  return projectNbaV1({ playerId: '111:nba:players:7', provider: 'espn', providerPlayerId: '42', targetSeason: 2026,
    asOf: AS_OF, targetRulesSnapshot: { sport: 'nba' }, observations, ...extra });
}
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? 'value'}: ${actual} !== ${expected}`); }

test('established veteran uses W8/S minutes, rates, frozen scoring, and deterministic metadata', () => {
  const veteranPrior = prior(8, { minutes: 30, stats: { points: 15, rebounds: 3, assists: 1.5, steals: 0, blocks: 0, turnovers: 1.5 } });
  const result = run([...veteranPrior, ...current(8, { minutes: 20 })]);
  near(result.projectedParticipation.expectedMinutes, 20, 'minutes');
  near(result.projectedStats.points, 10, 'points');
  near(result.projectedScore, 12.9, 'default frozen score');
  assert.equal(result.modelVersion, NBA_PROJECTION_V1); assert.equal(result.confidence, 'high');
  assert.equal(result.generatedAt, AS_OF); assert.equal(result.sample.priorAvailable, true);
  assert.deepEqual(run([...veteranPrior, ...current(8, { minutes: 20 })]), result);
});

test('one, two, and four current games adopt prior minutes at the fixed schedule', () => {
  for (const [games, share] of [[1, .25], [2, .4], [4, .75]]) {
    const result = run([...prior(8, { minutes: 30 }), ...current(games, { minutes: 40 })]);
    near(result.projectedParticipation.expectedMinutes, share * 40 + (1 - share) * 30, `${games} games`);
    assert.equal(result.confidence, games < 3 ? 'low' : 'medium');
  }
});

test('prior-only player projects from prior history; DNPs never count as zero observations', () => {
  const dnp = row({ id: 'dnp', day: 20, participation: 'dnp', stats: { points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 } });
  const result = run([...prior(8, { minutes: 30 }), dnp]);
  near(result.projectedParticipation.expectedMinutes, 30);
  near(result.projectedStats.points, 10);
  assert.equal(result.sample.currentGames, 0); assert.equal(result.sample.priorGames, 8);
});

test('rookies use current evidence, remain low at one game, and become medium at five games', () => {
  const one = run(current(1, { minutes: 24 }));
  near(one.projectedParticipation.expectedMinutes, 24); assert.equal(one.confidence, 'low');
  assert.equal(one.sample.priorAvailable, false);
  const five = run(current(5, { minutes: 24 }));
  assert.equal(five.confidence, 'medium');
});

test('tiny-minute appearances remain in rate totals and alter expected-minute recency weighting', () => {
  const observations = [...prior(8, { minutes: 20 }), ...current(7, { minutes: 20 }),
    row({ id: 'tiny', day: 8, minutes: 2, stats: { ...STATS, points: 2 } })];
  const result = run(observations);
  assert.equal(result.sample.currentGames, 8);
  assert.ok(result.projectedParticipation.expectedMinutes < 20);
  assert.ok(result.projectedStats.points > 0);
});

test('expected minutes use the exact W8 half-life-three and 80/20 current-season formula', () => {
  const observations = Array.from({ length: 8 }, (_, index) => row({ id: `w${index}`, day: index + 1, minutes: (index + 1) * 10 }));
  const result = run(observations);
  const weights = observations.map((_row, index) => 2 ** (-(observations.length - 1 - index) / 3));
  const w8 = observations.reduce((sum, value, index) => sum + value.minutes * weights[index], 0) / weights.reduce((sum, value) => sum + value, 0);
  near(result.projectedParticipation.expectedMinutes, .8 * w8 + .2 * 45, 'W8/S expected minutes');
});

test('Recent5Rate is blended into CurrentRate and prior production is capped at 300 minutes', () => {
  const early = current(5, { minutes: 10, stats: { ...STATS, points: 10 } });
  const late = current(5, { minutes: 10, stats: { ...STATS, points: 20 } }).map((r, i) => ({ ...r, eventId: `late${i}`, gameAt: `2026-01-${String(i + 10).padStart(2, '0')}T18:00:00Z` }));
  const previous = prior(8, { minutes: 100, stats: { ...STATS, points: 0 } });
  const result = run([...previous, ...early, ...late]);
  // Season rate = 1.5; recent-five rate = 2.0; current = 1.625. 100 current minutes plus 300 capped prior minutes.
  near(result.projectedStats.points / result.projectedParticipation.expectedMinutes, .40625, 'capped projected rate');
});

test('frozen target scoring is honored instead of default/current settings', () => {
  const result = run(current(5), { targetRulesSnapshot: { sport: 'nba', scoring: { points: 2, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 } } });
  near(result.projectedScore, 20);
});

test('recent sustained workload change and acute low workload are exposed and lower confidence', () => {
  const role = [...prior(8), ...current(5, { minutes: 30 }), ...current(3, { minutes: 15 }).map((r, i) => ({ ...r, eventId: `role${i}`, gameAt: `2026-01-${String(i + 15).padStart(2, '0')}T18:00:00Z` }))];
  const changed = run(role);
  assert.equal(changed.sample.roleChange, true); assert.equal(changed.confidence, 'low');
  const low = run([...prior(8), ...current(4, { minutes: 30 }), row({ id: 'short', day: 20, minutes: 10 })]);
  assert.equal(low.sample.lowWorkload, true); assert.equal(low.confidence, 'low');
});

test('target/future observations cannot leak into the projection', () => {
  const base = current(5, { minutes: 20, stats: { ...STATS, points: 10 } });
  const target = { ...row({ id: 'target', day: 31, minutes: 40, stats: { ...STATS, points: 999 } }), gameAt: AS_OF };
  const result = run([...base, target]);
  near(result.projectedStats.points, 10);
});
