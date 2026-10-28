/* eslint-disable @typescript-eslint/no-require-imports */
// Actual application modules, isolated auth/database fixtures, and no network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
global.fetch = async () => { throw Error('NETWORK FORBIDDEN in NFL catalog tests'); };

function load(file, mocks, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
      return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx', mocks, cache);
    }
    if (['react/jsx-runtime', 'next/server'].includes(name)) return require(name);
    throw Error(`Unmocked dependency: ${name}`);
  }, exports);
  return exports;
}

const tail = ['Will Howard', 'Will Kacmarek', 'Will Levis', 'Will Mallory', 'Will Pauling', 'Will Reichard',
  'Will Sheppard', 'Will Shipley', 'Woody Marks', 'WSH D/ST', 'Xavier Gipson', 'Xavier Guillory',
  'Xavier Hutchinson', 'Xavier Johnson', 'Xavier Legette', 'Xavier Loyd', 'Xavier Restrepo', 'Xavier Smith',
  'Xavier Weaver', 'Xavier Worthy', 'Zach Charbonnet', 'Zach Horton', 'Zach Wilson', 'Zachariah Branch',
  'Zack Kuntz', 'Zaire Mitchell-Paden', 'Zamir White', 'Zavier Scott', 'Zavion Thomas', 'Zay Flowers', 'Zay Jones'];
function catalog() {
  return [...Array.from({ length: 1000 }, (_, i) => ({ id: 10000 + i, name: `A Player ${String(i).padStart(4, '0')}` })),
    ...tail.map((name, i) => ({ id: name === 'Zay Flowers' ? 60 : 20000 + i, name }))]
    .map(p => ({ ...p, nfl_player_id: p.id === 60 ? 4429615 : p.id + 1000000,
      position: 'WR', team_abbreviation: 'BAL', is_active: true, is_playing_this_week: false }));
}
function database(tables, { cap = 1000, failureOffset = null, throws = false } = {}) {
  const calls = [], writes = [];
  return { calls, writes, from(table) {
    const call = { table, orders: [], filters: [], range: null }; calls.push(call);
    let values = [...(tables[table] ?? [])], single = false, mutation = false;
    const q = {
      select(columns) { call.columns = columns; return q; },
      eq(key, value) { call.filters.push([key, value]); values = values.filter(r => r[key] === value); return q; },
      is(key, value) { return q.eq(key, value); },
      in(key, list) { values = values.filter(r => list.includes(r[key])); return q; },
      order(key, options) { call.orders.push([key, options.ascending]); return q; },
      range(from, to) { call.range = [from, to]; return q; },
      limit(count) { values = values.slice(0, count); return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      upsert(rows, options) { writes.push({ table, rows, options }); values = rows; mutation = true; return q; },
      insert() { assert.fail('Unexpected insert'); }, update() { assert.fail('Unexpected update'); }, delete() { assert.fail('Unexpected delete'); },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (table === 'players_nfl' && call.range?.[0] === failureOffset) {
            if (throws) throw Error('connection lost');
            return { data: null, error: { message: 'page unavailable' } };
          }
          const rows = [...values].sort((a, b) => {
            for (const [key, ascending] of call.orders) {
              const cmp = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
              if (cmp) return cmp * (ascending ? 1 : -1);
            }
            return 0;
          });
          const from = call.range?.[0] ?? 0, size = call.range ? call.range[1] - from + 1 : cap;
          const data = single ? rows[0] ?? null : mutation ? rows : rows.slice(from, from + Math.min(size, cap));
          return { data, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
}
const next = { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, headers: options?.headers }) } };
function helper(db) {
  return load('lib/nfl/playerCatalog.server.ts', { '@/lib/supabaseAdmin': { supabaseAdmin: db } }).loadNflPlayers;
}
test('all 1,031 active players survive the 1,000-row cap, including Flowers and the entire alphabetical tail', async () => {
  const players = catalog(), db = database({ players_nfl: [...players].reverse() });
  const result = await helper(db)('id, name, nfl_player_id', { activeOnly: true });
  assert.equal(result.error, null); assert.equal(result.data.length, 1031);
  assert.deepEqual(result.data.slice(1000).map(p => p.name), [...tail].sort());
  assert.equal(result.data.find(p => p.name === 'Zay Flowers').id, 60);
  assert.equal(result.data.find(p => p.id === 60).nfl_player_id, 4429615);
  assert.ok(db.calls.every(c => JSON.stringify(c.orders) === JSON.stringify([['name', true], ['id', true]])));
  assert.deepEqual(db.writes, []);
});
test('pagination handles lower response caps, exact page multiples, empty catalogs, and duplicate names', async () => {
  for (const size of [0, 500, 1000, 1031]) {
    const rows = catalog().slice(0, size).map(p => ({ ...p, name: 'Same Name' })).reverse();
    const db = database({ players_nfl: rows }, { cap: 200 });
    const { data, error } = await helper(db)('id, name');
    assert.equal(error, null); assert.equal(data.length, size);
    assert.deepEqual(data.map(p => p.id), rows.map(p => p.id).sort((a, b) => a - b));
  }
});
test('active-only browsing excludes inactive records while historical/admin/sync reads preserve them', async () => {
  const db = database({ players_nfl: [...catalog(), { id: 99, name: 'ZZ Retired', is_active: false }] });
  assert.equal((await helper(db)('id', { activeOnly: true })).data.length, 1031);
  assert.equal((await helper(db)('id')).data.length, 1032);
});
test('any failed page discards the partial catalog and reports its offset', async () => {
  for (const throws of [false, true]) for (const failureOffset of [0, 500, 1000]) {
    const db = database({ players_nfl: catalog() }, { failureOffset, throws });
    const result = await helper(db)('id');
    assert.equal(result.data, null); assert.match(result.error.message, new RegExp(`offset ${failureOffset}:`));
    assert.deepEqual(db.writes, []);
  }
});

function Builder() {}
const marker = fn => ({ __esModule: true, default: fn });
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
function fixture(options) {
  const snapshot = { sport: 'nfl', schemaVersion: 1, draft: { type: 'snake' },
    roster: { slots: [{ position: 'WR', slotCount: 2 }, { position: 'FLEX', slotCount: 1 }] }, scoring: { receptions: 0.5 } };
  const slate = { id: 196, sport: 'nfl', league_id: 'league-a', date: '2026-10-29', start_date: '2026-10-29',
    end_date: '2026-11-02', archived_at: null, is_locked: false, rules_snapshot: snapshot, nba_team_abbreviations: [] };
  const tables = { players_nfl: [...catalog(), { id: 99, name: 'ZZ Retired', position: 'WR', is_active: false }], slates: [slate],
    teams: [{ id: 1, name: 'Team', user_id: 'user', group_id: 'group-a' }],
    group_memberships: [{ user_id: 'user', group_id: 'group-a', is_active: true }],
    slate_teams: [{ slate_id: 196, team_id: 1, draft_order: 1, is_participating: true }],
    lineups: [{ id: 9, slate_id: 196, team_id: 1, lineup_players: [{ player_id: 60 }] }],
    player_nfl_slate_stats: [{ slate_id: 196, player_id: 60, fantasy_points: 17.3 }], team_slate_results: [] };
  const db = database(tables, options);
  const mocks = { 'next/server': next, '@/lib/supabaseAdmin': { supabaseAdmin: db },
    'next/navigation': { redirect() { assert.fail('Unexpected redirect'); } },
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'user', teamId: 1 }) },
    '@/lib/groups/context': { getActiveLeagueForSport: async () => ({ context: { group: { id: 'group-a' } }, league: { id: 'league-a' } }) },
    '@/lib/fantasyTeamIdentity': { loadFantasyTeamAvatars: async () => new Map() },
    '@/lib/requireAdminApi': { requireSuperAdminApi: async () => null },
    '@/components/AppNav': marker(function Nav() {}), '@/components/lineups/LineupBuilder': marker(Builder),
    '@/components/lineups/SlateViewingBoundary': marker(function Boundary() {}), '@/components/lineups/GolfSalaryCapBuilder': marker(function Golf() {}),
    '@/lib/security/resourceAuthorization': { authorizeSlateResource: async () => ({ ok: true, target: { groupId: 'group-a', sportKey: 'nfl' } }) },
  };
  return { db, mocks, tables, snapshot, slate };
}
for (const page of ['draft', 'scores']) test(`${page} server page receives the complete pool and preserves saved selections, identities, stats and frozen rules`, async () => {
  const f = fixture();
  const tree = await load(`app/lineups/${page}/page.tsx`, f.mocks).default({ searchParams: Promise.resolve({ sport: 'nfl', slateId: '196' }) });
  const props = nodes(tree).find(n => n.type === Builder)?.props;
  assert.ok(props, 'page must render the builder');
  assert.equal(props.players.length, page === 'draft' ? 1031 : 1032);
  assert.deepEqual(props.players.filter(p => tail.includes(p.name)).map(p => p.name), [...tail].sort());
  assert.equal(props.players.find(p => p.id === 60).nfl_player_id, 4429615);
  assert.deepEqual(props.savedLineupsForInitialSlate.map(({ team_id, player_ids }) => ({ team_id, player_ids })), [{ team_id: 1, player_ids: [60] }]);
  assert.deepEqual(props.slates[0].rules_snapshot, f.snapshot);
  assert.equal(props.playerStats[0].fantasy_points, 17.3);
  assert.deepEqual(f.db.writes, []);
});
for (const page of ['draft', 'scores']) test(`${page} server page explicitly refuses to render a partial pool`, async () => {
  const f = fixture({ failureOffset: 1000 });
  const tree = await load(`app/lineups/${page}/page.tsx`, f.mocks).default({ searchParams: Promise.resolve({ sport: 'nfl', slateId: '196' }) });
  assert.ok(!nodes(tree).some(n => n.type === Builder));
  assert.match(JSON.stringify(tree), /offset 1000/);
});
test('NFL admin API returns the full catalog including inactive history and fails explicitly on a later page', async () => {
  for (const failureOffset of [null, 1000]) {
    const f = fixture({ failureOffset });
    const result = await load('app/api/admin/players-nfl/route.ts', f.mocks).GET();
    assert.equal(result.status, failureOffset === null ? 200 : 500);
    if (failureOffset === null) {
      assert.equal(result.body.players.length, 1032);
      assert.ok(result.body.players.some(p => p.id === 60));
    } else assert.equal(result.body.players, undefined);
    assert.deepEqual(f.db.writes, []);
  }
});
test('sync lookup finds tail players by original identity; a failed page stops before any mocked upsert', async () => {
  for (const failureOffset of [null, 1000]) {
    const f = fixture({ failureOffset }), after = [];
    const route = load('app/api/sync-players-nfl/route.ts', { ...f.mocks,
      'next/server': { ...next, after: callback => after.push(callback) },
      '@/scripts/lib/sportsHeadshotCache': { cacheSportsHeadshots: () => assert.fail('Unexpected headshot work') },
      '@/lib/providers/nfl': { fetchTeams: async () => [{ id: '33', abbreviation: 'BAL' }],
        fetchCurrentWeekTeamAbbreviations: async () => new Set(['BAL']),
        fetchTeamRoster: async () => [{ id: '4429615', displayName: 'Zay Flowers', position: { abbreviation: 'WR' } }] },
    });
    const previous = global.fetch;
    global.fetch = async url => {
      assert.match(String(url), /^https:\/\/sports\.core\.api\.espn\.com\/.*\/teams\/33\/athletes\?limit=100$/);
      return { ok: true, json: async () => ({ items: [] }) };
    };
    try {
      const result = await route.POST(); // Every provider/database operation is an in-memory fake.
      assert.equal(result.status, failureOffset === null ? 200 : 500);
      if (failureOffset === null) {
        const update = f.db.writes.find(w => w.options.onConflict === 'id').rows.find(p => p.nfl_player_id === 4429615);
        assert.equal(update.id, 60);
        assert.ok(f.db.writes.filter(w => w.options.onConflict === 'nfl_player_id').every(w => !w.rows.some(p => p.nfl_player_id === 4429615)));
      } else { assert.deepEqual(f.db.writes, []); assert.equal(after.length, 0); }
    } finally { global.fetch = previous; }
  }
});

function event(id, date, teams = ['BAL', 'BUF']) {
  return { id, date, competitions: [{ status: { type: { state: 'pre' } },
    competitors: teams.map((abbreviation, i) => ({ team: { id: String(i + 1), abbreviation } })) }] };
}
function availability(f, schedule) {
  return load('lib/nfl/slateAvailability.server.ts', { ...f.mocks,
    '@/lib/providers/nfl': { fetchNflScoringSchedule: schedule },
  }).loadNflSlateAvailability;
}
test('NFL slate availability includes Flowers/tail and K/DST, excludes byes/inactive players, and ignores current-week flags', async () => {
  const f = fixture();
  f.tables.players_nfl.push({ id: 30000, name: 'Kicker', position: 'K', team_abbreviation: 'BUF', is_active: true },
    { id: 30001, name: 'Defense', position: 'D/ST', team_abbreviation: 'BAL', is_active: true },
    { id: 30002, name: 'Bye', team_abbreviation: 'KC', is_active: true, is_playing_this_week: true },
    { id: 30003, name: 'Inactive', team_abbreviation: 'BAL', is_active: false });
  const result = await availability(f, async (start, end) => {
    assert.equal(start, '20261029'); assert.equal(end, '20261102');
    return [event('week8', '2026-11-01T18:00:00Z'), event('outside', '2026-11-05T18:00:00Z', ['KC', 'DEN'])];
  })(f.slate);
  assert.equal(result.availablePlayerIds.length, 1033);
  for (const id of [60, 30000, 30001]) assert.ok(result.availablePlayerIds.includes(id));
  for (const id of [99, 30002, 30003]) assert.ok(!result.availablePlayerIds.includes(id));
  assert.deepEqual(result.teamAbbreviations, ['BAL', 'BUF']); assert.deepEqual(f.db.writes, []);
});
test('availability uses Eastern date boundaries, legacy single-date fallback, and a fresh window for each selected slate', async () => {
  const f = fixture(), read = availability(f, async () => [event('monday', '2026-11-03T01:15:00Z')]);
  assert.ok((await read(f.slate)).availablePlayerIds.includes(60));
  assert.equal((await read({ date: '2026-11-03' })).availablePlayerIds.length, 0);
  assert.ok((await read({ date: '2026-11-02' })).availablePlayerIds.includes(60));
  await assert.rejects(read({ date: '2026-02-30' }), /Invalid NFL slate/);
  await assert.rejects(read({ ...f.slate, end_date: '2026-10-01' }), /Invalid NFL slate/);
});
test('a successful empty schedule is empty availability; schedule/page failures are errors', async () => {
  const f = fixture();
  assert.deepEqual((await availability(f, async () => [])(f.slate)).availablePlayerIds, []);
  await assert.rejects(availability(f, async () => { throw Error('schedule unavailable'); })(f.slate), /schedule unavailable/);
  const broken = fixture({ failureOffset: 1000 });
  await assert.rejects(availability(broken, async () => [event('game', '2026-11-01T18:00:00Z')])(broken.slate), /offset 1000/);
});
test('availability route preserves authorization/context, branches on NFL, and returns 502 for unavailable data', async () => {
  for (const fails of [false, true]) {
    const f = fixture(), calls = [];
    const route = load('app/api/slate-availability/route.ts', { ...f.mocks,
      '@/lib/nfl/slateAvailability.server': { loadNflSlateAvailability: async slate => {
        calls.push(slate.id); if (fails) throw Error('schedule unavailable');
        return { start: slate.start_date, end: slate.end_date, teamAbbreviations: ['BAL'], availablePlayerIds: [60] };
      } },
    });
    const result = await route.GET({ nextUrl: new URL('http://test/?slateId=196&sport=nfl') });
    assert.equal(result.status, fails ? 502 : 200); assert.deepEqual(calls, [196]);
    assert.match(result.headers['Cache-Control'], /no-store/);
    if (!fails) { assert.deepEqual(result.body.availablePlayerIds, [60]); assert.equal(result.body.groupId, 'group-a'); assert.equal(result.body.sport, 'nfl'); }
    else assert.equal(result.body.availablePlayerIds, undefined);
    assert.ok(f.db.calls.every(c => c.table === 'slates')); assert.deepEqual(f.db.writes, []);
  }
});
test('NFL availability API joins the complete catalog to daily provider schedule reads for the selected window', async () => {
  const f = fixture(), requested = [], previous = global.fetch;
  global.fetch = async url => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://site.api.espn.com');
    const date = parsed.searchParams.get('dates'); requested.push(date);
    return { ok: true, json: async () => ({ events: date === '20261102' ? [event('monday', '2026-11-03T01:15:00Z')] : [] }) };
  };
  try {
    const result = await load('app/api/slate-availability/route.ts', f.mocks).GET({ nextUrl: new URL('http://test/?slateId=196&sport=nfl') });
    assert.equal(result.status, 200); assert.equal(result.body.availablePlayerIds.length, 1031);
    assert.ok(result.body.availablePlayerIds.includes(60));
    assert.deepEqual(requested, ['20261029', '20261030', '20261031', '20261101', '20261102']);
    assert.ok(f.db.calls.every(c => ['slates', 'players_nfl'].includes(c.table))); assert.deepEqual(f.db.writes, []);
  } finally { global.fetch = previous; }
});
test('NBA aliases and Golf event-player availability retain their existing sources without NFL provider work', async () => {
  for (const sport of ['nba', 'golf']) {
    const f = fixture(); f.slate.sport = sport; f.slate.nba_team_abbreviations = ['PHO', 'NY'];
    f.mocks['@/lib/security/resourceAuthorization'] = { authorizeSlateResource: async () => ({ ok: true, target: { groupId: 'group-a', sportKey: sport } }) };
    f.tables.players = [{ id: 1, team_abbreviation: 'PHX', is_active: true }, { id: 2, team_abbreviation: 'NYK', is_active: true }, { id: 3, team_abbreviation: 'BAL', is_active: true }];
    f.tables.golf_event_players = [{ slate_id: 196, player_id: 8 }, { slate_id: 200, player_id: 9 }];
    const result = await load('app/api/slate-availability/route.ts', f.mocks).GET({ nextUrl: new URL(`http://test/?slateId=196&sport=${sport}`) });
    assert.equal(result.status, 200); assert.deepEqual(result.body.availablePlayerIds, sport === 'nba' ? [1, 2] : [8]);
    assert.ok(f.db.calls.every(c => c.table !== 'players_nfl')); assert.deepEqual(f.db.writes, []);
  }
});
