/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), test = require('node:test'), ts = require('typescript');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const root = path.resolve(__dirname, '..');
const next = { NextResponse: { json: (body, options) => Response.json(body, options) } };
function load(file, mocks = {}, extra = '') {
  const mod = { exports: {} }, source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + extra,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : require(id.startsWith('.') ? path.resolve(root, path.dirname(file), id) : id), mod, mod.exports);
  return mod.exports;
}
function database(tables) {
  const reads = [], writes = [];
  return { reads, writes, from(table) {
    let rows = [...(tables[table] ?? [])], single = false; reads.push([table]);
    const q = { select(columns) { reads.push([table, columns]); return q; }, eq(k, v) { rows = rows.filter(r => r[k] === v); return q; },
      in(k, values) { rows = rows.filter(r => values.includes(r[k])); return q; }, is(k, v) { rows = rows.filter(r => r[k] === v); return q; },
      not(k, operator, v) { rows = rows.filter(r => r[k] !== v); return q; }, order: () => q, range: () => q,
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      then(ok, no) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(ok, no); },
      insert() { writes.push(table); assert.fail('Read-only API wrote data'); }, update() { writes.push(table); assert.fail('Read-only API wrote data'); }, delete() { writes.push(table); assert.fail('Read-only API deleted data'); } }; return q;
  }, rpc() { assert.fail('Read-only API invoked a writer RPC'); } };
}
function fixture(sport) {
  return {
    teams: [{ id: 1, name: 'Actual winner', user_id: 'one', group_id: 'a' }, { id: 2, name: 'Other', user_id: 'two', group_id: 'a' }],
    group_memberships: ['one', 'two'].map(user_id => ({ user_id, group_id: 'a', is_active: true })),
    slates: [{ id: 1, sport, league_id: `${sport}-a`, archived_at: null, date: '2026-09-01', start_date: '2026-09-01', end_date: '2026-09-01', is_locked: true, first_game_start_time: null }],
    lineups: [{ id: 11, team_id: 1, slate_id: 1 }, { id: 22, team_id: 2, slate_id: 1 }],
    lineup_players: [{ lineup_id: 11, player_id: 7, roster_slot_position: sport === 'nba' ? 'G' : 'QB', roster_slot_index: 0, projected_fantasy_points: 99999 }, { lineup_id: 22, player_id: 8, projected_fantasy_points: 88888 }],
    [sport === 'nba' ? 'players' : 'players_nfl']: [{ id: 7, name: 'Actual Player', team_abbreviation: 'KC', position_group: 'G', position: 'QB' }, { id: 8, name: 'Other Player', team_abbreviation: 'NYJ' }],
    [sport === 'nba' ? 'player_slate_stats' : 'player_nfl_slate_stats']: [{ slate_id: 1, player_id: 7, fantasy_points: 99, points: 20, passing_yards: 400, game_status: 3 }, { slate_id: 1, player_id: 8, fantasy_points: -5, game_status: 3 }],
    team_slate_results: [{ slate_id: 1, team_id: 1, fantasy_points: 99, finish_position: 1, games_completed: 1, games_in_progress: 0, games_remaining: 0 }, { slate_id: 1, team_id: 2, fantasy_points: -5, finish_position: 2, games_completed: 1, games_in_progress: 0, games_remaining: 0 }],
    slate_teams: [{ slate_id: 1, team_id: 1, draft_order: 1, is_participating: true }, { slate_id: 1, team_id: 2, draft_order: 2, is_participating: true }],
  };
}
for (const sport of ['nba', 'nfl']) test(`${sport}: mixed factual APIs preserve shape, saved picks/results and history without reading or emitting forecasts`, async () => {
  const tables = fixture(sport), before = JSON.stringify(tables), db = database(tables);
  const access = { context: { group: { id: 'a' } }, league: { id: `${sport}-a` }, slate: { id: 1, sport } };
  const mocks = { 'next/server': next, '@/lib/supabaseAdmin': { supabaseAdmin: db }, '@/lib/auth': { getCurrentUser: async () => ({ id: 'one' }) },
    '@/lib/groups/context': { getActiveSlateAccessForUser: async () => access, getActiveLeagueForSport: async () => access },
    '@/lib/lineups/draftHistory.server': {}, '@/lib/draftNotifications': {}, '@/lib/home/golfHomeSummary': {},
    '@/lib/providers/nfl': { fetchScoreboardForRange: async () => [] } };
  const { GET: lineups } = load('app/api/lineups/route.ts', mocks);
  const request = { nextUrl: new URL(`http://test/api/lineups?sport=${sport}&slateId=1`) };
  const saved = await (await lineups(request)).json(); assert.equal(saved.success, true);
  assert.equal(saved.groupId, 'a'); assert.deepEqual(saved.lineups[0].player_ids, [7]); assert.equal(saved.lineups[0].player_slots[0].roster_slot_index, 0);
  assert.equal(saved.lineups[0].pregame_projected_points, null);
  const { GET: league } = load('app/api/player-league-profile/route.ts', mocks);
  const history = await (await league(new Request(`http://test/?sport=${sport}&playerId=7&season=2026`))).json();
  assert.equal(history.summary.timesDrafted, 1); assert.equal(history.summary.wins, 1); assert.equal(history.summary.averageFantasyPoints, 99);
  assert.equal(history.recentHistory[0].fantasyPoints, 99); assert.equal(history.recentHistory[0].teamName, 'Actual winner');
  for (const key of ['projectedFantasyPoints', 'projectionDifference', 'projectionConfidence', 'projectionSource', 'projectedAt']) assert.equal(history.recentHistory[0][key], null, key);
  assert.equal(history.summary.projectionSampleSize, 0); assert.equal(history.summary.averageProjectionDifference, null);
  const { GET: home } = load('app/api/home-summary/route.ts', mocks);
  const response = await home(new Request(`http://test/?sport=${sport}&slateId=1`)); assert.equal(response.status, 200);
  const summary = await response.json(); assert.equal(summary.latestSlate.id, 1); assert.equal(summary.latestSlateRows[0].teamName, 'Actual winner');
  assert.equal(summary.latestSlateRows[0].fantasy_points, 99); assert.equal(summary.latestSlateRows[1].fantasy_points, -5);
  for (const row of summary.latestSlateRows) for (const key of ['projected_points', 'pregame_projected_points', 'win_probability']) assert.equal(row[key], null, key);
  assert.ok(db.reads.filter(([table, columns]) => table === 'lineup_players' && columns).every(([, columns]) => !columns.includes('projected_fantasy_points')));
  assert.ok(!db.reads.some(([table]) => table.includes('projection_stat_cache')));
  assert.deepEqual(db.writes, []); assert.equal(JSON.stringify(tables), before, 'immutable stored snapshots and actual results untouched');
});

test('NFL Game Center preserves plays, box scores, annotations, access checks and a nullable predictor key', async () => {
  const oldFetch = global.fetch, calls = [], competition = { status: { type: { state: 'post', completed: true } }, competitors: [] };
  const summary = { header: { season: { year: 2026, type: 2 }, competitions: [competition] }, drives: { previous: [{ id: 'drive-1' }] }, scoringPlays: [{ id: 'score-1' }], boxscore: { players: [{ name: 'Actual Player' }] }, leaders: [{ name: 'Passing' }], gameInfo: { venue: 'Real stadium' }, predictor: { homeTeam: { gameProjection: 95 } }, lastFiveGames: [{ actual: true }] };
  global.fetch = async url => { calls.push(String(url)); return Response.json(summary); };
  try {
    const { createFootballGameDetailHandler } = load('lib/live-scores/game-detail.ts', { 'next/server': next, '@/lib/auth': { getCurrentUser: async () => ({ id: 'one' }) } });
    const request = new Request('http://test/?eventId=123');
    const handler = createFootballGameDetailHandler('nfl', async () => ({ group: 'a' }), async () => ({ ownership: 'retained' }));
    const data = await (await handler(request)).json();
    for (const key of ['header', 'drives', 'scoringPlays', 'boxscore', 'leaders', 'gameInfo', 'lastFiveGames']) assert.deepEqual(data[key], summary[key], key);
    assert.equal(data.ownership, 'retained'); assert.equal(data.predictor, null); assert.equal(data.eventId, '123'); assert.equal(calls.length, 1);
    const ncaa = createFootballGameDetailHandler('college-football', async () => ({}));
    assert.deepEqual((await (await ncaa(request)).json()).predictor, summary.predictor, 'separate NCAA game remains unchanged');
    calls.length = 0; assert.equal((await createFootballGameDetailHandler('nfl', async () => null)(request)).status, 404); assert.deepEqual(calls, []);
    assert.equal((await createFootballGameDetailHandler('nfl', async () => ({}), undefined, () => 'Wrong Group')(request)).status, 409); assert.deepEqual(calls, []);
  } finally { global.fetch = oldFetch; }
});

test('dormant legacy player modal cannot render projections even when injected with old forecast snapshots', async () => {
  context.sport = 'nba'; const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ summary: { timesDrafted: 1, wins: 1, runnerUps: 0, winRate: 100, draftedByBreakdown: [{ teamName: 'Historical owner', count: 1 }], averageFantasyPoints: 42, bestFantasyPoints: 42, worstFantasyPoints: 42, averageFinish: 1 }, recentHistory: [{ slateId: 1, slateLabel: '2026-01-01', teamName: 'Historical owner', finishPosition: 1, fantasyPoints: 42, stats: { points: 20 }, projectedFantasyPoints: 99999, projectionDifference: 99999 }] }) });
  try {
    const { LegacyForTest } = load('components/lineups/PlayerModal.tsx', {}, '\nexport const LegacyForTest = LegacyPlayerModal;');
    const props = { mode: 'view', player: { id: 7, name: 'Actual Player' }, playerAverageMap: new Map([[7, 42]]), playerProjections: { 7: { projection: 99999, confidence: 'high', badges: ['hot'], nbaSeasonAverage: 88888 } }, onClose() {} };
    const h = host(LegacyForTest); h.render(props, true); await new Promise(resolve => setImmediate(resolve));
    const tree = h.render(props), text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'number' || typeof tree === 'string' ? String(tree) : '';
    const content = text(tree); assert.doesNotMatch(content, /Projection|Projected|Confidence|99999|88888|Trending/);
    for (const label of ['League Average', '42.0', 'Recent Drafts', 'Drafted By', 'Historical owner', 'More career numbers']) assert.ok(content.includes(label), label);
    assert.ok(nodes(tree).some(node => node.props?.role === 'dialog')); h.unmount();
  } finally { global.fetch = oldFetch; }
});
