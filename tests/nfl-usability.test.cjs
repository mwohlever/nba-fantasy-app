/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const weeks = require('../lib/providers/nflWeeks.ts');
const stats = require('../lib/lineups/nflDraftStats.ts');
const { resolveNflFantasyGames } = require('../lib/live-scores/nflFantasyGames.ts');
const { normalizeNflGame } = require('../lib/providers/nflLiveScores.ts');
function payload(week = 1, season = 2026) {
  const dates = week === 1 ? ['2026-09-10T00:20Z', '2026-09-13T17:00Z', '2026-09-15T00:15Z'] : ['2026-09-18T00:20Z', '2026-09-20T17:00Z', '2026-09-22T00:15Z'];
  return {
    season: { year: season, type: 2 }, week: { number: week },
    leagues: [{ calendar: [{ value: '2', entries: [
      { value: '1', label: 'Week 1', startDate: '2026-09-06T07:00Z', endDate: '2026-09-16T06:59Z' },
      { value: '2', label: 'Week 2', startDate: '2026-09-16T07:00Z', endDate: '2026-09-23T06:59Z' },
    ] }] }],
    events: dates.map((date, i) => ({ id: String(i), date, season: { year: season, type: 2 }, week: { number: week }, competitions: [{ competitors: [
      { homeAway: 'away', team: { id: `A${i}`, abbreviation: `A${i}`, displayName: 'Away' } },
      { homeAway: 'home', team: { id: `H${i}`, abbreviation: `H${i}`, displayName: 'Home' } },
    ] }] })),
  };
}
test('provider week 1 includes Wednesday opener, Sunday and Monday after UTC midnight; Game Center agrees', () => {
  const p = payload(), selected = weeks.resolveNflWeekPayload(p, 2026, 1);
  assert.deepEqual(selected, { season: 2026, week: 1, name: '2026 Week 1', startDate: '2026-09-09', endDate: '2026-09-14', gameCount: 3 });
  const games = p.events.map(normalizeNflGame);
  const resolved = resolveNflFantasyGames(games, { date: selected.startDate, start_date: selected.startDate, end_date: selected.endDate });
  for (const game of games) assert.equal(resolved.get(game.awayTeam.abbreviation), game);
});
test('week 2 resolves its own inclusive dates and name', () => {
  const selected = weeks.resolveNflWeekPayload(payload(2), 2026, 2);
  assert.equal(selected.startDate, '2026-09-17'); assert.equal(selected.endDate, '2026-09-21'); assert.equal(selected.name, '2026 Week 2');
});
test('default uses provider current week and upcoming regular-season calendar', () => {
  assert.equal(weeks.defaultNflWeek(payload(2)), 2);
  const preseason = payload(); preseason.season.type = 1;
  assert.equal(weeks.defaultNflWeek(preseason, Date.parse('2026-08-30')), 1);
  assert.equal(weeks.defaultNflWeek(preseason, Date.parse('2026-09-17')), 2);
});
test('provider mismatch, empty schedule, wrong event identity and inconsistent submitted dates fail closed', () => {
  assert.throws(() => weeks.resolveNflWeekPayload(payload(), 2027, 1));
  assert.throws(() => weeks.resolveNflWeekPayload(payload(), 2026, 2));
  assert.throws(() => weeks.resolveNflWeekPayload({ ...payload(), events: [] }, 2026, 1));
  const p = payload(); p.events[0].season.type = 1;
  assert.throws(() => weeks.resolveNflWeekPayload(p, 2026, 1));
  const selected = weeks.resolveNflWeekPayload(payload(), 2026, 1);
  assert.equal(weeks.validateNflWeekDates(selected), true);
  assert.equal(weeks.validateNflWeekDates(selected, '2026-09-10', selected.endDate), false);
});
test('duplicate identity and legacy overlapping dates are league-specific', () => {
  const selected = weeks.resolveNflWeekPayload(payload(), 2026, 1);
  const slate = { sport: 'nfl', league_id: 'group-a-nfl', date: selected.startDate, end_date: selected.endDate };
  assert.equal(weeks.isDuplicateNflWeek(slate, 'group-a-nfl', selected), true);
  assert.equal(weeks.isDuplicateNflWeek({ ...slate, date: '2026-09-10' }, 'group-a-nfl', selected), true);
  assert.equal(weeks.isDuplicateNflWeek(slate, 'group-b-nfl', selected), false);
  assert.equal(weeks.isDuplicateNflWeek(slate, 'group-a-other-nfl', selected), false);
  assert.equal(weeks.isDuplicateNflWeek(slate, 'group-a-nfl', weeks.resolveNflWeekPayload(payload(2), 2026, 2)), false);
});
test('zero/no current production falls back dynamically; regular season production enables current season', () => {
  assert.equal(stats.nflComparisonSeason(2026, []), 2025);
  assert.equal(stats.nflComparisonSeason(2031, [{ games_played: 0, receiving_yards: 0 }]), 2030);
  assert.equal(stats.nflComparisonSeason(2026, [{ games_played: 1, receiving_yards: 0 }]), 2025);
  assert.equal(stats.nflComparisonSeason(2026, [{ games_played: 1, receiving_yards: 20 }]), 2026);
  assert.equal(stats.nflSeasonForSlate({ date: '2027-01-10', display_name: '2026 Week 18' }, '2027'), '2026');
  assert.equal(stats.nflSeasonForSlate({ date: '2027-01-10' }, '2027'), '2026');
});
for (const [position, field] of [['QB', 'passing_yards'], ['RB', 'rushing_yards'], ['WR', 'receiving_yards'], ['TE', 'receiving_yards']]) {
  test(`${position} defaults to relevant yards; ascending/descending keep rookies and nulls last`, () => {
    const key = stats.nflPositionStats(position)[0];
    const rows = [{ id: 'rookie' }, { id: 'low', [field]: 10 }, { id: 'high', [field]: 100 }, { id: 'null', [field]: null }];
    assert.deepEqual([...rows].sort((a,b) => stats.compareNflStats(a,b,key,false)).map(r=>r.id), ['high','low','rookie','null']);
    assert.deepEqual([...rows].sort((a,b) => stats.compareNflStats(a,b,key,true)).map(r=>r.id), ['low','high','rookie','null']);
  });
}
test('position options expose reliable totals; unavailable special-position data is not fabricated', () => {
  assert.deepEqual(stats.nflPositionStats('WR'), ['nfl_rec_yd', 'nfl_receptions', 'nfl_rec_td']);
  assert.ok(stats.nflPositionStats('RB').includes('nfl_rush_td'));
  assert.ok(stats.nflPositionStats('QB').includes('nfl_int'));
  assert.deepEqual(stats.nflPositionStats('K'), []); assert.deepEqual(stats.nflPositionStats('D/ST'), []);
});

// API integration tests use an in-memory read-only database; any attempted write fails.
let db = {}, calls = [];
const originalLoad = Module._load;
Module._load = function(request, parent, ...args) {
  if (request === '@/lib/supabaseAdmin') return { supabaseAdmin: { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const q = { select() { return q; }, eq(key, value) { call.filters.push([key,value]); return q; }, order() { return q; }, range() { return q; }, not() { return q; },
      then(resolve) { return Promise.resolve({ data: (db[table] ?? []).filter(row => call.filters.every(([k,v]) => row[k] === v)), error: null }).then(resolve); } };
    return q;
  } } };
  if (request === '@/lib/requireAdminApi') return { requireAdminApi: async () => null };
  if (request === '@/lib/auth') return { getCurrentUser: async () => ({ id: 'user' }) };
  if (request === '@/lib/groups/context') return { getActiveLeagueForSport: async () => ({ context: { group: { id: 'group-a' } }, league: { id: 'group-a-nfl', settings: {} } }) };
  return originalLoad.call(this, request, parent, ...args);
};
const { NextRequest } = require('next/server');
const seasonRoute = require('../app/api/player-season-stats/route.ts');
const slateRoute = require('../app/api/slates/route.ts');
test('Draft API uses actual requested NFL year, falls back once, and bulk joins identities without player requests', async () => {
  calls = []; db = { players_nfl: [{ id: 9, nfl_player_id: 90 }], player_nfl_season_stats: [{ season: 2025, nfl_player_id: 90, games_played: 17, receiving_yards: 1200 }] };
  const response = await seasonRoute.GET(new NextRequest('http://localhost/api/player-season-stats?sport=nfl&season=2026&nflBaseline=auto'));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.professionalSeason, 2025); assert.equal(body.playerStats[0].player_id, 9); assert.equal(body.playerStats[0].receiving_yards, 1200);
  assert.equal(calls.filter(c=>c.table === 'players_nfl').length, 1);
  assert.deepEqual(calls.filter(c=>c.table === 'player_nfl_season_stats').map(c=>c.filters), [[['season',2026]],[['season',2025]]]);
  db.player_nfl_season_stats.push({ season: 2026, nfl_player_id: 90, games_played: 1, receiving_yards: 50 }); calls = [];
  const current = await (await seasonRoute.GET(new NextRequest('http://localhost/api/player-season-stats?sport=nfl&season=2026&nflBaseline=auto'))).json();
  assert.equal(current.professionalSeason, 2026); assert.equal(calls.length, 2);
  const legacy = await (await seasonRoute.GET(new NextRequest('http://localhost/api/player-season-stats?sport=nfl&season=2026'))).json();
  assert.equal(legacy.professionalSeason, 2025);
});
test('Create API rejects duplicate and inconsistent dates before any write', async () => {
  const original = global.fetch; global.fetch = async () => ({ ok: true, json: async () => payload() });
  try {
    db = { slates: [{ id: 12, sport: 'nfl', league_id: 'group-a-nfl', date: '2026-09-09', end_date: '2026-09-14' }] }; calls = [];
    const post = body => slateRoute.POST(new NextRequest('http://localhost/api/slates', { method: 'POST', body: JSON.stringify({ sport: 'nfl', nflSeason: 2026, nflWeek: 1, ...body }) }));
    assert.equal((await post({})).status, 409);
    assert.deepEqual(calls[0].filters, [['league_id','group-a-nfl'],['sport','nfl']]);
    assert.equal((await post({ startDate: '2026-09-10', endDate: '2026-09-14' })).status, 400);
  } finally { global.fetch = original; }
});
test('Create UI retains NBA dates/Golf tournament and ties NFL preview and previous-slate lookup to resolved dates', () => {
  const page = source('app/slates/new/page.tsx');
  assert.match(page, /sport === "nfl" \? \([\s\S]*aria-label="NFL season"[\s\S]*aria-label="NFL week"[\s\S]*\) : \([\s\S]*Start Date/);
  assert.match(page, /Multiple days\?/); assert.match(page, /selectedGolfTournament\?\.name/);
  assert.match(page, /setStartDate\(result.startDate\)/); assert.match(page, /setEndDate\(result.endDate\)/);
  assert.match(page, /if \(sport === "nfl"\) return nflSelection\?\.name/);
  assert.match(page, /setupBeforeDate = sport === "golf" \? "" : startDate/);
  assert.match(page, /\[sport, setupBeforeDate\]/);
  const api = source('app/api/slates/route.ts');
  assert.match(api, /\.eq\("league_id", leagueId\)/); assert.match(api, /previousCompleted/);
});
test('informational stats preserve pool membership, draft actions, and Group-scoped parent loading', () => {
  const pool = source('components/lineups/PlayerPool.tsx');
  assert.match(pool, /return \[\.\.\.filteredPlayers\]\.sort/);
  assert.match(pool, /slotDraftContext\.onDraftPlayer/); assert.match(pool, /setDraftingPlayer\(/);
  assert.match(pool, /disabled=\{isAssigningPlayer\}/);
  assert.match(source('app/lineups/draft/page.tsx'), /activeLeagueId/);
  assert.match(pool, /value === null \? "—"/);
  assert.match(pool, /regular-season stats/);
});

// Exercise the actual component event handlers/effects with controlled responses.
// No browser dependency, network requests, or draft writes are needed.
function componentHarness(file, mocks, fetcher, initialProps = {}) {
  const vm = require('node:vm');
  let cursor = 0, state = [], deps = [], cleanup = [], effects = [], tree, props = initialProps;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, next) { const i = cursor++; if (!deps[i] || next.some((v,j) => !Object.is(v,deps[i][j]))) {
      deps[i] = next; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); });
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module, exports: module.exports, URLSearchParams, AbortController, console, fetch: fetcher,
      require(id) { if (id === 'react') return hooks; return id in mocks ? mocks[id] : require(id); } });
  const render = () => { cursor = 0; tree = module.exports.default(props); const pending = effects; effects = []; pending.forEach(fn=>fn()); return tree; };
  return { render, get tree() { return tree; }, setProps(next) { props = { ...props, ...next }; },
    async settle() { for (let i=0;i<5;i++) { render(); await new Promise(resolve => setImmediate(resolve)); } return tree; },
    close() { cleanup.forEach(fn=>fn?.()); } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child=>nodes(child,predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children,predicate)];
}
function textContent(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  return typeof tree === 'object' ? textContent(tree.props?.children) : String(tree);
}
test('Create component switches week/season, clears stale duplicate state, and reloads team-order boundary', async () => {
  const requests = []; let sport = 'nfl';
  const router = { replace() {} };
  const harness = componentHarness('app/slates/new/page.tsx', {
    '@/components/AppNav': { default: () => null },
    '@/lib/client/refreshGolfFromBrowser': {},
    'next/navigation': { useRouter: () => router, useSearchParams: () => new URLSearchParams({ sport }) },
  }, async url => {
    requests.push(url);
    if (url.startsWith('/api/slates/nfl-week')) {
      const params = new URL(url, 'http://localhost').searchParams;
      const week = Number(params.get('week') || 1), season = Number(params.get('season') || 2026);
      return { ok: true, json: async () => ({ ...weeks.resolveNflWeekPayload(payload(week, season), season, week),
        weeks: [{ value: 1, label: 'Week 1' }, { value: 2, label: 'Week 2' }], existingSlateId: week === 1 ? 12 : null }) };
    }
    return { ok: true, json: async () => ({ success: true, teams: [] }) };
  });
  try {
    await harness.settle();
    assert.equal(nodes(harness.tree,n=>n.props?.type === 'date').length,0);
    assert.match(textContent(harness.tree), /2026 Week 1 is already created/);
    assert.equal(nodes(harness.tree,n=>n.props?.type === 'submit')[0].props.disabled,true);
    assert.ok(requests.some(url=>url.includes('beforeDate=2026-09-09')));
    nodes(harness.tree,n=>n.props?.['aria-label'] === 'NFL week')[0].props.onChange({target:{value:'2'}});
    harness.render();
    assert.doesNotMatch(textContent(harness.tree), /already created/);
    assert.equal(nodes(harness.tree,n=>n.props?.type === 'submit')[0].props.disabled,true);
    await harness.settle();
    assert.match(textContent(harness.tree), /2026 Week 2/);
    assert.ok(requests.some(url=>url.includes('beforeDate=2026-09-17')));
    assert.equal(nodes(harness.tree,n=>n.props?.type === 'submit')[0].props.disabled,false);
    nodes(harness.tree,n=>n.props?.['aria-label'] === 'NFL season')[0].props.onChange({target:{value:'2027'}});
    await harness.settle();
    assert.ok(requests.some(url=>url === '/api/slates/nfl-week?season=2027'));
    assert.match(textContent(harness.tree), /2027 Week 1/);
    sport = 'nba'; await harness.settle();
    assert.equal(nodes(harness.tree,n=>n.props?.type === 'date').length,1);
    assert.match(textContent(harness.tree), /Multiple days\?/);
    assert.equal(nodes(harness.tree,n=>n.props?.['aria-label'] === 'NFL week').length,0);
    sport = 'golf'; await harness.settle();
    assert.equal(nodes(harness.tree,n=>n.props?.type === 'date').length,0);
    assert.match(textContent(harness.tree), /Tournament/);
  } finally { harness.close(); }
});
test('PlayerPool renders actual season, changes position/direction, and keeps rookie/K/DST draft actions intact', async () => {
  const requests = [], drafted = [];
  const players = [
    { id: 1, name: 'Veteran', position_group: 'WR' },
    { id: 2, name: 'Rookie', position_group: 'WR' },
    { id: 3, name: 'Receiver', position_group: 'WR' },
    { id: 4, name: 'Kicker', position_group: 'K' },
    { id: 5, name: 'Defense', position_group: 'D/ST' },
    { id: 6, name: 'Quarterback', position_group: 'QB' },
    { id: 7, name: 'Running Back', position_group: 'RB' },
    { id: 8, name: 'Tight End', position_group: 'TE' },
  ];
  const ResearchModal = () => null;
  const harness = componentHarness('components/lineups/PlayerPool.tsx', {
    '@/components/ui/PlayerHeadshot': { default: () => null },
    '@/components/lineups/PlayerResearchModal': { default: ResearchModal },
    '@/components/providers/SportProvider': { useSelectedSport: () => ({ selectedSport: 'nfl' }) },
  }, async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ available: true, professionalSeason: 2025, playerStats: [
      { player_id: 1, receiving_yards: 1000 }, { player_id: 3, receiving_yards: 500 },
    ], playerHistory: [] }) };
  }, { players, filteredPlayers: players, searchTerm: '', setSearchTerm() {}, positionFilter: 'WR', setPositionFilter() {},
    onSlateOnly: false, setOnSlateOnly() {}, isAvailabilityLoading: false, availablePlayerIdsForSlate: [], availablePlayerIdSet: new Set(),
    playerAverageMap: new Map(), playerProjections: {}, getOwnerTeamForPlayer: () => null, setDraftingPlayer: p => drafted.push(p),
    isAssigningPlayer: false, rosterSlots: [], selectedSeason: '2027', nflSeason: '2026',
  });
  const cards = () => nodes(harness.tree,n=>n.type === 'button' && n.props?.className?.split(' ').includes('draft-player-card'));
  const sort = () => nodes(harness.tree,n=>n.type === 'select')[0];
  try {
    await harness.settle();
    assert.match(textContent(harness.tree), /2025 regular-season stats/);
    assert.ok(requests.includes('/api/player-season-stats?season=2026&sport=nfl&nflBaseline=auto'));
    assert.ok(requests.includes('/api/player-history?season=2027&sport=nfl'));
    assert.equal(sort().props.value,'nfl_rec_yd');
    assert.equal(cards().length,8);
    for (const player of players) {
      const card = cards().find(c => String(c.key) === String(player.id));
      const grid = nodes(card, n => n.props?.className === 'draft-player-nfl-stats')[0];
      const count = stats.nflPositionStats(player.position_group).length;
      assert.equal(grid.props.style.gridTemplateColumns, `repeat(${Math.max(1, count)}, minmax(0, 1fr))`);
      const labels = nodes(grid, n => n.props?.className === 'draft-player-nfl-stat-label');
      const values = nodes(grid, n => n.props?.className === 'draft-player-nfl-stat-value');
      assert.equal(labels.length, count);
      assert.equal(values.length, count);
      assert.ok(labels.every(label => !textContent(label).includes('Yards')));
      if (!count) assert.equal(nodes(grid, n => n.props?.className === 'draft-player-nfl-stats-unavailable').length, 1);
    }
    assert.match(textContent(cards()[0]), /Veteran/);
    assert.match(textContent(cards().find(c=>textContent(c).includes('Rookie'))), /—/);
    nodes(harness.tree,n=>n.props?.['aria-label'] === 'Change NFL stat sort direction')[0].props.onClick();
    await harness.settle(); assert.match(textContent(cards()[0]), /Receiver/);
    for (const name of ['Rookie','Kicker','Defense']) {
      const card = cards().find(c=>textContent(c).includes(name)); assert.equal(card.props.disabled,false);
      if (name !== 'Rookie') assert.match(textContent(card), /comparison stats unavailable/);
      card.props.onClick(); await harness.settle();
      const modal = nodes(harness.tree,n=>n.type === ResearchModal)[0];
      assert.equal(modal.props.nflStatsSeason,2025); await modal.props.onAction();
      assert.equal(drafted.at(-1).name,name);
    }
    harness.setProps({ positionFilter: 'RB' }); await harness.settle(); assert.equal(sort().props.value,'nfl_rush_yd');
    assert.match(textContent(harness.tree), /Descending/);
    assert.match(textContent(sort()), /Rush TD/); assert.doesNotMatch(textContent(sort()), /Pass TD/);
    const history = nodes(harness.tree,n=>n.type === 'button' && textContent(n) === 'League History')[0];
    history.props.onClick(); await harness.settle();
    harness.setProps({ positionFilter: 'QB' }); await harness.settle(); assert.equal(sort().props.value,'times_drafted');
    assert.equal(requests.filter(url=>url.includes('player-season-stats')).length,1);
  } finally { harness.close(); }
});

test('week preview API returns the active-league duplicate only and caches provider reads', async () => {
  const route = require('../app/api/slates/nfl-week/route.ts');
  const original = global.fetch, providerCalls = [];
  global.fetch = async (url, options) => { providerCalls.push({ url, options }); return { ok: true, json: async () => payload() }; };
  try {
    db = { slates: [{ id: 91, sport: 'nfl', league_id: 'other-group-nfl', date: '2026-09-09', end_date: '2026-09-14' }] };
    const request = () => new NextRequest('http://localhost/api/slates/nfl-week?season=2026&week=1');
    const available = await (await route.GET(request())).json();
    assert.equal(available.existingSlateId, null); assert.equal(available.name, '2026 Week 1');
    assert.equal(providerCalls.length, 2);
    assert.ok(providerCalls.every(call => call.options.next.revalidate === 300));
    assert.match(providerCalls[1].url, /seasontype=2&week=1/);
    db.slates.push({ ...db.slates[0], id: 92, league_id: 'group-a-nfl' });
    const duplicate = await (await route.GET(request())).json();
    assert.equal(duplicate.existingSlateId, 92);
  } finally { global.fetch = original; }
});

 test('NFL comparison grid spans the whole card and keeps labels and values on single lines', () => {
  const css = source('app/globals.css');
  const rule = selector => css.slice(css.indexOf(selector + ' {')).split('}')[0];
  assert.match(rule('.draft-player-card--season .draft-player-nfl-stats'), /grid-column: 1 \/ -1/);
  assert.match(rule('.draft-player-card--season .draft-player-nfl-stats'), /display: grid/);
  assert.match(rule('.draft-player-nfl-stat'), /display: grid/);
  assert.match(rule('.draft-player-nfl-stat-label'), /white-space: nowrap/);
  assert.match(rule('.draft-player-nfl-stat-value'), /white-space: nowrap/);
  assert.match(rule('.draft-player-nfl-stat-value'), /font-variant-numeric: tabular-nums/);
  assert.match(rule('.draft-player-nfl-stats-unavailable'), /grid-column: 1 \/ -1/);
});
