/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(file, mocks = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', source)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load(path.join(process.cwd(), `${name.slice(2)}.ts`), mocks);
    return require(name);
  }, exports);
  return exports;
}

const next = { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
function database(tables) {
  const reads = [], writes = [];
  return { reads, writes, from(table) {
    reads.push(table);
    let rows = [...(tables[table] ?? [])], single = false;
    const q = {
      select() { return q; },
      eq(key, value) { rows = rows.filter(r => r[key] === value); return q; },
      is(key, value) { rows = rows.filter(r => r[key] === value); return q; },
      in(key, values) { rows = rows.filter(r => values.includes(r[key])); return q; },
      order(key, { ascending }) { rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1)); return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      update(value) { writes.push([table, value]); return q; },
      then(resolve) { resolve({ data: single ? rows[0] ?? null : rows, error: null }); },
    };
    return q;
  } };
}

function fixture({ superAdmin = false, loggedIn = true } = {}) {
  const tables = {
    leagues: [
      { id: 'nba-a', group_id: 'a', sport_key: 'nba', is_enabled: true },
      { id: 'nfl-a', group_id: 'a', sport_key: 'nfl', is_enabled: true },
      { id: 'nfl-b', group_id: 'b', sport_key: 'nfl', is_enabled: true },
    ],
    slates: [
      { id: 149, sport: 'nba', league_id: 'nba-a', date: '2026-05-25', start_date: '2026-05-25', end_date: '2026-05-26', archived_at: null, is_locked: false, rules_snapshot: null, nba_team_abbreviations: ['DEN'] },
      { id: 190, sport: 'nfl', league_id: 'nfl-a', date: '2026-10-01', start_date: '2026-10-01', end_date: '2026-10-05', display_name: '2026 Week 4', archived_at: null, is_locked: false, rules_snapshot: null, nba_team_abbreviations: [] },
      { id: 191, sport: 'nfl', league_id: 'nfl-b', archived_at: null },
      { id: 192, sport: 'nfl', league_id: 'nfl-a', archived_at: '2026-09-01', date: '2026-08-01' },
    ],
    teams: [{ id: 1, group_id: 'a', user_id: 'owner', name: 'Owner' }],
    group_memberships: [{ group_id: 'a', user_id: 'owner', is_active: true }],
    players: [{ id: 1, name: 'Aaron Gordon', position_group: 'F/C', nba_player_id: 203932, is_active: true, team_abbreviation: 'DEN' }],
    players_nfl: [{ id: 1, name: 'A.J. Brown', position: 'WR', nfl_player_id: 4047646, is_active: true }],
    player_slate_stats: [{ slate_id: 149, player_id: 1, fantasy_points: 20 }],
    player_nfl_slate_stats: [{ slate_id: 190, player_id: 1, fantasy_points: 30 }],
    lineups: [], team_slate_results: [], slate_teams: [],
  };
  const db = database(tables), accessLookups = [];
  const user = loggedIn ? { id: 'owner', role: 'player', systemRole: superAdmin ? 'super_admin' : 'user' } : null;
  const group = { group: { id: 'a' }, team: { id: 1 }, leagues: tables.leagues.filter(l => l.group_id === 'a').map(l => ({ id: l.id, sportKey: l.sport_key, isEnabled: l.is_enabled })), canAdministerGroup: false };
  const mocks = {
    'next/server': next,
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/auth': { getCurrentUser: async () => user },
    '@/lib/groups/context': {
      getGroupContextForUser: async () => group,
      getActiveLeagueForSport: async (_user, sport) => {
        const league = tables.leagues.find(l => l.group_id === 'a' && l.sport_key === sport && l.is_enabled);
        return league ? { context: group, league } : null;
      },
      getActiveSlateAccessForUser: async (_user, id) => {
        accessLookups.push(id);
        const slate = tables.slates.find(s => s.id === id);
        const league = tables.leagues.find(l => l.id === slate?.league_id && l.group_id === 'a' && l.is_enabled && l.sport_key === slate?.sport);
        return league ? { context: group, league, slate: { id, sport: slate.sport, rulesSnapshot: slate.rules_snapshot } } : null;
      },
      teamBelongsToGroup: async (id, groupId) => tables.teams.some(t => t.id === id && t.group_id === groupId),
    },
    '@/lib/lineups/draftProjections.server': { getDraftProjectionsForSlate: async slate => ({ sport: slate.sport, projections: { 1: { projection: 10 } } }) },
    '@/lib/lineups/draftHistory.server': { readDraftHistory: async () => ({ available: true, picks: [], corrections: [], turn: { state: 'empty' } }) },
    '@/lib/draftNotifications': { notifyNextDrafter: async () => assert.fail('unexpected notification') },
    '@/lib/playerProjections': {},
  };
  return { tables, db, mocks, accessLookups };
}

function Builder() {}
const marker = fn => ({ __esModule: true, default: fn });
function page(f) {
  return load('app/lineups/draft/page.tsx', { ...f.mocks,
    'next/navigation': { redirect: url => { throw Object.assign(new Error('redirect'), { url }); } },
    '@/components/AppNav': marker(function Nav() {}),
    '@/components/lineups/LineupBuilder': marker(Builder),
    '@/components/lineups/GolfSalaryCapBuilder': marker(function Golf() {}),
  }).default;
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
async function propsFor(f, search) {
  const tree = await page(f)({ searchParams: Promise.resolve(search) });
  return nodes(tree).find(n => n.type === Builder).props;
}

for (const [sport, id, name] of [['nfl', 190, 'A.J. Brown'], ['nba', 149, 'Aaron Gordon']]) {
  test(`legacy ${sport} link canonicalizes the authorized slate and loads its named pool`, async () => {
    const f = fixture();
    await assert.rejects(page(f)({ searchParams: Promise.resolve({ slateId: String(id) }) }), error => error.url === `/lineups/draft?sport=${sport}&slateId=${id}`);
    assert.deepEqual(f.accessLookups, [id]);
    const p = await propsFor(f, { sport, slateId: String(id) });
    assert.equal(p.sport, sport); assert.equal(p.initialSelectedSlateId, id);
    assert.deepEqual(p.players.map(p => p.name), [name]);
    assert.ok(p.slates.every(s => s.sport === sport));
    assert.equal(p.slates.find(s => s.id === id).rules_snapshot, null);
  });
  test(`explicit ${sport} rejects the other sport's slate and retains its own pool`, async () => {
    const f = fixture(), other = sport === 'nfl' ? 149 : 190;
    const p = await propsFor(f, { sport, slateId: String(other) });
    assert.equal(p.sport, sport); assert.equal(p.initialSelectedSlateId, id);
    assert.deepEqual(p.players.map(p => p.name), [name]);
    assert.deepEqual(f.accessLookups, []);
  });
}
test('legacy links never infer a wrong-Group slate, including for Super Admin; invalid/unavailable IDs retain defaults', async () => {
  for (const superAdmin of [false, true]) for (const id of ['191', '192', '999', 'bad', '-1', '1.5', '1e2', '9007199254740993']) {
    const f = fixture({ superAdmin }), p = await propsFor(f, { slateId: id });
    assert.equal(p.sport, 'nba'); assert.equal(p.initialSelectedSlateId, 149);
    assert.ok(p.slates.every(s => s.league_id === undefined && s.sport === 'nba'));
    if (!/^\d+$/.test(id) || id === '9007199254740993') assert.deepEqual(f.accessLookups, []);
  }
});
test('explicit NFL stays NFL when its requested slate is unavailable, archived, or belongs to another Group', async () => {
  for (const slateId of ['191', '192', '999', 'bad']) {
    const p = await propsFor(fixture(), { sport: 'nfl', slateId });
    assert.equal(p.initialSelectedSlateId, 190); assert.deepEqual(p.players.map(p => p.name), ['A.J. Brown']);
  }
});
test('valid Draft retains frozen roster rules and active-Group slate participants', async () => {
  const f = fixture();
  const snapshot = { sport: 'nfl', roster: { slots: [{ position: 'QB', slotCount: 2 }, { position: 'WR', slotCount: 2 }] } };
  f.tables.slates.find(s => s.id === 190).rules_snapshot = snapshot;
  f.tables.slate_teams.push({ slate_id: 190, team_id: 1, is_participating: true, draft_order: 1 });
  const p = await propsFor(f, { sport: 'nfl', slateId: '190' });
  assert.deepEqual(p.teams.map(t => t.id), [1]);
  assert.deepEqual(p.slates.find(s => s.id === 190).rules_snapshot, snapshot);
  assert.equal(p.rosterSlots.find(s => s.position === 'QB').slot_count, 2);
});

test('AppNav links use explicit route sport while the provider still remembers another sport', () => {
  for (const routeSport of ['nba', 'nfl']) {
    const nav = load('components/AppNav.tsx', {
      react: { ...require('react'), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: value => ({ current: value }), useEffect() {} },
      'next/navigation': { usePathname: () => '/home', useSearchParams: () => new URLSearchParams({ sport: routeSport }), useRouter: () => ({}) },
      '@/components/MobileAccountMenu': marker(function Menu() {}), '@/components/theme/DarkModeToggle': marker(function Theme() {}),
      '@/components/providers/SportProvider': { useSelectedSport: () => ({ selectedSport: routeSport === 'nba' ? 'nfl' : 'nba', setSelectedSport() {} }) },
      '@/components/providers/GroupProvider': { useGroupContext: () => ({ groupContext: {
        group: { id: 'a', name: 'A', slug: 'a' }, membership: { role: 'member' },
        leagues: ['nba', 'nfl'].map(sportKey => ({ sportKey, isEnabled: true })),
      }, availableGroups: [], isLoading: false, isSwitchingGroup: false }) },
    }).default;
    const child = nav().props.children;
    const links = nodes(child.type(child.props)).filter(n => typeof n.props?.href === 'string').map(n => n.props.href);
    assert.ok(links.includes(`/lineups/draft?sport=${routeSport}`));
    assert.ok(links.includes(`/lineups/scores?sport=${routeSport}`));
    assert.ok(!links.some(href => /slateId/.test(href)));
  }
});

const endpoints = ['player-stats', 'slate-availability', 'draft-projections', 'lineups', 'team-results'];
for (const endpoint of endpoints) test(`${endpoint}: expected sport is enforced after authorization; omission is compatible`, async () => {
  const f = fixture(), route = load(`app/api/${endpoint}/route.ts`, f.mocks);
  const get = (id, sport) => route.GET({ nextUrl: new URL(`http://test/api/${endpoint}?slateId=${id}${sport === undefined ? '' : `&sport=${sport}`}`), headers: new Headers() });
  for (const [sport, id, other] of [['nba', 149, 190], ['nfl', 190, 149]]) {
    const valid = await get(id, sport);
    assert.equal(valid.status, 200); assert.equal(valid.body.sport, sport);
    assert.equal(valid.body.slateId, id); assert.equal(valid.body.groupId, 'a');
    assert.equal((await get(other, sport)).status, 404);
    assert.equal((await get(id)).status, 200);
  }
  assert.equal((await get(191, 'nba')).status, 404);
  assert.equal((await get(191, 'nfl')).status, 404);
  assert.equal((await get(149, 'unknown')).status, 400);
  assert.deepEqual(f.db.writes, []);
});
test('expected-sport validation preserves Super Admin target access and still rejects sport mismatches', async () => {
  const f = fixture({ superAdmin: true }), auth = load('lib/security/resourceAuthorization.ts', f.mocks);
  const request = { headers: new Headers() };
  assert.equal((await auth.authorizeSlateResource(request, 191, { expectedSport: 'nfl' })).ok, true);
  assert.equal((await auth.authorizeSlateResource(request, 191, { expectedSport: 'nba' })).response.status, 404);
  f.tables.slates[0].sport = 'nfl';
  assert.equal((await auth.authorizeSlateResource(request, 149, { expectedSport: 'nfl' })).response.status, 404);
});
test('lineup mutations reject cross-sport context before any writes or player lookup', async () => {
  for (const [sport, slateId] of [['nfl', 149], ['nba', 190]]) {
    const f = fixture(), route = load('app/api/lineups/route.ts', f.mocks);
    const result = await route.POST({ json: async () => ({ sport, slateId, teamId: 1, playerIds: [1] }) });
    assert.equal(result.status, 404); assert.deepEqual(f.db.writes, []);
    assert.ok(!f.db.reads.includes('players') && !f.db.reads.includes('players_nfl'));
  }
});

test('notification retries reconstruct NBA/NFL/Golf sport from the authorized resource, not stale metadata', async () => {
  for (const sport of ['nba', 'nfl', 'golf']) for (const notificationType of ['draft_turn', 'draft_final_pick']) {
    for (const withSlate of [true, false]) {
      const tables = { notification_history: [{ id: 'h', league_id: 'l', user_id: 'owner', slate_id: withSlate ? 190 : null, notification_type: notificationType, status: 'failed', metadata: { sport: 'nba' } }],
        slates: [{ id: 190, league_id: 'l', sport, archived_at: null }], leagues: [{ id: 'l', sport_key: sport }] };
      const db = database(tables), sent = [];
      const route = load('app/api/admin/notification-history/action/route.ts', {
        'next/server': next, '@/lib/supabaseAdmin': { supabaseAdmin: db },
        '@/lib/playerFinishedNotifications': {}, '@/lib/requireAdminApi': { requireAdminApi: async () => null },
        '@/lib/notificationHistoryScope': { canOperateNotificationLeague: async () => true },
        '@/lib/push': { sendPushToUser: async (_user, payload) => { sent.push(payload); return { sent: 1, failed: 0, devices: [] }; } },
      });
      assert.equal((await route.POST({ json: async () => ({ action: 'retry', historyId: 'h' }) })).status, 200);
      assert.equal(sent[0].url, `/lineups/draft?sport=${sport}${withSlate ? '&slateId=190' : ''}`);
    }
  }
});
test('retry denies inaccessible or unavailable Draft context without sending or updating history', async () => {
  for (const allowed of [true, false]) {
    const db = database({ notification_history: [{ id: 'h', league_id: 'l', user_id: 'owner', slate_id: 999, notification_type: 'draft_turn', status: 'failed' }] });
    const route = load('app/api/admin/notification-history/action/route.ts', {
      'next/server': next, '@/lib/supabaseAdmin': { supabaseAdmin: db }, '@/lib/playerFinishedNotifications': {},
      '@/lib/requireAdminApi': { requireAdminApi: async () => null },
      '@/lib/notificationHistoryScope': { canOperateNotificationLeague: async () => allowed },
      '@/lib/push': { sendPushToUser: async () => assert.fail('must not send') },
    });
    assert.equal((await route.POST({ json: async () => ({ action: 'retry', historyId: 'h' }) })).status, allowed ? 409 : 403);
    assert.deepEqual(db.writes, []);
    if (!allowed) assert.ok(!db.reads.includes('slates'));
  }
});
