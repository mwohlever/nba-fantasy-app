/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const source = file => fs.readFileSync(file, 'utf8');
function load(file, mocks = {}, globals = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, process, Buffer, Response, Request, Date, AbortSignal, performance,
    console: { info() {}, error() {} }, require: name => name in mocks ? mocks[name] : require(name), ...globals });
  return loaded.exports;
}
const policy = load('lib/ncaaPickEm/backgroundPolicy.ts');
const safety = load('lib/ncaaPickEm/backgroundSafety.ts');
const week = (id = 1, overrides = {}) => ({ id, league_id: `league-${id}`, season: 2026, week_number: 4,
  status: 'locked', lock_at: '2026-09-24T23:00:00Z', ...overrides });
const game = (weekId = 1, overrides = {}) => ({ id: weekId * 10, week_id: weekId, espn_event_id: 'shared-event',
  kickoff_at: '2026-09-26T16:00:00Z', status: 'in', included: true, ...overrides });
let now, db, states, calls, failIds, gate, hook, discoveryFails, finishFails, pruneFails, runFinishFails, gamesReadFails, reminderFailures;
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now.getTime(); }
}
function reset() {
  now = new Date('2026-09-26T18:00:00Z'); db = { ncaa_pickem_weeks: [week()], ncaa_pickem_games: [game()], ncaa_pickem_sync_runs: [] };
  states = new Map(); calls = []; failIds = new Set(); gamesReadFails = new Set(); gate = hook = null;
  discoveryFails = finishFails = pruneFails = runFinishFails = false;
  reminderFailures = 0;
}
function query(table) {
  const filters = []; let insert, patch, take = Infinity;
  const result = () => {
    if (insert) { const row = { id: `run-${db[table].length + 1}`, ...insert }; db[table].push(row); insert = null; return { data: [row], error: null }; }
    const selected = (db[table] ?? []).filter(row => filters.every(f => f(row))).slice(0, take);
    if (table === 'ncaa_pickem_games' && selected.some(g => gamesReadFails.has(g.week_id))) return { data: null, error: { message: 'games offline' } };
    if (patch) {
      if (runFinishFails && table === 'ncaa_pickem_sync_runs') return { data: [], error: { message: 'history offline' } };
      selected.forEach(row => Object.assign(row, patch));
    }
    return { data: structuredClone(selected), error: null };
  };
  const q = { select: () => q, order: () => q, limit: n => { take = n; return q; },
    eq: (k, v) => { filters.push(row => row[k] === v); return q; },
    in: (k, v) => { filters.push(row => v.includes(row[k])); return q; },
    like: (k, pattern) => { filters.push(row => String(row[k]).startsWith(pattern.slice(0, -1))); return q; },
    not: (k, op, v) => { assert.equal(op, 'is'); filters.push(row => row[k] !== v); return q; },
    insert: row => { insert = row; return q; }, update: row => { patch = row; return q; },
    single: async () => { const r = result(); return { ...r, data: r.data[0] }; },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
}
const admin = { from: query, rpc: async (name, args) => {
  const ok = data => ({ data, error: null });
  if (name === 'prune_ncaa_pickem_sync_runs') return { data: 0, error: pruneFails ? { message: 'prune' } : null };
  if (name === 'discover_ncaa_pickem_work') {
    if (discoveryFails) return { data: null, error: { message: 'discovery' } };
    return ok(db.ncaa_pickem_weeks.filter(w => policy.ncaaWeekEligibility(w, db.ncaa_pickem_games.filter(g => g.week_id === w.id), args.p_task, now).eligible)
      .filter(w => (states.get(`${w.id}:${args.p_task}`)?.next ?? 0) <= +now)
      .sort((a, b) => (states.get(`${a.id}:${args.p_task}`)?.attempt ?? 0) - (states.get(`${b.id}:${args.p_task}`)?.attempt ?? 0) || a.id - b.id).slice(0, 100));
  }
  const key = `${args.p_week_id}:${args.p_task}`, state = states.get(key) ?? { token: null, expires: 0, next: 0, failures: 0 };
  if (name === 'claim_ncaa_pickem_sync') {
    const w = db.ncaa_pickem_weeks.find(w => w.id === args.p_week_id);
    if (!w || w.status === 'final' && !args.p_ignore_retry || args.p_task === 'reminders' && !policy.ncaaWeekEligibility(w, [], 'reminders', now).eligible)
      return ok({ state: 'ineligible' });
    if (state.token && state.expires > +now) return ok({ state: 'leased' });
    if (!args.p_ignore_retry && state.next > +now) return ok({ state: 'backoff' });
    const recovered = !!state.token; state.token = `token-${key}-${calls.length}`; state.expires = +now + 300000; state.attempt = +now; states.set(key, state);
    return ok({ state: 'claimed', token: state.token, recovered });
  }
  if (name === 'ncaa_pickem_sync_lease_owned') return ok(state.token === args.p_lease_token && state.expires > +now);
  assert.equal(name, 'finish_ncaa_pickem_sync');
  if (finishFails || state.token !== args.p_lease_token || state.expires <= +now) return ok(false);
  state.token = null; state.expires = 0; state.summary = args.p_summary;
  state.failures = args.p_succeeded ? 0 : state.failures + 1;
  state.error = args.p_error;
  state.next = +now + (args.p_succeeded ? args.p_delay_seconds * 1000 : Math.min(21600000, 120000 * 2 ** (state.failures - 1)));
  return ok(true);
} };
const refresh = { refreshNcaaWeek: async (id, token) => {
  calls.push({ id, token, task: 'results' }); if (hook) hook(id); if (gate) await gate;
  if (failIds.has(id)) throw new Error(`ESPN failed Bearer private-secret ${'x'.repeat(500)}`);
  return { success: true, weekId: id, gradedPicks: 1, weekStatus: db.ncaa_pickem_weeks.find(w => w.id === id).status };
} };
const reminderMock = { remindNcaaWeek: async (id, token, owned) => {
  await owned(); calls.push({ id, token, task: 'reminders' }); return { remindersSent: 1, notificationsFailed: reminderFailures };
} };
const worker = load('lib/ncaaPickEm/backgroundWorker.server.ts', {
  'server-only': {}, '@/lib/supabaseAdmin': { supabaseAdmin: admin }, './refreshWeek.server': refresh, './reminders.server': reminderMock,
  './backgroundPolicy': policy, './backgroundSafety': safety,
}, { Date: Clock });

test('results eligibility keeps locked/postponed catch-up, rejects final/far-future/empty invalid weeks', () => {
  reset();
  assert.equal(policy.ncaaWeekEligibility(week(), [game()], 'results', now).eligible, true);
  assert.equal(policy.ncaaWeekEligibility(week(1, { status: 'open', lock_at: now.toISOString() }), [], 'results', now).eligible, true);
  for (const w of [week(1, { status: 'final' }), week(1, { league_id: '' }), week(1, { season: NaN })])
    assert.equal(policy.ncaaWeekEligibility(w, [game()], 'results', now).eligible, false);
  const open = week(1, { status: 'open', lock_at: null });
  assert.equal(policy.ncaaWeekEligibility(open, [], 'results', now).eligible, false);
  assert.equal(policy.ncaaWeekEligibility(open, [game(1, { kickoff_at: '2026-10-20T00:00Z' })], 'results', now).eligible, false);
});
test('cadence: live and lock approach 4 min; tomorrow hourly; early and stale six-hour polling', () => {
  reset();
  assert.equal(policy.ncaaRefreshDelaySeconds(week(), [game()], now), 240);
  assert.equal(policy.ncaaRefreshDelaySeconds(week(1, { status: 'open', lock_at: '2026-09-26T18:30Z' }), [], now), 240);
  assert.equal(policy.ncaaRefreshDelaySeconds(week(), [game(1, { status: 'pre', kickoff_at: '2026-09-27T12:00Z' })], now), 3600);
  for (const date of ['2026-09-20T00:00Z', '2026-10-01T00:00Z'])
    assert.equal(policy.ncaaRefreshDelaySeconds(week(), [game(1, { status: 'pre', kickoff_at: date })], now), 21600);
});
test('unattended execution isolates Group weeks sharing ESPN identity and records durable success/no-op history', async () => {
  reset(); db.ncaa_pickem_weeks.push(week(2), week(3, { status: 'final' })); db.ncaa_pickem_games.push(game(2), game(3));
  const first = await worker.runNcaaWorker('results', { now });
  assert.equal(first.succeeded, 2); assert.deepEqual(calls.map(c => c.id), [1, 2]);
  assert.deepEqual(Array.from(first.details, d => d.leagueId), ['league-1', 'league-2']);
  assert.equal((await worker.runNcaaWorker('results', { now })).processed, 0);
  assert.equal(db.ncaa_pickem_sync_runs.length, 2); assert.equal(db.ncaa_pickem_sync_runs[1].status, 'succeeded');
});
test('concurrent manual/cron work shares a lease; manual bypasses due time but never a live lease', async () => {
  reset(); let release; gate = new Promise(resolve => { release = resolve; });
  const pending = worker.runNcaaWorker('results', { weekId: 1, now });
  await new Promise(resolve => setImmediate(resolve));
  const overlap = await worker.runNcaaWorker('results', { now });
  assert.equal(overlap.leaseSkipped, 1); assert.equal(calls.length, 1);
  release(); await pending; gate = null;
  assert.equal((await worker.runClaimedNcaaWeek(1, 'results', false, now)).state, 'backoff');
  assert.equal((await worker.runNcaaWorker('results', { weekId: 1, now })).succeeded, 1);
  assert.equal(db.ncaa_pickem_sync_runs[0].source, 'manual');
});
test('expired lease recovers, failures record redacted errors/backoff and retry resets failures', async () => {
  reset(); states.set('1:results', { token: 'expired', expires: +now - 1, next: 0, failures: 0 }); failIds.add(1);
  const first = await worker.runNcaaWorker('results', { now });
  assert.equal(first.recovered, 1); assert.equal(first.status, 'partial_failure');
  const state = states.get('1:results'); assert.equal(state.next - +now, 120000);
  assert.ok(state.error.length <= 400); assert.doesNotMatch(state.error, /private-secret/);
  now = new Date(+now + 121000); await worker.runNcaaWorker('results', { now });
  assert.equal(state.next - +now, 240000);
  failIds.clear(); now = new Date(+now + 241000);
  assert.equal((await worker.runNcaaWorker('results', { now })).succeeded, 1); assert.equal(state.failures, 0);
});
test('failure isolation, bounded processing, fair next pass, explicit final manual refresh', async () => {
  reset(); db.ncaa_pickem_weeks.push(week(2), week(3), week(4, { status: 'final' })); db.ncaa_pickem_games.push(game(2), game(3), game(4));
  failIds.add(1); const first = await worker.runNcaaWorker('results', { now });
  assert.equal(first.failed, 1); assert.equal(first.succeeded, 1); assert.equal(first.budgetStopped, true);
  assert.equal((await worker.runNcaaWorker('results', { now })).succeeded, 1); assert.equal(calls[2].id, 3);
  assert.equal((await worker.runNcaaWorker('results', { weekId: 4, now })).succeeded, 1);
  assert.equal(db.ncaa_pickem_weeks[3].status, 'final');
});
test('a Group eligibility read failure records retry state without preventing another Group refresh', async () => {
  reset(); db.ncaa_pickem_weeks.push(week(2)); db.ncaa_pickem_games.push(game(2)); gamesReadFails.add(1);
  const result = await worker.runNcaaWorker('results', { now });
  assert.equal(result.failed, 1); assert.equal(result.succeeded, 1); assert.deepEqual(calls.map(c => c.id), [2]);
  assert.equal(states.get('1:results').failures, 1); assert.ok(states.get('1:results').next > +now);
});
test('worker stops starting further weeks after its wall-clock budget', async () => {
  reset(); db.ncaa_pickem_weeks.push(week(2)); db.ncaa_pickem_games.push(game(2));
  hook = () => { now = new Date(+now + 31000); };
  const result = await worker.runNcaaWorker('results', { now });
  assert.equal(result.processed, 1); assert.equal(result.budgetStopped, true); assert.deepEqual(calls.map(c => c.id), [1]);
});
test('discovery/history/completion errors remain visible; failed retention does not fail scoring', async () => {
  reset(); discoveryFails = true; const result = await worker.runNcaaWorker('results', { now });
  assert.equal(result.status, 'failed'); assert.equal(db.ncaa_pickem_sync_runs[0].status, 'failed');
  reset(); pruneFails = true; assert.equal((await worker.runNcaaWorker('results', { now })).retentionCleanupFailed, true);
  reset(); finishFails = true; assert.equal((await worker.runNcaaWorker('results', { now })).failed, 1);
  assert.ok(states.get('1:results').token);
  reset(); hook = () => { states.get('1:results').token = 'replacement'; };
  assert.equal((await worker.runNcaaWorker('results', { now })).failed, 1); assert.equal(states.get('1:results').token, 'replacement');
  reset(); runFinishFails = true; await assert.rejects(worker.runNcaaWorker('results', { now }), /history update/);
});
test('reminders have independent state, exclude locked/final/deadline weeks and never fetch ESPN', async () => {
  reset(); db.ncaa_pickem_weeks.push(week(2, { status: 'open', lock_at: '2026-09-27T18:00Z' }), week(3, { status: 'final' }));
  assert.equal(policy.ncaaWeekEligibility(week(2, { status: 'open', lock_at: now.toISOString() }), [], 'reminders', now).eligible, false);
  const result = await worker.runNcaaWorker('reminders', { now });
  assert.equal(result.succeeded, 1); assert.deepEqual(calls.map(c => [c.id, c.task]), [[2, 'reminders']]);
  assert.equal(states.has('2:results'), false);
});
test('reminder delivery failures record counts/backoff without changing results state', async () => {
  reset(); db.ncaa_pickem_weeks = [week(1, { status: 'open', lock_at: '2026-09-27T18:00Z' })]; reminderFailures = 1;
  const result = await worker.runNcaaWorker('reminders', { now });
  assert.equal(result.failed, 1); assert.equal(states.get('1:reminders').summary.notificationsFailed, 1);
  assert.match(states.get('1:reminders').error, /event keys retained/); assert.equal(states.has('1:results'), false);
});
test('cron authorization fails closed before worker access and preserves both server secrets', async () => {
  const before = [process.env.CRON_SECRET, process.env.GOLF_CRON_SECRET]; let entered = 0;
  try {
    for (const file of ['app/api/cron/refresh-ncaa/route.ts', 'app/api/cron/ncaa-pickem-reminders/route.ts']) {
      const cron = load(file, { '@/lib/ncaaPickEm/backgroundSafety': safety,
        '@/lib/ncaaPickEm/backgroundWorker.server': { runNcaaWorker: async () => { entered++; return { success: true }; } } });
      const req = secret => new Request('http://local', { headers: { authorization: `Bearer ${secret}` } });
      delete process.env.CRON_SECRET; delete process.env.GOLF_CRON_SECRET;
      assert.equal((await cron.GET(req(''))).status, 401);
      process.env.CRON_SECRET = 'new'; process.env.GOLF_CRON_SECRET = 'legacy';
      assert.equal((await cron.GET(req('new-too-long'))).status, 401);
      assert.equal((await cron.GET(req('new'))).status, 200);
      assert.equal((await cron.GET(req('legacy'))).status, 200);
    }
    assert.equal(entered, 4);
  } finally {
    for (const [key, value] of [['CRON_SECRET', before[0]], ['GOLF_CRON_SECRET', before[1]]])
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
test('manual authorization rejects foreign Group before worker import and retains the successful response fields', async () => {
  let allowed = false, calls = 0;
  const route = load('app/api/refresh-stats-ncaa/route.ts', {
    '@/lib/security/resourceAuthorization': { authorizeNcaaWeekResource: async () => allowed ? { ok: true } : { ok: false, response: Response.json({}, { status: 404 }) } },
    '@/lib/ncaaPickEm/backgroundSafety': safety,
    '@/lib/ncaaPickEm/backgroundWorker.server': { runNcaaWorker: async (task, options) => {
      calls++; assert.equal(task, 'results'); assert.equal(options.weekId, 2);
      return { success: true, runId: 'run', details: [{ weekId: 2, state: 'succeeded', summary: { success: true, gradedPicks: 4 } }] };
    } },
  });
  const request = () => new Request('http://local', { method: 'POST', body: JSON.stringify({ weekId: 2 }) });
  assert.equal((await route.POST(request())).status, 404); assert.equal(calls, 0);
  allowed = true; assert.equal((await (await route.POST(request())).json()).gradedPicks, 4);
});
test('authoritative ingestion uses exact Group week and passes mapping into atomic RPC with bounded provider requests', async () => {
  reset(); db.ncaa_pickem_weeks.push(week(2)); db.ncaa_pickem_games.push(game(2));
  const requested = [], applied = [];
  const ingestion = load('lib/ncaaPickEm/refreshWeek.server.ts', {
    'server-only': {}, '@/lib/supabaseAdmin': { supabaseAdmin: { from: query, rpc: async (name, args) => {
      assert.equal(name, 'apply_ncaa_pickem_results'); applied.push(args); return { data: { gradedPicks: 1 }, error: null };
    } } },
    '@/lib/providers/ncaa': { fetchNcaaPickEmWeek: async input => {
      requested.push(input); return { scheduleGames: [{ espnEventId: 'shared-event', kickoffAt: game().kickoff_at, status: 'post', completed: true, winnerTeamId: 'home',
        awayTeam: { id: 'away', displayName: 'Away', score: 10 }, homeTeam: { id: 'home', displayName: 'Home', score: 20 } }] };
    } }, './odds': load('lib/ncaaPickEm/odds.ts'),
  });
  await ingestion.refreshNcaaWeek(2, 'owned-token');
  assert.equal(requested[0].season, 2026); assert.equal(requested[0].week, 4); assert.ok(requested[0].signal);
  assert.equal(applied[0].p_week_id, 2); assert.equal(applied[0].p_lease_token, 'owned-token');
  assert.equal(applied[0].p_games.length, 1); assert.equal(applied[0].p_games[0].completed, true);
});
test('reminder rules preserve missing picks, preferences, templates, event keys and Group-only recipients', async () => {
  reset(); db.ncaa_pickem_weeks = [week(1, { status: 'open', label: 'Week 4', lock_at: '2026-09-27T18:00Z' })];
  db.leagues = [{ id: 'league-1', group_id: 'group-1' }];
  db.app_users = [1, 2, 3].map(id => ({ id: `user-${id}`, display_name: `Player ${id}`, is_active: true }));
  db.notification_preferences = [{ user_id: 'user-2', pickem_reminder_enabled: false }];
  db.ncaa_pickem_picks = [{ week_id: 1, game_id: 10, team_id: 3 }];
  const sent = [], events = new Set(); let enabled = true;
  const reminders = load('lib/ncaaPickEm/reminders.server.ts', {
    'server-only': {}, '@/lib/supabaseAdmin': { supabaseAdmin: { from: query, rpc: async (name, args) => {
      assert.equal(name, 'reserve_ncaa_pickem_reminder'); const key = `${args.p_week_id}:${args.p_user_id}`;
      if (events.has(key)) return { data: 'duplicate', error: null };
      events.add(key); (db.ncaa_pickem_reminder_events ??= []).push({ week_id: args.p_week_id, event_key: `ncaa_pickem_lock_reminder:${key}` });
      return { data: 'reserved', error: null };
    } } },
    './access': { loadNcaaPickEmParticipants: async groupId => {
      assert.equal(groupId, 'group-1'); return [1, 2, 3].map(id => ({ teamId: id, userId: `user-${id}` }));
    } },
    '@/lib/notifications': { sendLoggedNotification: async input => { sent.push(input); return { sent: 1, failed: 0 }; } },
    '@/lib/ncaaPickEmNotificationSettings': { getNcaaPickEmNotificationSettings: async id => {
      assert.equal(id, 'league-1'); return { enabled, reminderHours: 24, titleTemplate: '{teamName}', bodyTemplate: '{missingPicks}' };
    }, renderNcaaPickEmNotificationTemplate: (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]) },
  }, { Date: Clock });
  const first = await reminders.remindNcaaWeek(1, 'token', async () => {}, now);
  assert.equal(first.remindersSent, 1); assert.equal(first.remindersSkipped, 2);
  assert.equal(sent[0].eventKey, 'ncaa_pickem_lock_reminder:1:user-1'); assert.equal(sent[0].leagueId, 'league-1'); assert.equal(sent[0].title, 'Player 1');
  assert.equal((await reminders.remindNcaaWeek(1, 'token', async () => {}, now)).duplicateEvents, 1); assert.equal(sent.length, 1);
  enabled = false; await reminders.remindNcaaWeek(1, 'token', async () => {}, now); assert.equal(sent.length, 1);
});

test('reminder batches advance past reserved recipients, preserve narrower league windows and stop on lease loss', async () => {
  reset(); db.ncaa_pickem_weeks = [week(1, { status: 'open', label: 'Week 4', lock_at: '2026-09-27T18:00Z' })];
  db.leagues = [{ id: 'league-1', group_id: 'group-1' }]; db.notification_preferences = []; db.ncaa_pickem_picks = [];
  const participants = Array.from({ length: 30 }, (_, index) => ({ teamId: index + 1, userId: `user-${index + 1}` }));
  db.app_users = participants.map(team => ({ id: team.userId, display_name: team.userId, is_active: true }));
  let hours = 1, sends = 0, reservationCalls = 0; const reserved = new Set();
  const reminders = load('lib/ncaaPickEm/reminders.server.ts', {
    'server-only': {}, '@/lib/supabaseAdmin': { supabaseAdmin: { from: query, rpc: async (name, args) => {
      assert.equal(name, 'reserve_ncaa_pickem_reminder');
      reservationCalls++;
      if (reserved.has(args.p_user_id)) return { data: 'duplicate', error: null };
      reserved.add(args.p_user_id); (db.ncaa_pickem_reminder_events ??= []).push({ week_id: args.p_week_id, event_key: `ncaa_pickem_lock_reminder:${args.p_week_id}:${args.p_user_id}` });
      return { data: 'reserved', error: null };
    } } },
    './access': { loadNcaaPickEmParticipants: async () => participants },
    '@/lib/ncaaPickEmNotificationSettings': { getNcaaPickEmNotificationSettings: async () => ({ enabled: true, reminderHours: hours, titleTemplate: 'T', bodyTemplate: 'B' }),
      renderNcaaPickEmNotificationTemplate: template => template },
    '@/lib/notifications': { sendLoggedNotification: async () => { sends++; return { sent: 1, failed: 0 }; } },
  }, { Date: Clock });
  assert.equal((await reminders.remindNcaaWeek(1, 'token', async () => {}, now)).remindersSent, 0);
  hours = 24;
  const first = await reminders.remindNcaaWeek(1, 'token', async () => {}, now);
  assert.equal(first.remindersSent, 25); assert.equal(first.deferred, true);
  const second = await reminders.remindNcaaWeek(1, 'token', async () => {}, now);
  assert.equal(second.remindersSent, 5); assert.equal(second.duplicateEvents, 25); assert.equal(sends, 30);
  assert.equal(reservationCalls, 30);
  reserved.clear(); db.ncaa_pickem_reminder_events = [];
  await assert.rejects(reminders.remindNcaaWeek(1, 'token', async () => { throw new Error('lease lost'); }, now), /lease lost/);
  assert.equal(sends, 30);
});
