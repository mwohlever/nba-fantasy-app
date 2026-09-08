/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, URL, URLSearchParams, AbortController, AbortSignal, console,
    require(id) { if (id in mocks) return mocks[id]; throw Error(`Unexpected import: ${id}`); }, ...globals });
  return module.exports;
}
const setup = load('lib/ncaaPickEm/weekSetup.ts');
const calendar = { season: { year: 2026, type: 2 }, week: { number: 2 }, leagues: [{ calendar: [
  { value: '2', entries: Array.from({ length: 15 }, (_, i) => ({ value: String(i + 1), endDate: `2026-09-${String(7 + i).padStart(2, '0')}T23:59:00Z` })) },
  { value: '3', entries: [{ value: '999' }] },
] }] };
test('season/week values use provider regular-season calendar and saved seasons; current week wins over future saved state', () => {
  const result = setup.ncaaWeekSetup(calendar, calendar, [{ season: 2025, week_number: 1 }, { season: 2026, week_number: 3 }]);
  assert.deepEqual(Array.from(result.seasons), [2026, 2025]);
  assert.deepEqual(Array.from(result.weeks), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(result.week, 2);
});
test('provider calendar upcoming default and saved-state outage fallback', () => {
  const preseason = { ...calendar, season: { year: 2026, type: 1 } };
  assert.equal(setup.ncaaWeekSetup(preseason, calendar, [], undefined, Date.parse('2026-09-08T12:00Z')).week, 2);
  const fallback = setup.ncaaWeekSetup({}, {}, [{ season: 2025, week_number: 4 }]);
  assert.equal(fallback.season, 2025);
  assert.equal(fallback.week, 4);
});

// Render the real component with a small hook harness; deferred fetches deliberately ignore abort.
function pageHarness() {
  const slots = [], effects = [], requests = [];
  let cursor = 0, tree, confirm = false;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const Page = load('app/admin/ncaa-pickem/page.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/components/AppNav': { default: () => null } }, {
    window: { confirm: () => confirm },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  }).default;
  function render() { cursor = 0; tree = Page(); while (effects.length) effects.shift()(); return tree; }
  function nodes(type) { const found = []; function visit(n) { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(visit); if (n.type === type) found.push(n); visit(n.props?.children); } visit(tree); return found; }
  function text(n) { return Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : String(n ?? ''); }
  async function respond(request, body, status = 200) { request.resolve({ ok: status < 400, status, json: async () => body }); await new Promise(r => setImmediate(r)); render(); }
  const state = week => ({ success: true, season: 2026, week, weekId: week, status: week === 1 ? 'locked' : 'open', analysis: `Analysis ${week}`, games: [] });
  return { render, nodes, text, requests, respond, state, confirm: value => { confirm = value; } };
}
test('dropdowns default to current week, load exact weeks, ignore stale reads, and distinguish Import/Refresh', async () => {
  const h = pageHarness(); h.render();
  await h.respond(h.requests[0], { seasons: [2026, 2025], season: 2026, weeks: [1, 2, 3], week: 2 });
  assert.equal(h.nodes('select')[0].props.value, '2026');
  assert.equal(h.nodes('select')[1].props.value, '2');
  assert.deepEqual(h.nodes('option').map(h.text), ['2026', '2025', 'Week 1', 'Week 2', 'Week 3']);
  await h.respond(h.requests[1], h.state(2));
  assert.equal(h.text(h.nodes('button')[0]), 'Refresh Week from ESPN');
  h.nodes('select')[1].props.onChange({ target: { value: '1' } }); h.render();
  const stale = h.requests.at(-1);
  h.nodes('select')[1].props.onChange({ target: { value: '2' } }); h.render();
  await h.respond(h.requests.at(-1), h.state(2));
  await h.respond(stale, h.state(1));
  assert.equal(stale.options.signal.aborted, true);
  assert.equal(h.nodes('textarea')[0].props.value, 'Analysis 2');
  h.nodes('select')[1].props.onChange({ target: { value: '3' } }); h.render();
  assert.equal(h.nodes('textarea').length, 0);
  await h.respond(h.requests.at(-1), { error: "NCAA Pick 'Em week has not been imported." }, 404);
  assert.equal(h.text(h.nodes('button')[0]), 'Import Week from ESPN');
  h.nodes('button')[0].props.onClick(); h.render();
  const request = h.requests.at(-1);
  assert.equal(JSON.parse(request.options.body).week, 3);
  assert.equal(h.nodes('select')[1].props.disabled, true);
  await h.respond(request, h.state(3));
  assert.equal(h.text(h.nodes('button')[0]), 'Refresh Week from ESPN');
});
test('unsaved analysis blocks switching unless discarded; saved analysis clears dirty state', async () => {
  const h = pageHarness(); h.render();
  await h.respond(h.requests[0], { seasons: [2026], season: 2026, weeks: [1, 2], week: 1 });
  await h.respond(h.requests[1], h.state(1));
  h.nodes('textarea')[0].props.onChange({ target: { value: 'Draft' } }); h.render();
  h.nodes('select')[1].props.onChange({ target: { value: '2' } }); h.render();
  assert.equal(h.nodes('select')[1].props.value, '1');
  h.nodes('button').find(b => h.text(b) === 'Save MW Analysis').props.onClick(); h.render();
  assert.equal(JSON.parse(h.requests.at(-1).options.body).weekId, 1);
  await h.respond(h.requests.at(-1), { week: { analysis: 'Draft', show_analysis: false } });
  h.nodes('select')[1].props.onChange({ target: { value: '2' } }); h.render();
  await h.respond(h.requests.at(-1), h.state(2));
  assert.equal(h.nodes('textarea')[0].props.value, 'Analysis 2');
});

function routeHarness() {
  const tables = { ncaa_pickem_weeks: [{ id: 1, league_id: 'a', season: 2026, week_number: 1, status: 'locked', lock_at: '2026-09-05T00:00Z', analysis: 'History' }, { id: 9, league_id: 'b', season: 2026, week_number: 2, status: 'locked' }], ncaa_pickem_games: [{ week_id: 1, espn_event_id: 'historic', included: true, away_score: 42 }] };
  const db = { from(table) {
    const filters = []; let operation, payload, single = false;
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; }, order() { return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      insert(p) { operation = 'insert'; payload = p; return q; }, update(p) { operation = 'update'; payload = p; return q; }, upsert(p) { operation = 'upsert'; payload = p; return q; },
      then(resolve, reject) {
        let rows = tables[table].filter(r => filters.every(f => f(r)));
        if (operation === 'insert') { const row = { id: 20, ...payload }; tables[table].push(row); rows = [row]; }
        if (operation === 'update') rows.forEach(r => Object.assign(r, payload));
        if (operation === 'upsert') for (const row of payload) { const existing = tables[table].find(r => r.week_id === row.week_id && r.espn_event_id === row.espn_event_id); if (existing) Object.assign(existing, row); else tables[table].push({ ...row }); }
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    }; return q;
  } };
  let rank = 10;
  const provider = { fetchNcaaPickEmWeek: async ({ season, week }) => {
    assert.equal(season, 2026); assert.equal(week, 2);
    const team = (id, rank) => ({ id, displayName: id, rank, abbreviation: id, logo: null, record: null, score: null });
    const games = [{ espnEventId: 'optional', kickoffAt: '2026-09-13T12:00Z', awayTeam: team('a', rank), homeTeam: team('b', null), status: 'pre', completed: false, odds: null }, { espnEventId: 'automatic', kickoffAt: '2026-09-13T13:00Z', awayTeam: team('c', 2), homeTeam: team('d', 3), status: 'pre', completed: false, odds: null }];
    return { season, week, label: `Week ${week}`, scheduleGames: games, eligibleGames: [games[1]], diagnostics: {} };
  } };
  const route = load('app/api/admin/ncaa-pickem/import-week/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'user' }) }, '@/lib/ncaaPickEm/access': { getNcaaPickEmAccess: async () => ({ league: { id: 'a' }, context: { canAdministerGroup: true } }) },
    '@/lib/supabaseAdmin': { supabaseAdmin: db }, '@/lib/providers/ncaa': provider,
    '@/lib/ncaaPickEm/odds': load('lib/ncaaPickEm/odds.ts'), '@/lib/ncaaPickEm/gameSelection': load('lib/ncaaPickEm/gameSelection.ts'), '@/lib/ncaaPickEm/weekSetup': { ...setup, fetchNcaaSetupScoreboard: async () => calendar },
  });
  return { tables, route, unrank: () => { rank = null; }, post: includedEventIds => route.POST({ json: async () => ({ season: 2026, week: 2, ...(includedEventIds === undefined ? {} : { includedEventIds }) }) }) };
}
test('future import/refresh preserves selected unranked games in POST and GET; other weeks and Groups remain untouched', async () => {
  const h = routeHarness();
  const history = JSON.stringify(h.tables);
  let result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(result.body.week, 2);
  result = await h.post(['optional', 'automatic']);
  assert.equal(result.body.games.find(g => g.espnEventId === 'optional').commissionerSelected, true);
  h.unrank();
  result = await h.post();
  assert.equal(result.body.games.find(g => g.espnEventId === 'optional').included, true);
  const read = await h.route.GET({ url: 'http://localhost/?season=2026&week=2' });
  assert.equal(read.body.games.find(g => g.espnEventId === 'optional').included, true);
  result = await h.post(read.body.games.filter(g => g.included).map(g => g.espnEventId));
  assert.equal(result.body.games.find(g => g.espnEventId === 'optional').included, true);
  assert.equal(JSON.stringify({ ncaa_pickem_weeks: h.tables.ncaa_pickem_weeks.filter(w => w.id !== 20), ncaa_pickem_games: h.tables.ncaa_pickem_games.filter(g => g.week_id !== 20) }), history);
  await h.post(['automatic']);
  assert.equal(h.tables.ncaa_pickem_games.find(g => g.espn_event_id === 'optional').included, false);
});

test('options endpoint reads only this Group’s saved weeks', async () => {
  const h = routeHarness();
  h.tables.ncaa_pickem_weeks.push({ id: 30, league_id: 'b', season: 2024, week_number: 1 });
  const result = await h.route.GET({ url: 'http://localhost/?options=1' });
  assert.equal(result.status, 200);
  assert.deepEqual(Array.from(result.body.seasons), [2026]);
  assert.equal(result.body.week, 2);
});
test('season switching fetches that season’s options before its saved state', async () => {
  const h = pageHarness(); h.render();
  await h.respond(h.requests[0], { seasons: [2026, 2025], season: 2026, weeks: [1, 2], week: 2 });
  await h.respond(h.requests[1], h.state(2));
  h.nodes('select')[0].props.onChange({ target: { value: '2025' } }); h.render();
  assert.match(h.requests.at(-1).url, /options=1&season=2025/);
  assert.equal(h.nodes('textarea').length, 0);
  await h.respond(h.requests.at(-1), { seasons: [2026, 2025], season: 2025, weeks: [1, 2, 3], week: 3 });
  assert.match(h.requests.at(-1).url, /season=2025&week=3/);
  await h.respond(h.requests.at(-1), { ...h.state(3), season: 2025 });
  assert.equal(h.nodes('select')[0].props.value, '2025');
  assert.equal(h.nodes('textarea')[0].props.value, 'Analysis 3');
});
test('access errors do not expose an Import action', async () => {
  const h = pageHarness(); h.render();
  await h.respond(h.requests[0], { seasons: [2026], season: 2026, weeks: [1, 2], week: 2 });
  await h.respond(h.requests[1], { error: "NCAA Pick 'Em is not enabled for this Group." }, 404);
  assert.equal(h.nodes('button')[0].props.disabled, true);
  assert.notEqual(h.text(h.nodes('button')[0]), 'Import Week from ESPN');
});
