/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
test('legacy NBA entry points cannot bypass factual cache publication or generate forecasts', () => {
  const worker=fs.readFileSync('scripts/run-nba-projection-shadow-refresh.cjs','utf8');
  const route=fs.readFileSync('app/api/internal/nba/projection-ingest/route.ts','utf8');
  assert.match(worker,/process.exitCode = 1/);assert.doesNotMatch(worker,/fetch\(|post\(/);
  assert.match(route,/status: 410/);assert.doesNotMatch(route,/upsert|generateNba|refreshNba/);
});
