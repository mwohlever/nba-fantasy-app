/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, process, Buffer, performance, Date, Response,
    console: { info() {}, warn() {}, error() {}, log() {} },
    require(name) { if (name in mocks) return mocks[name]; return require(name); },
  });
  return loaded.exports;
}
const policy = load('lib/golf/backgroundRefreshPolicy.ts');
const safety = load('lib/golf/backgroundRefreshSafety.ts');
const slate = (id = 1, overrides = {}) => ({ id, sport: 'golf', league_id: `league-${id}`, start_date: '2026-09-24', end_date: '2026-09-27',
  external_event_id: 'event-1', is_locked: false, archived_at: null, ...overrides });
let now, db, leases, calls, failIds, gate, hook, resultOverride, cleanupFails, discoveryFails, finishFails, ownerLost;
function reset() {
  now = new Date('2026-09-25T12:00:00Z'); db = { slates: [slate()], golf_sync_runs: [] }; leases = new Map(); calls = [];
  failIds = new Set(); gate = null; hook = null; resultOverride = null; cleanupFails = false; discoveryFails = false; finishFails = false; ownerLost = false;
}
function query(table) {
  let filters = [], insert, patch, take = Infinity;
  const result = () => {
    if (discoveryFails && table === 'slates') return { data: null, error: { message: 'discovery offline' } };
    if (insert) { const row = { id: `run-${db.golf_sync_runs.length + 1}`, ...insert }; db[table].push(row); insert = null; return { data: [row], error: null }; }
    const rows = table === 'golf_sync_state' ? [...leases].map(([id, state]) => ({ slate_id: id, next_attempt_at: state.next ? new Date(state.next).toISOString() : null, last_attempt_at: state.attempt })) : db[table] ?? [];
    const selected = rows.filter(row => filters.every(f => f(row))).slice(0, take);
    if (patch) for (const row of selected) Object.assign(row, patch);
    return { data: selected.map(row => structuredClone(row)), error: null };
  };
  const q = {
    select: () => q, order: () => q, limit: n => { take = n; return q; },
    eq: (k, v) => { filters.push(row => row[k] === v); return q; },
    is: (k, v) => { filters.push(row => row[k] === v); return q; },
    not: (k, op, v) => { assert.equal(op, 'is'); filters.push(row => row[k] !== v); return q; },
    in: (k, v) => { filters.push(row => v.includes(row[k])); return q; },
    lte: (k, v) => { filters.push(row => row[k] <= v); return q; },
    gte: (k, v) => { filters.push(row => row[k] >= v); return q; },
    insert: row => { insert = row; return q; }, update: row => { patch = row; return q; },
    single: async () => { const r = result(); return { ...r, data: r.data?.[0] }; },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
}
const admin = { from: query, rpc: async (name, args) => {
  if (name === 'prune_golf_sync_runs') return { data: 0, error: cleanupFails ? { message: 'prune failed' } : null };
  const id = args.p_slate_id, state = leases.get(id) ?? { token: null, expires: 0, next: 0, failures: 0 };
  if (name === 'claim_golf_sync') {
    const s = db.slates.find(s => s.id === id);
    if (!s || s.sport !== 'golf' || s.is_locked && !(args.p_ignore_retry && args.p_allow_locked) || s.archived_at && !args.p_ignore_retry)
      return { data: { state: 'ineligible' }, error: null };
    if (state.token && state.expires > now.getTime()) return { data: { state: 'leased' }, error: null };
    if (!args.p_ignore_retry && state.next > now.getTime()) return { data: { state: 'backoff' }, error: null };
    const recovered = Boolean(state.token); state.token = `token-${id}-${calls.length}`; state.expires = now.getTime() + 300000;
    state.attempt = now.toISOString(); leases.set(id, state);
    return { data: { state: 'claimed', token: state.token, recovered }, error: null };
  }
  if (name === 'golf_sync_lease_owned') return { data: !ownerLost && state.token === args.p_lease_token && state.expires > now.getTime(), error: null };
  assert.equal(name, 'finish_golf_sync');
  if (finishFails || state.token !== args.p_lease_token) return { data: false, error: null };
  state.token = null; state.expires = 0; state.summary = args.p_summary;
  if (args.p_succeeded) { state.failures = 0; state.next = now.getTime() + args.p_delay_seconds * 1000; }
  else { state.failures++; state.error = args.p_error; state.next = now.getTime() + Math.min(21600000, 120000 * 2 ** (state.failures - 1)); }
  return { data: true, error: null };
} };
const core = { refreshGolfSlate: async (id, input, assertLease) => {
  await assertLease(); calls.push({ id, input });
  if (hook) hook(id);
  if (gate) await gate;
  await assertLease();
  if (failIds.has(id)) throw new Error(`Provider interrupted Bearer sensitive-value ${'x'.repeat(600)}`);
  const s = db.slates.find(s => s.id === id);
  const result = resultOverride ?? { success: true, slateId: id, tournament: { eventId: s.external_event_id, status: 'in_progress', startDate: s.start_date, currentRound: 2 },
    acceptedRevision: 10, teamResultsUpserted: 1, preview: 'x'.repeat(10000) };
  if (result.slateAutoLocked) s.is_locked = true;
  return Response.json(result, { status: result.httpStatus ?? 200 });
} };
const worker = load('lib/golf/backgroundRefresh.server.ts', { 'server-only': {}, '@/lib/supabaseAdmin': { supabaseAdmin: admin },
  './refreshSlate.server': core, './backgroundRefreshPolicy': policy, './backgroundRefreshSafety': safety });

test('active, upcoming and finalization windows; inactive, malformed and stale slates skip', () => {
  reset();
  const eligible = (s, state) => policy.golfSlateRefreshEligibility(s, state, now);
  assert.equal(eligible(slate()).eligible, true);
  assert.equal(eligible(slate(1, { start_date: '2026-10-03', end_date: '2026-10-06' })).reason, 'upcoming');
  assert.equal(eligible(slate(1, { end_date: '2026-09-23', start_date: '2026-09-20' })).reason, 'finalization');
  for (const change of [{ is_locked: true }, { archived_at: now.toISOString() }, { sport: 'nba' }, { external_event_id: ' ' },
    { start_date: '2026-10-04', end_date: '2026-10-07' }, { start_date: '2026-09-10', end_date: '2026-09-22' },
    { start_date: 'bad' }, { end_date: '2026-09-20' }]) assert.equal(eligible(slate(1, change)).eligible, false);
  assert.equal(eligible(slate(), { next_attempt_at: new Date(now.getTime() + 1000).toISOString() }).reason, 'not_due');
});
test('cadence keeps live/cut/final transitions frequent; upcoming/field publication are sparse', () => {
  reset();
  for (const status of ['in_progress', 'final']) assert.equal(policy.golfRefreshDelaySeconds('2026-09-24', now, status), 240);
  assert.equal(policy.golfRefreshDelaySeconds('2026-10-01', now, 'scheduled'), 21600);
  assert.equal(policy.golfRefreshDelaySeconds('2026-09-26', now, 'scheduled'), 3600);
  assert.equal(policy.golfRefreshDelaySeconds('2026-09-25', now, 'scheduled'), 240);
  assert.equal(policy.golfRefreshDelaySeconds('2026-09-25', now, 'scheduled', true), 3600);
});
test('discovery refreshes exact slate IDs, preserves separate Groups sharing an event; immediate repeat skips', async () => {
  reset(); db.slates.push(slate(2), slate(3, { is_locked: true }), slate(4, { archived_at: now.toISOString() }), slate(5, { sport: 'nfl' }));
  const first = await worker.runGolfBackgroundRefresh(now), second = await worker.runGolfBackgroundRefresh(now);
  assert.deepEqual(calls.map(c => c.id), [1, 2]);
  assert.equal(first.considered, 2); assert.equal(first.succeeded, 2); assert.equal(second.processed, 0);
  assert.equal(second.backoffSkipped, 2); assert.equal(db.golf_sync_runs.length, 2);
  assert.deepEqual(Array.from(first.details, d => d.eventId), ['event-1', 'event-1']);
  assert.equal(leases.get(1).summary.preview, undefined);
});
test('lease excludes overlapping browser/worker calls, manual ignores cadence only', async () => {
  reset(); let release; gate = new Promise(resolve => { release = resolve; });
  const pending = worker.runClaimedGolfSlate(1, { scoreboardPayload: { events: [] } }, true, now);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await worker.runClaimedGolfSlate(1, {}, true, now)).state, 'leased');
  assert.equal((await worker.runGolfBackgroundRefresh(now)).leaseSkipped, 1);
  release(); await pending; gate = null;
  assert.equal((await worker.runClaimedGolfSlate(1, {}, false, now)).state, 'backoff');
  assert.equal((await worker.runClaimedGolfSlate(1, {}, true, now)).state, 'succeeded');
  assert.equal(calls.length, 2);
});
test('expired leases recover; lost ownership stops scoring and cannot finish over another token', async () => {
  reset(); leases.set(1, { token: 'expired', expires: now.getTime() - 1, next: 0, failures: 0 });
  assert.equal((await worker.runGolfBackgroundRefresh(now)).recovered, 1);
  now = new Date(now.getTime() + 300000); ownerLost = true;
  const outcome = await worker.runClaimedGolfSlate(1, {}, false, now);
  assert.equal(outcome.state, 'failed'); assert.match(outcome.error, /lease lost/); assert.equal(calls.length, 1);
  ownerLost = false; now = new Date(now.getTime() + 121000);
  hook = () => { leases.get(1).token = 'replacement'; };
  await assert.rejects(worker.runClaimedGolfSlate(1, {}, false, now), /lease completion failed/);
  assert.equal(leases.get(1).token, 'replacement');
});
test('errors are bounded, recorded, retryable, and isolated between Groups', async () => {
  reset(); db.slates.push(slate(2)); failIds.add(1);
  const first = await worker.runGolfBackgroundRefresh(now);
  assert.equal(first.status, 'partial_failure'); assert.equal(first.failed, 1); assert.equal(first.succeeded, 1);
  assert.ok(leases.get(1).error.length <= 400); assert.doesNotMatch(leases.get(1).error, /sensitive-value/);
  assert.equal(leases.get(1).next - now.getTime(), 120000);
  assert.equal((await worker.runGolfBackgroundRefresh(now)).processed, 0);
  failIds.clear(); now = new Date(now.getTime() + 121000);
  assert.equal((await worker.runGolfBackgroundRefresh(now)).succeeded, 1); assert.equal(leases.get(1).failures, 0);
});
test('waiting for an unpublished field records success without refreshed=true and waits an hour', async () => {
  reset(); resultOverride = { httpStatus: 502, error: 'ESPN returned the tournament, but the tournament field is not available yet.', tournament: { eventId: 'event-1', status: 'scheduled' } };
  const result = await worker.runGolfBackgroundRefresh(now);
  assert.equal(result.status, 'succeeded'); assert.equal(result.details[0].state, 'waiting_for_field'); assert.equal(result.details[0].refreshed, false);
  assert.equal(leases.get(1).next - now.getTime(), 3600000);
});
test('finalized/locked slate leaves background discovery; explicit historical lifecycle manual refresh remains available', async () => {
  reset(); resultOverride = { success: true, slateAutoLocked: true, tournament: { eventId: 'event-1', status: 'final' } };
  assert.equal((await worker.runGolfBackgroundRefresh(now)).succeeded, 1);
  assert.equal((await worker.runGolfBackgroundRefresh(now)).considered, 0);
  assert.equal((await worker.runClaimedGolfSlate(1, {}, true, now)).state, 'ineligible');
  assert.equal((await worker.runClaimedGolfSlate(1, { reconcileLockedLifecycle: true, scoreboardPayload: {} }, true, now)).state, 'succeeded');
});
test('start budget and item limit defer work; oldest/unattempted Group runs next', async () => {
  reset(); db.slates.push(slate(2), slate(3));
  const first = await worker.runGolfBackgroundRefresh(now);
  assert.equal(first.processed, 2); assert.equal(first.budgetStopped, true); assert.equal(first.eligible, 3);
  assert.equal((await worker.runGolfBackgroundRefresh(now)).processed, 1); assert.deepEqual(calls.map(c => c.id), [1, 2, 3]);
  reset(); db.slates.push(slate(2)); const original = Date.now; let wall = 0; Date.now = () => wall;
  hook = () => { wall = 31000; };
  try { assert.equal((await worker.runGolfBackgroundRefresh(now)).processed, 1); }
  finally { Date.now = original; }
});
test('idle and discovery failures finish durable history; retention failure is isolated; finish failure is visible', async () => {
  reset(); db.slates = []; assert.equal((await worker.runGolfBackgroundRefresh(now)).processed, 0); assert.equal(db.golf_sync_runs[0].status, 'succeeded');
  reset(); discoveryFails = true; assert.equal((await worker.runGolfBackgroundRefresh(now)).status, 'failed'); assert.equal(db.golf_sync_runs[0].details[0].state, 'discovery_failed');
  reset(); cleanupFails = true; assert.equal((await worker.runGolfBackgroundRefresh(now)).retentionCleanupFailed, true);
  reset(); finishFails = true; const result = await worker.runGolfBackgroundRefresh(now);
  assert.equal(result.status, 'partial_failure'); assert.match(result.details[0].error, /lease completion/); assert.ok(leases.get(1).token);
});
test('bounded skips retain aggregate counts and safe summaries', async () => {
  reset(); for (let id = 2; id <= 30; id++) db.slates.push(slate(id));
  for (let id = 1; id <= 30; id++) leases.set(id, { token: 'other', expires: now.getTime() + 300000, next: 0, failures: 0 });
  const result = await worker.runGolfBackgroundRefresh(now);
  assert.equal(result.leaseSkipped, 30); assert.equal(result.details.length, 21); assert.equal(result.details[20].count, 10);
});
test('cron uses only CRON_SECRET and fails closed before importing worker', async () => {
  const previous = process.env.CRON_SECRET, legacy = process.env.GOLF_CRON_SECRET;
  let imported = 0;
  const cron = load('app/api/cron/refresh-golf/route.ts', { '@/lib/golf/backgroundRefreshSafety': safety,
    '@/lib/golf/backgroundRefresh.server': { runGolfBackgroundRefresh: async () => { imported++; return { status: 'succeeded' }; } } });
  const request = secret => new Request('http://local/api/cron/refresh-golf', { headers: { authorization: `Bearer ${secret}` } });
  try {
    delete process.env.CRON_SECRET; assert.equal((await cron.GET(request('expected'))).status, 401);
    process.env.CRON_SECRET = 'expected'; process.env.GOLF_CRON_SECRET = 'old-secret';
    for (const secret of ['wrong', 'expected-too-long', 'old-secret']) assert.equal((await cron.GET(request(secret))).status, 401);
    assert.equal(imported, 0); assert.equal((await cron.GET(request('expected'))).status, 200); assert.equal(imported, 1);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
    if (legacy === undefined) delete process.env.GOLF_CRON_SECRET; else process.env.GOLF_CRON_SECRET = legacy;
  }
});
test('manual route rejects Group mismatch before worker and preserves supplied payload', async () => {
  let allowed = false, args;
  const route = load('app/api/refresh-stats-golf/route.ts', {
    '@/lib/security/resourceAuthorization': { authorizeSlateResource: async () => allowed ? { ok: true } : { ok: false, response: Response.json({ error: 'Group mismatch' }, { status: 404 }) } },
    '@/lib/golf/backgroundRefresh.server': { runClaimedGolfSlate: async (...input) => { args = input; return { state: 'succeeded', response: Response.json({ success: true }) }; } },
  });
  const request = () => new Request('http://local/api/refresh-stats-golf', { method: 'POST', body: JSON.stringify({ slateId: 2, scoreboardPayload: { event: 'event-2' }, observedAt: now.toISOString() }) });
  reset(); assert.equal((await route.POST(request())).status, 404); assert.equal(args, undefined);
  allowed = true; assert.equal((await route.POST(request())).status, 200); assert.equal(args[0], 2); assert.equal(args[1].scoreboardPayload.event, 'event-2'); assert.equal(args[2], true);
});
test('migration preserves atomic claim, service-only permissions, expiry, fenced finish and bounded retries/retention', () => {
  const sql = source('supabase/migrations/20261001000100_golf_background_refresh.sql');
  for (const pattern of [/on conflict \(slate_id\) do nothing/, /for update/, /lease_expires_at > v_now/, /interval '5 minutes'/, /lease_token = p_lease_token/, /p_allow_locked/, /archived_at is not null/,
    /greatest\(240, least\(21600/, /120 \* power\(2/, /interval '60 days'/, /limit 100/, /enable row level security/, /to service_role/]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /cron\.schedule\(/);
});
test('authoritative ingestion retains accepted reconciliation, Best Ball roster periods and stable round/final notification keys', () => {
  const refresh = source('lib/golf/refreshSlate.server.ts');
  for (const pattern of [/loadGolfRosters\(slateId, snapshot/, /relevantGolfRosterPeriodKey\(snapshot/, /reconcileGolf\(slateId/, /event_key_suffix:\s*`round-/, /fetchPgaTourTeeTimes/, /calculateGolfCutLine/, /await assertLease\(\)/]) assert.match(refresh, pattern);
  assert.match(source('lib/playerFinishedNotifications.ts'), /`player_finished:\$\{input\.slate\.id\}:\$\{stat\.player_id\}`/);
  assert.match(source('lib/slateCompleteNotifications.ts'), /`slate_complete:\$\{input\.slate\.id\}:\$\{teamId\}`/);
});
test('real notification logger suppresses duplicate event keys while distinct slate keys send independently', async () => {
  const seen = new Set(); let sends = 0;
  const notifications = load('lib/notifications.ts', {
    '@/lib/supabaseAdmin': { supabaseAdmin: { from: () => {
      let row;
      const q = { insert: input => { row = input; return q; }, select: () => q,
        single: async () => { if (seen.has(row.event_key)) return { data: null, error: { code: '23505' } }; seen.add(row.event_key); return { data: { id: 'history' }, error: null }; },
        update: () => q, eq: async () => ({ data: [], error: null }) };
      return q;
    } } },
    '@/lib/push': { sendPushToUser: async () => { sends++; return { sent: 1, failed: 0, skipped: false, devices: [] }; } },
  });
  const input = key => ({ eventKey: key, notificationType: 'player_finished', userId: 'user', slateId: 1, title: 'Round', body: 'Finished', url: '/', tag: key });
  const first = await notifications.sendLoggedNotification(input('player_finished:1:10:round-2'));
  const duplicate = await notifications.sendLoggedNotification(input('player_finished:1:10:round-2'));
  await notifications.sendLoggedNotification(input('player_finished:2:10:round-2'));
  await notifications.sendLoggedNotification(input('slate_complete:1:20'));
  assert.equal(first.sent, 1); assert.equal(duplicate.duplicate, true); assert.equal(sends, 3);
});
test('authoritative server ingestion selects the exact slate event/year and reconciles within that slate', async () => {
  reset();
  db.slates = [slate(1, { external_event_id: 'event-a', has_cut: false, rules_snapshot: null }), slate(2, { external_event_id: 'event-b', has_cut: false, rules_snapshot: null })];
  db.golf_event_players = [{ id: 101, slate_id: 1, player_id: 7 }, { id: 102, slate_id: 2, player_id: 7 }];
  const providerCalls = [], acceptedCalls = [], writes = [];
  const ingestionDb = { from: table => {
    const q = query(table);
    q.upsert = rows => { writes.push({ table, rows }); return q; };
    q.delete = () => { writes.push({ table, delete: true }); return q; };
    return q;
  } };
  const competitor = { espnPlayerId: 'p7', displayName: 'Golfer', status: 'scheduled', rounds: [], roundsCompleted: 0, holesCompleted: 0,
    currentRound: null, lastHole: null, teeTime: null, teeTimeRaw: null, officialScoreToPar: null, officialScoreDisplay: null, leaderboardOrder: 1 };
  const providers = {
    fetchGolfTournamentByEventId: async (eventId, year) => {
      providerCalls.push({ eventId, year });
      return { espnEventId: eventId, name: 'Tournament', startDate: '2026-09-24', endDate: '2026-09-27', status: 'scheduled', currentRound: 1, completed: false, competitors: [competitor] };
    }, fetchGolfCoursesByEventId: async () => [],
  };
  const ingestion = load('lib/golf/refreshSlate.server.ts', {
    'server-only': {}, '@/lib/supabaseAdmin': { supabaseAdmin: ingestionDb }, '@/lib/providers/golf': providers,
    '@/lib/providers/pgaTourShots': {}, '@/lib/providers/pgaTourTeeTimes': { resolvePgaTourTournament: async () => null },
    '@/lib/golf/holeAcceptance': {}, '@/lib/golf/fieldIdentityReconciliation': { reconcileGolfFieldIdentities: async () => ({ playerIdByEspnId: new Map([['p7', 7]]), counts: { retained: 1, resolved: 0, created: 0 } }) },
    '@/lib/scoring/golf': load('lib/scoring/golf.ts'), '@/lib/golf/cutLine': {},
    '@/lib/golf/fantasy.server': { loadGolfRosters: async () => [] }, '@/lib/golf/relevantRosterPeriod': { relevantGolfRosterPeriodKey: () => 'full_tournament' },
    '@/lib/golf/reconcileGolf': { reconcileGolf: async (id, batch) => { acceptedCalls.push({ id, batch }); return { revision: 1, teamWrites: [], teamRows: [], scoringChanged: false }; } },
    '@/lib/playerFinishedNotifications': { notifyNewlyFinishedPlayers: async () => ({ attempted: 0, sent: 0, failed: 0, skipped: 0 }) }, '@/lib/slateCompleteNotifications': {},
  });
  let checks = 0;
  for (const id of [1, 2]) {
    const response = await ingestion.refreshGolfSlate(id, {}, async () => { checks++; });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.tournament.eventId, `event-${id === 1 ? 'a' : 'b'}`);
  }
  assert.deepEqual(providerCalls, [{ eventId: 'event-a', year: '2026' }, { eventId: 'event-b', year: '2026' }]);
  assert.deepEqual(acceptedCalls.map(c => c.id), [1, 2]);
  assert.ok(acceptedCalls[0].batch.events.every(row => row.slate_id === 1));
  assert.ok(acceptedCalls[1].batch.events.every(row => row.slate_id === 2));
  assert.ok(checks >= 6);
  const before = writes.length;
  const lost = await ingestion.refreshGolfSlate(1, {}, async () => { throw new Error('lease lost'); });
  assert.equal(lost.status, 500); assert.equal(writes.length, before);
});
test('an HTTP scoring failure preserves the response, records its error and schedules retry', async () => {
  reset(); resultOverride = { httpStatus: 500, error: 'Accepted reconciliation unavailable', acceptedRevision: 9 };
  const result = await worker.runGolfBackgroundRefresh(now);
  assert.equal(result.failed, 1); assert.equal(result.details[0].refreshed, false);
  assert.match(leases.get(1).error, /reconciliation unavailable/); assert.equal(leases.get(1).next - now.getTime(), 120000);
  const manual = await worker.runClaimedGolfSlate(1, {}, true, now);
  assert.equal(manual.state, 'failed'); assert.equal(manual.response.status, 500);
  assert.equal((await manual.response.json()).acceptedRevision, 9);
});
