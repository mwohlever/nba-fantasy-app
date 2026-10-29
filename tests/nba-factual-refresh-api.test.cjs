/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), test = require('node:test'), ts = require('typescript');
const { input, build } = require('./helpers/nba-refresh-fixtures.cjs');
const calls = [];
const source = ts.transpileModule(fs.readFileSync('app/api/internal/nba/player-center-refresh/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', source)(name => {
  if (name === 'node:crypto') return require(name);
  if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
  if (name.endsWith('/types')) return { professionalSeason: () => 2027 };
  if (name.endsWith('/supabaseAdmin')) return { supabaseAdmin: { from: () => { throw Error('No unbounded receipt read in fixture'); } } };
  if (name.endsWith('nbaRefreshRepository.server')) return {
    nbaRefreshCohort: async () => { calls.push('cohort'); return []; },
    nbaRefreshHealth: async () => { calls.push('health'); return {}; },
    publishNbaRefresh: async p => { calls.push(p); return { appended: 0 }; },
  };
  throw Error('Unexpected module ' + name);
}, mod, mod.exports);
const request = (body, auth = 'Bearer isolated-secret') => new Request('http://isolated.test', { method: 'POST', headers: { authorization: auth }, body: typeof body === 'string' ? body : JSON.stringify(body) });
test('factual API rejects unauthenticated/non-Bearer requests before reads or publications', async () => {
  process.env.NBA_PROJECTION_INGEST_SECRET = 'isolated-secret'; calls.length = 0;
  for (const auth of ['', 'isolated-secret', 'Bearer wrong']) assert.equal((await mod.exports.POST(request({ action: 'cohort' }, auth))).status, 401);
  assert.equal(calls.length, 0);
});
test('cohort/health actions are read-only, bounded publication is explicit, and forecasts have no action', async () => {
  process.env.NBA_PROJECTION_INGEST_SECRET = 'isolated-secret'; calls.length = 0;
  assert.equal((await mod.exports.POST(request({ action: 'cohort' }))).status, 200);
  assert.equal((await mod.exports.POST(request({ action: 'health', full: true }))).status, 200);
  const value = input();
  assert.equal((await mod.exports.POST(request({ action: 'publish', runId: value.runId, season: 2027, asOf: value.asOf, publications: [build(value)] }))).status, 200);
  assert.equal(calls.filter(x => typeof x === 'object').length, 1);
  assert.equal((await mod.exports.POST(request({ action: 'generate', runId: value.runId, season: 2027 }))).status, 400);
});
test('invalid UUID, future seasons, oversized/empty batches and malformed JSON cannot reach publication', async () => {
  process.env.NBA_PROJECTION_INGEST_SECRET = 'isolated-secret'; calls.length = 0;
  const value = input(), base = { action: 'publish', runId: value.runId, season: 2027, asOf: value.asOf, publications: [build(value)] };
  for (const bad of [{ ...base, runId: 'bad' }, { ...base, season: 2028 }, { ...base, publications: [] }, { ...base, publications: Array(6).fill(build(value)) }]) assert.equal((await mod.exports.POST(request(bad))).status, 400);
  assert.equal((await mod.exports.POST(request('x'.repeat(3000001)))).status, 413);
  assert.equal((await mod.exports.POST(request('{'))).status, 503);
  assert.equal(calls.length, 0);
});

const storage = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync('lib/player-center/nbaRefreshStorage.server.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(name => name === './nbaRefresh' ? require('../lib/player-center/nbaRefresh.ts') : {}, storage, storage.exports);
test('storage gate protects physical reserve, live database and cache budget; missing/stale metrics fail closed', async () => {
  const now = Date.now(), h = { schema_ok: true, database_bytes: 234000000, cache_bytes: 2000000, wal_bytes: 134217728, available_bytes: 1000000000, metrics_at: new Date(now).toISOString() };
  storage.exports.assertNbaRefreshStorage(h, 500000, now);
  for (const change of [{ available_bytes: 256 * 1048576 }, { database_bytes: 450000000 }, { cache_bytes: 64 * 1048576 }, { available_bytes: undefined }, { metrics_at: 'bad' }, { metrics_at: new Date(now - 100000).toISOString() }, { schema_ok: false }]) assert.throws(() => storage.exports.assertNbaRefreshStorage({ ...h, ...change }, 0, now));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://isolated.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-only';
  const metrics = 'node_filesystem_avail_bytes{mountpoint="/data"} 1000000000\nnode_filesystem_readonly{mountpoint="/data"} 0\npg_wal_size_mb{} 128\npg_database_size_bytes{datname="postgres"} 234000000';
  const response = (body = metrics, date = now) => new Response(body, { headers: { date: new Date(date).toUTCString() } });
  assert.equal((await storage.exports.readNbaRefreshDisk(now, async () => response())).available_bytes, 1000000000);
  await assert.rejects(storage.exports.readNbaRefreshDisk(now, async () => response(metrics, now - 100000)), /stale/);
  await assert.rejects(storage.exports.readNbaRefreshDisk(now, async () => response(metrics.replace('} 0', '} 1'))), /missing/);
});
