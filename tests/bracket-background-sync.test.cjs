/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, main, options) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, main, options);
};
require.extensions['.ts'] = function (module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};

let db, leases, syncCalls, failIds, now, tokenId, syncGate, syncHook, failMessage, cleanupFails, syncResultOverride;
const competition = (id, overrides = {}) => ({ id, season: 2026, sport_key: 'college_football', format_key: 'cfp', status: 'in_progress', starts_at: '2026-09-20T00:00:00Z', ends_at: '2026-09-30T00:00:00Z', ...overrides });
const game = (id, overrides = {}) => ({ competition_id: id, status: 'scheduled', winner_team_id: null, scheduled_at: '2026-09-24T00:00:00Z', metadata: {}, ...overrides });
function reset() {
  db = { bracket_competitions: [competition(1)], bracket_games: [game(1)], bracket_contests: [{ competition_id: 1, status: 'open' }], bracket_sync_runs: [] };
  leases = new Map(); syncCalls = []; failIds = new Set(); syncGate = null; syncHook = null;
  failMessage = 'Provider or scoring interrupted'; cleanupFails = false; syncResultOverride = null;
  now = new Date('2026-09-24T12:00:00Z'); tokenId = 0;
}
function query(table) {
  let rows = db[table], patch, insertRow, filters = [];
  const result = () => {
    if (insertRow) { const row = { id: `run-${db.bracket_sync_runs.length + 1}`, ...insertRow }; db[table].push(row); return { data: [row], error: null }; }
    const selected = rows.filter(row => filters.every(f => f(row)));
    if (patch) for (const row of selected) Object.assign(row, patch);
    return { data: selected.map(row => structuredClone(row)), error: null };
  };
  const chain = {
    select: () => chain,
    in: (field, values) => { filters.push(row => values.includes(row[field])); return chain; },
    eq: (field, value) => { filters.push(row => row[field] === value); return chain; },
    order: () => chain,
    insert: value => { insertRow = value; return chain; },
    update: value => { patch = value; return chain; },
    single: async () => ({ data: result().data[0], error: null }),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}
const admin = { from: query, rpc: async (name, args) => {
  if (name === 'prune_bracket_sync_runs') {
    if (cleanupFails) return { data: null, error: { message: 'Cleanup unavailable' } };
    const old = db.bracket_sync_runs.filter(row => Date.parse(row.started_at) < now.getTime() - 60 * 86400000)
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)).slice(0, 100);
    db.bracket_sync_runs = db.bracket_sync_runs.filter(row => !old.includes(row));
    return { data: old.length, error: null };
  }
  const id = args.p_competition_id;
  const state = leases.get(id) ?? { token: null, expires: 0, next: 0, failures: 0 };
  if (name === 'claim_bracket_sync') {
    if (state.token && state.expires > now.getTime()) return { data: { state: 'leased' }, error: null };
    if (!args.p_ignore_retry && state.next > now.getTime()) return { data: { state: 'backoff' }, error: null };
    const recovered = Boolean(state.token);
    state.token = `token-${++tokenId}`; state.expires = now.getTime() + 300000; leases.set(id, state);
    return { data: { state: 'claimed', token: state.token, recovered }, error: null };
  }
  assert.equal(name, 'finish_bracket_sync');
  if (state.token !== args.p_lease_token) return { data: false, error: null };
  state.token = null; state.expires = 0;
  if (args.p_succeeded) { state.failures = 0; state.next = 0; state.summary = args.p_summary; }
  else { state.failures++; state.next = now.getTime() + Math.min(21600000, 120000 * 2 ** (state.failures - 1)); state.error = args.p_error; }
  return { data: true, error: null };
} };
Module._load = function (name, parent, main) {
  if (name === 'server-only') return {};
  if (name === '@/lib/supabaseAdmin') return { supabaseAdmin: admin };
  if (name === './competitionSync.server') return { syncBracketCompetitionResults: async id => {
    syncCalls.push(id);
    if (syncHook) syncHook(id);
    if (syncGate && id === 1) await syncGate;
    if (failIds.has(id)) throw new Error(failMessage);
    return syncResultOverride ?? { promoted: 1, liveUpdated: 0, skipped: 0, conflicts: 0, frozen: db.bracket_contests.filter(c => c.competition_id === id).length, unsupported: false };
  } };
  return originalLoad.call(this, name, parent, main);
};
const worker = require('../lib/bracket/backgroundSync.server.ts');
Module._load = originalLoad;

const eligible = (c, gs = [game(c.id)], cs = [{ status: 'open' }]) => worker.bracketCompetitionNeedsSync(c, gs, cs, new Date('2026-09-24T12:00:00Z'));
test('discovery bounds dates, lifecycle, unresolved games and recent scoring retry', () => {
  assert.equal(eligible(competition(1)), true);
  assert.equal(eligible(competition(1, { starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-20T00:00:00Z' })), false);
  assert.equal(eligible(competition(1, { starts_at: '2025-01-01T00:00:00Z', ends_at: '2025-01-20T00:00:00Z' })), false);
  assert.equal(eligible(competition(1), [game(1, { status: 'final', winner_team_id: 'A', metadata: { bracket_scoring_synced_winner: 'A' } })]), false);
  assert.equal(eligible(competition(1), [game(1)], [{ status: 'final' }]), false);
  assert.equal(eligible(competition(1, { status: 'final', ends_at: '2026-09-01T00:00:00Z' }), [game(1, { status: 'final', winner_team_id: 'A' })], [{ status: 'final' }]), true);
  assert.equal(eligible(competition(1, { status: 'final' }), [game(1)], [{ status: 'final' }]), true);
  assert.equal(eligible(competition(1, { starts_at: null, ends_at: null }), [game(1, { scheduled_at: null })]), false);
  assert.equal(eligible(competition(1, { sport_key: 'nfl' })), false);
});
test('one competition is processed once despite multiple Group contests; repeat remains safe', async () => {
  reset(); db.bracket_contests.push({ competition_id: 1, status: 'open' });
  const first = await worker.runBracketBackgroundSync(now);
  const second = await worker.runBracketBackgroundSync(now);
  assert.equal(first.processed, 1); assert.equal(first.details[0].summary.frozen, 2);
  assert.deepEqual(syncCalls, [1, 1]); assert.equal(second.failed, 0);
  assert.equal(db.bracket_sync_runs.length, 2);
});
test('active lease skips, stale lease recovers, and backoff does not block another competition', async () => {
  reset(); db.bracket_competitions.push(competition(2), competition(3));
  db.bracket_games.push(game(2), game(3));
  db.bracket_contests.push({ competition_id: 2, status: 'open' }, { competition_id: 3, status: 'open' });
  leases.set(1, { token: 'other', expires: now.getTime() + 10000, next: 0, failures: 0 });
  leases.set(2, { token: 'dead', expires: now.getTime() - 10000, next: 0, failures: 0 });
  const result = await worker.runBracketBackgroundSync(now);
  assert.equal(result.leaseSkipped, 1); assert.equal(result.recovered, 1);
  assert.deepEqual(syncCalls, [2, 3]);
  failIds.add(2);
  await worker.runBracketBackgroundSync(now);
  const retry = await worker.runBracketBackgroundSync(now);
  assert.equal(retry.backoffSkipped, 1); assert.ok(retry.details.some(row => row.competitionId === 3 && row.state === 'succeeded'));
});
test('simultaneous invocations cannot process the same competition', async () => {
  reset();
  let release;
  syncGate = new Promise(resolve => { release = resolve; });
  const first = worker.syncClaimedBracketCompetition(1);
  await new Promise(resolve => setImmediate(resolve));
  const second = await worker.syncClaimedBracketCompetition(1);
  assert.equal(second.state, 'leased');
  assert.deepEqual(syncCalls, [1]);
  release();
  assert.equal((await first).state, 'succeeded');
});
test('provider/scoring failure is recorded, retried after bounded backoff, and does not stop next competition', async () => {
  reset(); db.bracket_competitions.push(competition(2)); db.bracket_games.push(game(2)); db.bracket_contests.push({ competition_id: 2, status: 'open' });
  failIds.add(1);
  const first = await worker.runBracketBackgroundSync(now);
  assert.equal(first.failed, 1); assert.equal(first.succeeded, 1); assert.equal(first.status, 'partial_failure');
  assert.match(leases.get(1).error, /interrupted/);
  assert.equal(leases.get(1).next - now.getTime(), 120000);
  failIds.delete(1); now = new Date(now.getTime() + 121000);
  const retry = await worker.runBracketBackgroundSync(now);
  assert.equal(retry.succeeded, 2); assert.equal(leases.get(1).failures, 0);
});
test('no eligible competition records an empty successful run', async () => {
  reset(); db.bracket_competitions = [];
  const result = await worker.runBracketBackgroundSync(now);
  assert.equal(result.considered, 0); assert.equal(result.processed, 0); assert.deepEqual(syncCalls, []);
});
test('retention removes at most 100 runs older than 60 days without touching lease state', async () => {
  reset(); db.bracket_competitions = [];
  for (let i = 0; i < 101; i++) db.bracket_sync_runs.push({ id: `old-${i}`, started_at: '2026-07-01T00:00:00Z' });
  db.bracket_sync_runs.push({ id: 'recent', started_at: '2026-09-01T00:00:00Z' });
  leases.set(9, { token: 'keep', expires: now.getTime() + 5000, next: 0, failures: 1 });
  const first = await worker.runBracketBackgroundSync(now);
  assert.equal(first.retentionDeleted, 100);
  assert.equal(db.bracket_sync_runs.filter(row => row.id.startsWith('old-')).length, 1);
  assert.equal(db.bracket_sync_runs.some(row => row.id === 'recent'), true);
  const second = await worker.runBracketBackgroundSync(now);
  assert.equal(second.retentionDeleted, 1);
  assert.equal(leases.get(9).token, 'keep');
});
test('retention failure does not change a successful sync outcome', async () => {
  reset(); cleanupFails = true;
  const result = await worker.runBracketBackgroundSync(now);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.processed, 1);
  assert.equal(result.retentionCleanupFailed, true);
  assert.equal(db.bracket_sync_runs[0].status, 'succeeded');
});
test('errors and result summaries are bounded before persistence', async () => {
  reset();
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-sensitive-value';
  try {
    failIds.add(1);
    failMessage = `Provider failed: Authorization: Bearer test-sensitive-value ${'x'.repeat(5000)}`;
    const failed = await worker.runBracketBackgroundSync(now);
    assert.equal(failed.failed, 1);
    assert.ok(leases.get(1).error.length <= 400);
    assert.ok(failed.details[0].error.length <= 400);
    assert.doesNotMatch(JSON.stringify(failed), /test-sensitive-value/);
    failIds.delete(1); now = new Date(now.getTime() + 121000);
    syncResultOverride = { promoted: 1, liveUpdated: 0, skipped: 0, conflicts: 0, frozen: 1, unsupported: false, providerPayload: 'x'.repeat(5000) };
    const succeeded = await worker.runBracketBackgroundSync(now);
    assert.equal(succeeded.succeeded, 1);
    assert.equal(leases.get(1).summary.providerPayload, undefined);
    assert.equal(succeeded.details[0].summary.providerPayload, undefined);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});
test('worker stops starting competitions after the 30-second start window', async () => {
  reset(); db.bracket_competitions.push(competition(2)); db.bracket_games.push(game(2));
  db.bracket_contests.push({ competition_id: 2, status: 'open' });
  const originalNow = Date.now;
  let wall = 0;
  Date.now = () => wall;
  syncHook = () => { wall = 31000; };
  try {
    const result = await worker.runBracketBackgroundSync(now);
    assert.equal(result.eligible, 2);
    assert.equal(result.processed, 1);
    assert.deepEqual(syncCalls, [1]);
  } finally { Date.now = originalNow; }
});
test('many leased competitions retain aggregate counts with bounded run details', async () => {
  reset();
  for (let id = 2; id <= 26; id++) {
    db.bracket_competitions.push(competition(id)); db.bracket_games.push(game(id));
    db.bracket_contests.push({ competition_id: id, status: 'open' });
  }
  for (let id = 1; id <= 26; id++) leases.set(id, { token: 'other', expires: now.getTime() + 300000, next: 0, failures: 0 });
  const result = await worker.runBracketBackgroundSync(now);
  assert.equal(result.leaseSkipped, 26);
  assert.equal(result.processed, 0);
  assert.equal(result.details.length, 21);
  assert.equal(result.details.at(-1).count, 6);
  assert.equal(db.bracket_sync_runs[0].details.length, 21);
});
test('manual Group boundary delegates to the same competition lease', async () => {
  const called = [];
  Module._load = function (name, parent, main) {
    if (name === 'server-only') return {};
    if (name === './challenge.server') return { getBracketChallengeDetail: async (_user, contestId) =>
      contestId === 'own-contest' ? { competition: { id: 7 } } : null };
    if (name === './backgroundSync.server') return { syncClaimedBracketCompetition: async (...args) => {
      called.push(args); return { state: 'succeeded', result: { promoted: 1 } };
    } };
    return originalLoad.call(this, name, parent, main);
  };
  let manual;
  try { manual = require('../lib/bracket/resultSync.server.ts'); } finally { Module._load = originalLoad; }
  assert.equal(await manual.syncBracketOfficialResults({ id: 'user' }, 'other-contest'), null);
  assert.deepEqual(called, []);
  assert.deepEqual(await manual.syncBracketOfficialResults({ id: 'user' }, 'own-contest'), { promoted: 1 });
  assert.deepEqual(called, [[7, true]]);
});
test('cron route authenticates before loading worker and rejects malformed bearer headers', async () => {
  let calls = 0, loads = 0;
  Module._load = function (name, parent, main) {
    if (name === '@/lib/bracket/backgroundSync.server') { loads++; return { runBracketBackgroundSync: async () => { calls++; return { status: 'succeeded' }; } }; }
    return originalLoad.call(this, name, parent, main);
  };
  let route;
  route = require('../app/api/cron/bracket-results/route.ts');
  assert.equal(route.POST, undefined);
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await route.GET(new Request('http://localhost/cron'))).status, 401);
    process.env.CRON_SECRET = 'test-secret';
    assert.equal((await route.GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer wrong' } }))).status, 401);
    assert.equal((await route.GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer not-secret' } }))).status, 401);
    assert.equal((await route.GET(new Request('http://localhost/cron', { headers: { authorization: 'Basic test-secret' } }))).status, 401);
    assert.equal((await route.GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer test-secret extra' } }))).status, 401);
    assert.equal((await route.GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer' } }))).status, 401);
    assert.equal(calls, 0); assert.equal(loads, 0);
    assert.equal((await route.GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer test-secret' } }))).status, 200);
    assert.equal(calls, 1); assert.equal(loads, 1);
  } finally {
    Module._load = originalLoad;
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});
test('migration keeps new public tables and functions service-role only', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260929000100_bracket_background_sync.sql'), 'utf8');
  for (const table of ['bracket_sync_state', 'bracket_sync_runs']) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /grant select, insert, update on public\.bracket_sync_state to service_role/);
  assert.match(sql, /grant select, insert, update, delete on public\.bracket_sync_runs to service_role/);
  assert.match(sql, /revoke all on public\.bracket_sync_state, public\.bracket_sync_runs from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.claim_bracket_sync[\s\S]*to service_role/);
  assert.match(sql, /for update/);
  assert.match(sql, /lease_expires_at > v_now/);
  assert.match(sql, /lease_token = p_lease_token/);
  assert.match(sql, /create function public\.prune_bracket_sync_runs\(\)/);
  assert.match(sql, /interval '60 days'/);
  assert.match(sql, /limit 100/);
  assert.match(sql, /public\.prune_bracket_sync_runs\(\) to service_role/);
  assert.match(sql, /octet_length\(details::text\) <= 16384/);
});
