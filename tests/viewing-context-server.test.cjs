/* eslint-disable @typescript-eslint/no-require-imports */
/* Execute real server pages/services with scoped database fixtures, no external writes. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'server-only') return {};
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
      return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`, mocks);
    }
    return require(name);
  }, exports);
  return exports;
}
const marker = fn => ({ __esModule: true, default: fn });
function Builder() {} function Boundary() {} function Salary() {}
function fixture() {
  const tables = { slates: ['nba', 'nfl', 'golf'].flatMap((sport, i) => [
    { id: (i + 1) * 100, sport, league_id: `${sport}-a`, date: '2026-10-01', start_date: '2026-10-01', end_date: '2026-10-05', is_locked: true, archived_at: null, rules_snapshot: null, display_name: sport === 'golf' ? 'TOUR Championship' : null },
    { id: (i + 1) * 100 + 1, sport, league_id: `${sport}-a`, date: '2026-08-01', start_date: '2026-08-01', end_date: '2026-08-05', is_locked: true, archived_at: null, rules_snapshot: null, display_name: sport === 'golf' ? 'FedEx St. Jude Championship' : null },
    { id: (i + 1) * 100 + 2, sport, league_id: `${sport}-b`, date: '2026-10-01', archived_at: null },
    { id: (i + 1) * 100 + 3, sport, league_id: `${sport}-a`, date: '2026-10-01', archived_at: '2026-10-01' },
  ]), teams: [{ id: 1, group_id: 'a', user_id: 'owner', name: 'Owner' }], group_memberships: [{ group_id: 'a', user_id: 'owner', is_active: true }], slate_teams: [] };
  const reads = [];
  const db = { from(table) {
    let rows = [...(tables[table] ?? [])], single = false;
    const record = { table, filters: [] }; reads.push(record);
    const query = { select() { return query; },
      eq(key, value) { record.filters.push([key, value]); rows = rows.filter(row => row[key] === value); return query; },
      is(key, value) { rows = rows.filter(row => row[key] === value); return query; },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return query; },
      order(key, { ascending }) { rows.sort((a,b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1)); return query; },
      limit(n) { rows = rows.slice(0,n); return query; }, single() { single = true; return query; }, maybeSingle() { single = true; return query; },
      then(resolve) { resolve({data: single ? rows[0] ?? null : rows, error: null}); },
    }; return query;
  } };
  const group = { group: { id: 'a' }, team: { id: 1 }, canAdministerGroup: false };
  const mocks = {
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'owner' }) },
    '@/lib/groups/context': { getActiveLeagueForSport: async (_user, sport) => ({ context: group, league: { id: `${sport}-a`, settings: {} } }), getActiveSlateAccessForUser: async () => null },
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/components/AppNav': marker(function Nav() {}), '@/components/lineups/LineupBuilder': marker(Builder),
    '@/components/lineups/SlateViewingBoundary': marker(Boundary), '@/components/lineups/GolfSalaryCapBuilder': marker(Salary),
    '@/lib/fantasyTeamIdentity': { loadFantasyTeamAvatars: async () => new Map() },
    '@/lib/golf/fantasy.server': { loadGolfFantasy: async () => null, loadGolfRosters: async () => [] },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    'next/navigation': { redirect() { throw Error('unexpected redirect'); } },
  };
  return { mocks, tables, reads };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
for (const sport of ['nba','nfl','golf']) for (const page of ['draft','scores']) test(`${sport} ${page}: explicit historical resource, wrong sport/Group, archived/malformed URL, and authorized options`, async () => {
  const id = { nba: 100, nfl: 200, golf: 300 }[sport];
  for (const requested of [String(id+1), String(id+2), String(id+3), sport === 'nba' ? '200' : '100', 'oops']) {
    const f = fixture();
    const render = load(`app/lineups/${page}/page.tsx`, f.mocks).default;
    const tree = await render({ searchParams: Promise.resolve({ sport, slateId: requested }) });
    const props = nodes(tree).find(node => node.type === Builder).props;
    assert.ok(props.slates.every(slate => slate.sport === sport));
    assert.deepEqual(new Set(props.slates.map(slate => slate.id)), new Set([id,id+1]));
    assert.ok([id,id+1].includes(props.initialSelectedSlateId));
    if (requested === String(id+1)) assert.equal(props.initialSelectedSlateId, id+1);
    const boundary = nodes(tree).find(node => node.type === Boundary);
    assert.equal(boundary.props.groupId, 'a'); assert.equal(boundary.props.selectedId, props.initialSelectedSlateId);
    for (const read of f.reads.filter(read => ['lineups', 'golf_event_players'].includes(read.table))) {
      for (const [key,value] of read.filters) if (key === 'slate_id') assert.ok([id,id+1].includes(value));
    }
  }
});

test('Golf Home resolves canonical slate IDs against the active League; Live retains existing default even with fantasy ID', async () => {
  for (const requested of [301, 302, 303, 100, null]) {
    const f = fixture();
    const { getGolfHomeSummary } = load('lib/home/golfHomeSummary.ts', f.mocks);
    const response = await getGolfHomeSummary({ requestedSlateId: requested });
    assert.equal(response.status, 200);
    assert.equal(response.body.groupId, 'a'); assert.equal(response.body.sport, 'golf');
    assert.deepEqual(response.body.availableSlates.map(row => row.value), [300,301]);
    assert.equal(response.body.latestSlate.id, requested === 301 ? 301 : 300);
    assert.ok(f.reads.filter(row => row.table === 'golf_event_players').every(row => row.filters.some(([key,id]) => key === 'slate_id' && [300,301].includes(id))));
    const live = await getGolfHomeSummary({ requestedSlateId: 301, liveOnly: true });
    assert.equal(live.body.latestSlate.id, 300);
  }
});


test('Golf Lineup can switch between salary-cap and snake tournament snapshots through the same slate list', async () => {
  const f = fixture();
  f.tables.slates.find(row => row.id === 301).rules_snapshot = { sport: 'golf', draft: { type: 'salary_cap' } };
  const render = load('app/lineups/draft/page.tsx', f.mocks).default;
  for (const id of [301, 300]) {
    const tree = await render({ searchParams: Promise.resolve({ sport: 'golf', slateId: String(id) }) });
    assert.deepEqual(nodes(tree).find(node => node.type === Boundary).props.options.map(row => row.value), [300,301]);
    assert.ok(nodes(tree).some(node => node.type === (id === 301 ? Salary : Builder)));
  }
});

test('Golf Home, Draft and Scores expose identical tournament-name selector labels and safe unnamed fallbacks', async () => {
  const f = fixture();
  f.tables.slates.push({ id: 304, sport: 'golf', league_id: 'golf-a', date: '2026-07-01', start_date: '2026-07-01', end_date: '2026-07-05', archived_at: null, display_name: null, is_locked: true });
  const home = await load('lib/home/golfHomeSummary.ts', f.mocks).getGolfHomeSummary({ requestedSlateId: 301 });
  const expected = home.body.availableSlates;
  assert.deepEqual(expected.slice(0, 2), [
    { value: 300, label: '2026 · TOUR Championship' },
    { value: 301, label: '2026 · FedEx St. Jude Championship' },
  ]);
  assert.match(expected[2].label, /July 1-5, 2026/);
  for (const page of ['draft', 'scores']) {
    const tree = await load(`app/lineups/${page}/page.tsx`, f.mocks).default({ searchParams: Promise.resolve({ sport: 'golf', slateId: '301' }) });
    assert.deepEqual(nodes(tree).find(node => node.type === Boundary).props.options, expected);
  }
});
