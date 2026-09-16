const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const worker = fs.readFileSync('scripts/run-nba-projection-shadow-refresh.cjs', 'utf8');
const route = fs.readFileSync('app/api/internal/nba/projection-ingest/route.ts', 'utf8');

test('shadow worker bounds observation requests and defers cache generation until every batch is accepted', () => {
  assert.match(worker, /const MAX_OBSERVATIONS_PER_REQUEST=1000;/);
  assert.match(worker, /chunks\(observations,MAX_OBSERVATIONS_PER_REQUEST\)/);
  assert.match(worker, /\{action:'observations',season,observations:batch,generate:false\}/);
  assert.match(worker, /post\(\{action:'generate',season\}\)/);
  assert.match(route, /body\.generate === false/);
  assert.match(route, /body\.action === 'generate'/);
});
