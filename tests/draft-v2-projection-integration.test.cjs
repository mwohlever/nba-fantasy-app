/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return request.startsWith('@/')
    ? resolve(path.join(process.cwd(), request.slice(2)), parent, ...rest)
    : resolve(request, parent, ...rest);
};
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText,
  filename,
);

const { compareDraftProjections, withHistoricalFantasyAverage } = require('../lib/lineups/draftProjectionTypes.ts');
const { scoreNbaDraftProjection, scoreNflDraftProjection } = require('../lib/lineups/draftProjections.ts');
const { NFL_PROJECTION_V2 } = require('../lib/analytics/nfl/projectionInfrastructure.ts');
const { NBA_PROJECTION_V2 } = require('../lib/analytics/nba/projectionGeneration.server.ts');

test('NFL Draft V2 scoring uses the supplied frozen slate snapshot, including PPR and passing-TD differences', () => {
  const raw = { projected_stats: {
    passing_yards: 250, passing_tds: 1, passing_ints: 1,
    rushing_yards: 20, rushing_tds: 0, receiving_yards: 30,
    receiving_tds: 0, receptions: 4, fumbles_lost: 0,
  } };
  const halfPprFiveTd = scoreNflDraftProjection(raw, { sport: 'nfl', scoring: { receptions: .5, passingTouchdowns: 5 } });
  const fullPprFourTd = scoreNflDraftProjection(raw, { sport: 'nfl', scoring: { receptions: 1, passingTouchdowns: 4 } });
  assert.equal(halfPprFiveTd, 20);
  assert.equal(fullPprFourTd, 21);
  assert.deepEqual(raw.projected_stats, {
    passing_yards: 250, passing_tds: 1, passing_ints: 1,
    rushing_yards: 20, rushing_tds: 0, receiving_yards: 30,
    receiving_tds: 0, receptions: 4, fumbles_lost: 0,
  });
});

test('NBA Draft V2 scoring uses the supplied frozen slate snapshot without changing raw cache stats', () => {
  const raw = { projected_stats: { points: 20, rebounds: 5, assists: 4, steals: 1, blocks: 1, turnovers: 2 } };
  assert.equal(scoreNbaDraftProjection(raw, { sport: 'nba', scoring: { points: 1, rebounds: 1, assists: 1, steals: 1, blocks: 1, turnovers: -1 } }), 29);
  assert.equal(scoreNbaDraftProjection(raw, { sport: 'nba', scoring: { points: 2, rebounds: 1, assists: 1, steals: 1, blocks: 1, turnovers: -1 } }), 49);
  assert.equal(raw.projected_stats.points, 20);
});

test('Draft Projection ordering keeps V2 ahead of fallback and unavailable values, with deterministic numeric comparison', () => {
  const v2 = { projection: 10, source: 'nfl_v2', modelVersion: NFL_PROJECTION_V2, confidence: 'low' };
  const v2Higher = { projection: 20, source: 'nba_v2', modelVersion: NBA_PROJECTION_V2, confidence: 'normal' };
  const fallback = { projection: 99, source: 'historical_fantasy_average', modelVersion: null, confidence: null };
  const unavailable = { projection: null, source: 'unavailable', modelVersion: null, confidence: null };
  assert.ok(compareDraftProjections(v2Higher, v2) < 0);
  assert.ok(compareDraftProjections(v2, fallback) < 0);
  assert.ok(compareDraftProjections(fallback, unavailable) < 0);
  // This is the fallback used for every position without a V2 row, including NFL K/DST.
  assert.deepEqual(withHistoricalFantasyAverage(undefined, 8.5), { projection: 8.5, source: 'historical_fantasy_average', modelVersion: null, confidence: null });
  assert.deepEqual(withHistoricalFantasyAverage(undefined, undefined), unavailable);
});

test('Draft integration explicitly reads only current frozen V2 cache versions and leaves K/DST on fallback behavior', () => {
  const server = fs.readFileSync('lib/lineups/draftProjections.server.ts', 'utf8');
  const route = fs.readFileSync('app/api/draft-projections/route.ts', 'utf8');
  const pool = fs.readFileSync('components/lineups/PlayerPool.tsx', 'utf8');
  const fallback = fs.readFileSync('lib/lineups/draftProjectionTypes.ts', 'utf8');
  assert.match(server, /\.eq\("model_version", NBA_PROJECTION_V2\)/);
  assert.match(server, /\.eq\("model_version", NFL_PROJECTION_V2\)/);
  assert.match(server, /scoreNbaDraftProjection\([\s\S]*slate\.rules_snapshot/);
  assert.match(server, /scoreNflDraftProjection\([\s\S]*slate\.rules_snapshot/);
  assert.match(route, /authorizeSlateResource\(request, slateId\)/);
  assert.match(fallback, /source: "historical_fantasy_average"/);
  assert.match(pool, /setResearchMode\("projection"\)/);
  assert.match(pool, /<option value="projection">Projection<\/option>/);
  assert.doesNotMatch(server, /\.insert\(|\.upsert\(|\.update\(/);
});
