/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, before } = require('node:test');
const ts = require('typescript');
let skinsProvider;
before(async () => { skinsProvider = await import('../lib/providers/nbaSkinsRecords.mjs'); });
const source = file => fs.readFileSync(file, 'utf8');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const loaded = { exports: {} }; cache.set(file, loaded.exports);
    vm.runInNewContext(ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module: loaded, exports: loaded.exports, process, Buffer, Response, Request, AbortSignal, Date, performance, URL, structuredClone,
      console: { info() {}, warn() {}, error() {} }, fetch: (...args) => global.fetch(...args),
      require(name) {
        if (name in mocks) return mocks[name];
        if (name === 'server-only') return {};
        if (name === '@/lib/providers/nbaSkinsRecords.mjs') return skinsProvider;
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(`${path.join(path.dirname(file), name)}.ts`);
        return require(name);
      },
    }, { filename: file });
    return loaded.exports;
  }
  return load;
}
const at = new Date('2026-10-21T00:00:00Z');
const game = (status = 2, overrides = {}) => ({ gameId: '0022600001', gameCode: '20261020/LALBOS', gameStatus: status,
  gameStatusText: status === 3 ? 'Final' : status === 2 ? 'Halftime' : 'Scheduled', gameDateTimeUTC: '2026-10-20T23:00:00Z',
  homeTeam: { teamTricode: 'BOS' }, awayTeam: { teamTricode: 'LAL' }, ...overrides });
const player = (personId, points = 10) => ({ personId, statistics: { points, reboundsTotal: 2, assists: 1, steals: 1, blocks: 1, turnovers: 1 } });
const box = (status = 2, id = '0022600001') => ({ game: { gameId: id, gameStatus: status, gameStatusText: status === 3 ? 'Final' : 'Halftime', period: 2, gameClock: 'PT00M00.00S',
  homeTeam: { teamTricode: 'BOS', players: Array.from({ length: 5 }, (_, i) => player(i + 42)) },
  awayTeam: { teamTricode: 'LAL', players: Array.from({ length: 5 }, (_, i) => player(i + 100)) } } });
const codes = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'];
function recordsPayload(wins = 1, losses = 0) { return { season: { year: 2027 }, children: [{ standings: { season: 2027, seasonType: 2, entries: codes.map((code, i) => ({ team: { id: String(i+1), abbreviation: code, displayName: code }, stats: [{ name: 'wins', value: wins }, { name: 'losses', value: losses }] })) } }] }; }
function projectionHtml() { return JSON.stringify({ selected: { league: 'nba', season: 2027, column: 'projections.projectedw' }, table: { stats: codes.map(code => ({ team: { abbrev: code }, stats: [{ name: 'projectedw', value: '41.0-41.0' }] })) } }); }
function context(id = 1, overrides = {}) { return { slate: { id, league_id: `league-${id}`, sport: 'nba', date: '2026-10-20', start_date: '2026-10-20', end_date: '2026-10-20',
  is_locked: false, archived_at: null, first_game_start_time: '2026-10-20T23:00:00Z', nba_team_abbreviations: ['BOS'], rules_snapshot: null, ...overrides },
  players: [{ id: 10, name: 'Player', nba_player_id: 42, team_abbreviation: 'BOS' }],
  lineups: [{ id: id * 10, team_id: id * 100, lineup_players: [{ player_id: 10 }] }], pins: [], previous: [] }; }
function fixture() {
  const contexts = new Map([[1, context()]]), leases = new Map(), runs = [], applies = [], rpcCalls = [];
  let claimCount = 0;
  const seasons = [{ id: 11, league_id: 'skins-a', season: 2026, status: 'locked', participant_count: 4, nba_teams_per_participant: 7 }];
  const candidates = { fantasy: [{ task: 'fantasy', target_id: 1, league_id: 'league-1', group_id: 'group-1' }], skins: [{ task: 'skins', target_id: 11, league_id: 'skins-a', group_id: 'skins-group' }] };
  const admin = { from(table) {
    let inserted, patch, target, single = false;
    const q = { select: () => q, eq: (key, value) => { target = value; return q; }, insert: value => { inserted = value; return q; }, update: value => { patch = value; return q; },
      single: () => { single = true; return q; }, then(resolve, reject) {
        let data;
        if (inserted) { data = { id: `run-${runs.length}`, ...inserted }; runs.push(data); }
        else if (patch) { const row = runs.find(row => row.id === target); Object.assign(row, patch); data = [{ id: target }]; }
        else data = table === 'nba_skins_seasons' ? seasons.filter(s => s.id === target) : [];
        return Promise.resolve({ data: single && Array.isArray(data) ? data[0] : data, error: null }).then(resolve, reject);
      } }; return q;
    }, async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'discover_nba_work') return { data: candidates[args.p_task], error: null };
      if (name === 'prune_nba_sync_runs') return { data: 0, error: null };
      if (name === 'load_nba_fantasy_context') return { data: structuredClone(contexts.get(args.p_slate_id)), error: null };
      const key = `${args.p_task ?? (name === 'apply_nba_skins' ? 'skins' : 'fantasy')}:${args.p_target_id ?? args.p_slate_id ?? args.p_season_id}`;
      const state = leases.get(key) ?? { token: null, summary: {}, pending: null, failures: 0, next: 0, expires: 0 };
      if (name === 'claim_nba_sync') {
        if (state.token && state.expires > at.getTime()) return { data: { state: 'leased' }, error: null };
        if (!args.p_manual && state.next > at.getTime()) return { data: { state: 'backoff' }, error: null };
        const recovered = Boolean(state.token); state.token = `token-${++claimCount}`; state.expires = at.getTime()+300000; leases.set(key, state);
        return { data: { state: 'claimed', token: state.token, recovered, summary: structuredClone(state.summary), pending: structuredClone(state.pending) }, error: null };
      }
      if (state.token !== args.p_token) return { data: false, error: null };
      if (name === 'apply_nba_fantasy') { applies.push(args); state.pending = args.p_notifications; const ctx = contexts.get(args.p_slate_id); ctx.previous = args.p_players; ctx.slate.is_locked = args.p_final; return { data: true, error: null }; }
      if (name === 'apply_nba_skins') { applies.push(args); return { data: { picksUpdated: 28 }, error: null }; }
      if (name === 'ack_nba_notifications') state.pending = null;
      if (name === 'finish_nba_sync') {
        Object.assign(state.summary, args.p_summary); state.token = null;
        state.failures = args.p_success ? 0 : state.failures + 1;
        state.next = at.getTime() + (args.p_success ? args.p_delay : Math.min(21600, 120*2**(state.failures-1))) * 1000;
      }
      return { data: true, error: null };
    } };
  return { contexts, leases, runs, applies, rpcCalls, seasons, candidates, admin };
}
function app(f, notificationOverrides = {}) {
  return loader({ '@/lib/supabaseAdmin': { supabaseAdmin: f.admin },
    '@/lib/playerFinishedNotifications': { notifyNewlyFinishedPlayers: async () => ({ attempted: 0, sent: 0, skipped: 0, failed: 0 }), ...notificationOverrides },
    '@/lib/slateCompleteNotifications': { notifyCompletedSlate: async () => ({ attempted: 0, sent: 0, skipped: 0, failed: 0 }) },
  });
}
async function withProvider(fn, options = {}) {
  const previous = global.fetch, calls = [];
  global.fetch = async url => {
    url = String(url); calls.push(url);
    if (options.fail?.(url)) return { ok: false, status: 503 };
    return { ok: true, json: async () => url.includes('scheduleLeague') ? { leagueSchedule: { gameDates: [{ games: options.games ?? [game()] }] } }
      : url.includes('boxscore') ? options.box ?? box() : url.includes('scoreboard') ? { scoreboard: { games: [game()] } } : options.records ?? recordsPayload(),
      text: async () => projectionHtml() };
  };
  try { return await fn(calls); } finally { global.fetch = previous; }
}

test('NBA invocation memoizes immutable schedule, scoreboard, game boxscore, standings and BPI promises', async () => {
  const { NbaProvider } = loader()('lib/nba/provider.ts');
  await withProvider(async calls => {
    const provider = new NbaProvider();
    const [first, second] = await Promise.all([provider.schedule(), provider.schedule()]);
    assert.equal(first, second); assert.ok(Object.isFrozen(first[0]));
    await Promise.all([provider.scoreboard(), provider.scoreboard(), provider.box(first[0]), provider.box(first[0]), provider.standings(2026), provider.standings(2026), provider.projections(2026), provider.projections(2026)]);
    assert.equal(calls.length, 5); assert.equal(provider.requests, 5);
    const snapshot = await provider.box(first[0]); assert.ok(Object.isFrozen(snapshot.players[0].stats));
  });
});
test('cached provider failures do not duplicate requests and invalid / partial responses are rejected', async () => {
  const { NbaProvider, normalizeNbaBox, normalizeNbaScheduleGame } = loader()('lib/nba/provider.ts');
  const expected = normalizeNbaScheduleGame(game());
  for (const malformed of [{}, { game: { ...box().game, homeTeam: { teamTricode: 'BOS', players: [] } } },
    { game: { ...box().game, gameId: '0022600099' } }, { game: { ...box().game, homeTeam: { teamTricode: 'BOS', players: [player(42)] } } }]) {
    assert.throws(() => normalizeNbaBox(malformed, expected));
  }
  const badStat = box(); delete badStat.game.homeTeam.players[0].statistics.assists;
  assert.throws(() => normalizeNbaBox(badStat, expected), /invalid_stat/);
  const canceled = box(3); canceled.game.gameStatusText = 'Canceled'; assert.throws(() => normalizeNbaBox(canceled, expected), /unresolved/);
  await withProvider(async calls => {
    const provider = new NbaProvider();
    const results = await Promise.allSettled([provider.schedule(), provider.schedule()]);
    assert.ok(results.every(result => result.status === 'rejected')); assert.equal(calls.length, 1);
  }, { fail: () => true });
  await withProvider(async () => { await assert.rejects(loader()('lib/nba/provider.ts').NbaProvider.prototype.standings.call(new NbaProvider(), 2026)); }, { records: { children: [] } });
});
test('Fantasy tip/live/halftime/final policy preserves server end-day boundaries', () => {
  const load = loader(), policy = load('lib/nba/backgroundPolicy.ts'), normalize = load('lib/nba/provider.ts').normalizeNbaScheduleGame;
  const scheduled = normalize(game(1, { gameDateTimeUTC: '2026-10-21T23:00:00Z', gameCode: '20261021/LALBOS' }));
  assert.equal(policy.fantasyPollPolicy([scheduled], '2026-10-21', at).process, false);
  assert.equal(policy.fantasyPollPolicy([scheduled], '2026-10-21', new Date('2026-10-21T22:31Z')).process, true);
  assert.equal(policy.fantasyPollPolicy([normalize(game())], '2026-10-20', at).delaySeconds, 240);
  assert.equal(policy.nbaSlateEndPassed('2026-10-20', new Date('2026-10-20T23:59:58')), false);
  assert.equal(policy.nbaSlateEndPassed('2026-10-20', new Date('2026-10-21T00:01')), true);
  assert.equal(policy.fantasyPollPolicy([], '2026-10-20', at).process, false);
  assert.equal(policy.skinsPollDelay(2026, at), 240);
  assert.equal(policy.skinsPollDelay(2026, new Date('2026-10-21T14:00Z')), 3600);
  assert.equal(policy.skinsPollDelay(2026, new Date('2026-09-28T14:00Z')), 21600);
  assert.equal(policy.skinsPollDelay(2026, at, true), 86400);
});
test('whole-slate Fantasy scoring is idempotent, follows frozen scoring, and independently sums multi-day games', () => {
  const load = loader(), { scoreNbaFantasy } = load('lib/nba/fantasyScoring.ts'), { normalizeNbaBox, normalizeNbaScheduleGame } = load('lib/nba/provider.ts');
  const first = normalizeNbaScheduleGame(game(3)), last = normalizeNbaScheduleGame(game(2, { gameId: '0022600002', gameCode: '20261021/LALBOS' }));
  const boxes = new Map([[first.gameId, normalizeNbaBox(box(3), first)], [last.gameId, normalizeNbaBox(box(2, last.gameId), last)]]);
  const ctx = context(1, { end_date: '2026-10-21', rules_snapshot: { scoring: { points: 2 } } });
  const a = scoreNbaFantasy(ctx, [first, last], boxes); ctx.previous = a.rows;
  const b = scoreNbaFantasy(ctx, [first, last], boxes);
  assert.deepEqual(a.rows, b.rows); assert.equal(b.rows[0].fantasy_points, 53.8); assert.equal(b.teams[0].games_completed, 1); assert.equal(b.allFinal, false);
  const legacy = context(); assert.equal(scoreNbaFantasy(legacy, [first], boxes).rows[0].fantasy_points, 16.9);
  assert.throws(() => scoreNbaFantasy(ctx, [last], boxes), /regression/);
});
test('two Fantasy Groups and two Skins Groups reuse exact inputs while committing distinct identities', async () => {
  const f = fixture(); f.contexts.set(2, context(2, { rules_snapshot: { scoring: { points: 2 } } }));
  f.candidates.fantasy.push({ task: 'fantasy', target_id: 2, league_id: 'league-2', group_id: 'group-2' });
  f.seasons.push({ ...f.seasons[0], id: 12, league_id: 'skins-b' }); f.candidates.skins.push({ task: 'skins', target_id: 12, league_id: 'skins-b', group_id: 'skins-other' });
  await withProvider(async calls => {
    const result = await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at });
    assert.equal(result.succeeded, 4); assert.equal(calls.length, 4);
    const fantasy = f.applies.filter(row => row.p_slate_id); assert.equal(fantasy[0].p_players[0].fantasy_points, 16.9); assert.equal(fantasy[1].p_players[0].fantasy_points, 26.9);
    assert.deepEqual(f.applies.filter(row => row.p_season_id).map(row => row.p_season_id).sort(), [11,12]);
    assert.equal(f.runs[0].status, 'succeeded'); assert.equal(f.runs[0].provider_counts.nba_boxscore, 1);
  });
});
test('Fantasy provider failure does not block Skins; Skins standings failure does not block Fantasy', async () => {
  for (const failedSource of ['boxscore', '/standings']) {
    const f = fixture();
    await withProvider(async () => {
      const result = await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at });
      assert.equal(result.status, 'partial_failure'); assert.equal(result.succeeded, 1); assert.equal(result.failed, 1);
      assert.equal(f.applies.length, 1); assert.equal(Boolean(f.applies[0].p_slate_id), failedSource === '/standings');
      assert.ok(f.rpcCalls.some(call => call.name === 'finish_nba_sync' && call.args.p_success === false));
    }, { fail: url => url.includes(failedSource) });
  }
});
test('partial box score prevents all Fantasy writes and finalization; invalid standings prevent all Skins writes', async () => {
  const f = fixture(); const partial = box(3); partial.game.awayTeam.players = [];
  await withProvider(async () => {
    const result = await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at });
    assert.equal(result.succeeded, 0); assert.equal(f.applies.length, 0); assert.equal(f.contexts.get(1).slate.is_locked, false);
  }, { box: partial, records: { children: [] } });
});
test('scheduled Fantasy work backs off without a boxscore or scoring mutation; a leased item performs no retrieval', async () => {
  const f = fixture(); f.candidates.skins = [];
  await withProvider(async calls => {
    const worker = app(f)('lib/nba/backgroundWorker.server.ts');
    const result = await worker.runNbaWorker({ now: at }); assert.equal(result.succeeded, 1); assert.equal(calls.length, 1); assert.equal(f.applies.length, 0);
    assert.ok(f.leases.get('fantasy:1').next > at.getTime());
    const next = await worker.runNbaWorker({ now: at }); assert.equal(next.details[0].state, 'backoff'); assert.equal(calls.length, 1);
    f.leases.get('fantasy:1').token = 'held'; f.leases.get('fantasy:1').expires = at.getTime()+1000;
    const manual = await worker.runNbaWorker({ manualWork: f.candidates.fantasy[0], now: at }); assert.equal(manual.details[0].state, 'leased'); assert.equal(calls.length, 1);
  }, { games: [game(1, { gameDateTimeUTC: '2026-10-22T23:00:00Z' })] });
});
test('final Fantasy games lock only after the slate end day; historical locked state is protected by the database claim', async () => {
  for (const now of [new Date('2026-10-20T23:59:58'), new Date('2026-10-21T00:01')]) {
    const f = fixture(); f.candidates.skins = [];
    f.contexts.get(1).pins = [{game_id:'0022600001',game_code:'20261020/LALBOS',game_date:'2026-10-20'}];
    await withProvider(async () => {
      const result = await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now });
      assert.equal(result.success, true); assert.equal(f.applies[0].p_final, now.getTime() > Date.parse('2026-10-21T00:00:00'));
      assert.equal(f.applies[0].p_notifications.completed, now.getTime() > Date.parse('2026-10-21T00:00:00'));
    }, { games: [game(3)], box: box(3) });
  }
});
test('Skins projection failure preserves standings writes; complete 82-game standings never silently finalize a season', async () => {
  const f = fixture(); f.candidates.fantasy = [];
  await withProvider(async () => {
    const result = await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at });
    assert.equal(result.success, true); assert.equal(f.applies[0].p_projections, null);
    assert.equal(result.details[0].summary.seasonAutoFinalized, false); assert.equal(result.details[0].summary.regularSeasonComplete, true);
    assert.match(result.details[0].summary.projectionError, /BPI/); assert.equal(f.seasons[0].status, 'locked');
    assert.equal(f.leases.get('skins:11').next - at.getTime(), 86400000);
  }, { records: recordsPayload(40,42), fail: url => url.includes('/bpi/') });
});
test('expired leases recover, provider failures back off and manual calls use the same task lease', async () => {
  const f = fixture(); f.candidates.skins = []; f.leases.set('fantasy:1', { token: 'dead', expires: at.getTime()-1, summary: {}, pending: null, failures: 0, next: 0 });
  await withProvider(async () => {
    const worker = app(f)('lib/nba/backgroundWorker.server.ts');
    const first = await worker.runNbaWorker({ now: at }); assert.equal(first.details[0].recovered, true); assert.equal(first.failed, 1);
    assert.equal(f.leases.get('fantasy:1').next-at.getTime(), 120000);
    const second = await worker.runNbaWorker({ now: at }); assert.equal(second.details[0].state, 'backoff');
    const manual = await worker.runNbaWorker({ manualWork: f.candidates.fantasy[0], now: at }); assert.equal(manual.failed, 1); assert.equal(f.runs.at(-1).source, 'manual');
  }, { fail: () => true });
});
test('notification recovery uses the committed original transition without another provider request', async () => {
  const f = fixture(); f.candidates.skins = []; let attempts = 0;
  await withProvider(async calls => {
    const worker = app(f, { notifyNewlyFinishedPlayers: async input => { assert.equal(input.currentStats[0].game_status, 3); return { attempted: 1, sent: attempts++ ? 0 : 0, skipped: 0, failed: attempts === 1 ? 1 : 0 }; } })('lib/nba/backgroundWorker.server.ts');
    const first = await worker.runNbaWorker({ now: at }); assert.equal(first.failed, 1); assert.ok(f.leases.get('fantasy:1').pending);
    const fetched = calls.length;
    const recovered = await worker.runNbaWorker({ manualWork: f.candidates.fantasy[0], now: at });
    assert.equal(recovered.success, true); assert.equal(calls.length, fetched); assert.equal(f.leases.get('fantasy:1').pending, null); assert.equal(f.applies.length, 1);
  }, { games: [game(3)], box: box(3) });
});
test('idle runs, discovery failure isolation, per-game work bounds and pruning are observable', async () => {
  const f = fixture(); f.candidates.fantasy = []; f.candidates.skins = [];
  const idle = await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at }); assert.equal(idle.processed, 0); assert.ok(f.runs[0].finished_at);
  assert.ok(f.rpcCalls.some(row => row.name === 'prune_nba_sync_runs'));
  const many = fixture(); many.candidates.skins = [];
  for (let id=2;id<10;id++) { many.contexts.set(id, context(id)); many.candidates.fantasy.push({ ...many.candidates.fantasy[0], target_id: id }); }
  await withProvider(async () => { const result = await app(many)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at }); assert.equal(result.processed, 3); assert.equal(result.budgetStopped, true); });
  const failure = fixture(); const rpc = failure.admin.rpc; failure.admin.rpc = (name,args) => name === 'discover_nba_work' && args.p_task==='fantasy' ? Promise.resolve({error:true}) : rpc(name,args);
  await withProvider(async () => { const result = await app(failure)('lib/nba/backgroundWorker.server.ts').runNbaWorker({ now: at }); assert.equal(result.succeeded, 1); assert.equal(result.status, 'partial_failure'); });
});
test('new cron fails closed; legacy cron does no work even with its old secret; errors redact credentials', async () => {
  const load = loader(), { GET } = load('app/api/cron/refresh-nba/route.ts'), old = load('app/api/cron/refresh-nba-skins/route.ts').GET;
  const cron = process.env.CRON_SECRET, golf = process.env.GOLF_CRON_SECRET;
  try {
    delete process.env.CRON_SECRET; assert.equal((await GET(new Request('http://local'))).status,401);
    process.env.CRON_SECRET='correct'; assert.equal((await GET(new Request('http://local',{headers:{authorization:'Bearer wrong'}}))).status,401);
    process.env.GOLF_CRON_SECRET='legacy'; assert.equal((await old(new Request('http://local',{headers:{authorization:'Bearer legacy'}}))).status,410);
    assert.equal(load('lib/nba/backgroundSafety.ts').nbaWorkerError('secret=correct Bearer legacy'), 'secret=[redacted] Bearer [redacted]');
  } finally { if(cron===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=cron;if(golf===undefined)delete process.env.GOLF_CRON_SECRET;else process.env.GOLF_CRON_SECRET=golf; }
});

test('browser and background calls arriving together share one Fantasy claim and scoring write', async () => {
  const f = fixture(); f.candidates.skins = [];
  await withProvider(async calls => {
    const worker = app(f)('lib/nba/backgroundWorker.server.ts');
    const results = await Promise.all([worker.runNbaWorker({ now: at }), worker.runNbaWorker({ manualWork: f.candidates.fantasy[0], now: at })]);
    assert.equal(f.applies.length,1); assert.equal(results.flatMap(r=>r.details).filter(d=>d.state==='leased').length,1);
    assert.equal(calls.filter(url=>url.includes('boxscore_')).length,1);
  });
});
test('provider deadline/request budgets stop new fetching; season and missing-stat identity checks reject wrong snapshots', async () => {
  const { NbaProvider } = loader()('lib/nba/provider.ts');
  await withProvider(async calls => {
    await assert.rejects(new NbaProvider(Date.now()-1).schedule(),/budget/); assert.equal(calls.length,0);
    const provider = new NbaProvider(Date.now()+10000,1), games=await provider.schedule();
    await assert.rejects(provider.box(games[0]),/budget/); assert.equal(calls.length,1);
  });
  const wrong=recordsPayload();wrong.season.year=2026;
  await withProvider(async()=>{await assert.rejects(new NbaProvider().standings(2026),/season mismatch/);},{records:wrong});
  const missing=recordsPayload();missing.children[0].standings.entries[0].stats[0].value=null;
  await withProvider(async()=>{await assert.rejects(new NbaProvider().standings(2026),/missing wins/);},{records:missing});
});
test('BPI refresh is daily with six-hour retry and no dependency of records on BPI', () => {
  const { projectionIsDue }=loader()('lib/nba/backgroundPolicy.ts');
  const recent=new Date(at.getTime()-3600000).toISOString();
  assert.equal(projectionIsDue({projectionCheckedAt:recent},at),false);
  assert.equal(projectionIsDue({projectionCheckedAt:recent,projectionError:'unavailable'},at),false);
  assert.equal(projectionIsDue({projectionCheckedAt:new Date(at.getTime()-7*3600000).toISOString(),projectionError:'unavailable'},at),true);
});
test('manual route preserves authorization and rejects other sports before invoking the authoritative worker', async () => {
  let calls=0, target={sportKey:'nba',leagueId:'nba-a',groupId:'group-a'};
  const load=loader({
    '@/lib/security/resourceAuthorization':{authorizeSlateResource:async()=>({ok:true,target})},
    '@/lib/nba/backgroundWorker.server':{runNbaWorker:async options=>{calls++;assert.equal(options.manualWork.league_id,'nba-a');return {success:true,runId:'r',details:[{target_id:1,state:'leased'}]};}},
  });
  const {POST}=load('app/api/refresh-stats/route.ts'),request=()=>new Request('http://local',{method:'POST',body:JSON.stringify({slateId:1})});
  assert.equal((await POST(request())).status,200);assert.equal(calls,1);
  target={...target,sportKey:'nfl'};assert.equal((await POST(request())).status,404);assert.equal(calls,1);
});

test('a final first day still ingests while later multi-day games await tip; unpinned final games cannot freeze history', async () => {
  const load=loader(),{normalizeNbaScheduleGame}=load('lib/nba/provider.ts'),{fantasyPollPolicy}=load('lib/nba/backgroundPolicy.ts');
  const past=normalizeNbaScheduleGame(game(3));
  const future=normalizeNbaScheduleGame(game(1,{gameId:'0022600002',gameCode:'20261022/LALBOS',gameDateTimeUTC:'2026-10-22T23:00Z'}));
  const policy=fantasyPollPolicy([past,future],'2026-10-22',at);assert.equal(policy.process,true);assert.equal(policy.reason,'between_games');assert.equal(policy.delaySeconds,3600);
  const f=fixture();f.candidates.skins=[];
  await withProvider(async()=>{
    const result=await app(f)('lib/nba/backgroundWorker.server.ts').runNbaWorker({now:at});
    assert.equal(result.success,true);assert.equal(f.applies[0].p_final,false);assert.equal(result.details[0].summary.finalizationNeedsPins,true);
  },{games:[game(3)],box:box(3)});
});

test('Fantasy request exhaustion leaves the reserved Skins provider allocation usable',async()=>{
  const {NbaProvider}=loader()('lib/nba/provider.ts');
  await withProvider(async calls=>{
    const provider=new NbaProvider(Date.now()+10000,9);const games=await provider.schedule();
    await assert.rejects(provider.box(games[0]),/nba:request_budget/);
    const standings=await provider.standings(2026);assert.equal(standings.records.length,30);assert.equal(calls.length,2);
  });
});
