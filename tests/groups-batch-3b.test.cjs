/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}, extra = '') {
  const module = { exports: {} };
  const code = ts.transpileModule(source(file) + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, Request, console,
    require: (id) => {
      if (id in mocks) return mocks[id];
      throw new Error(`Unexpected import ${id} in ${file}`);
    },
  });
  return module.exports;
}
// In-memory query adapter: every write is captured locally; no database is used.
function database(tables) {
  const calls = [], writes = [];
  return { calls, writes, from(table) {
    let rows = [...(tables[table] ?? [])], single = false;
    const q = {
      select(columns) { calls.push([table, 'select', columns]); return q; },
      eq(key, value) { calls.push([table, 'eq', key, value]); rows = rows.filter(r => r[key] === value); return q; },
      in(key, values) { calls.push([table, 'in', key, values]); rows = rows.filter(r => values.includes(r[key])); return q; },
      lt(key, value) { rows = rows.filter(r => r[key] < value); return q; },
      order(key, { ascending }) { rows.sort((a,b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1)); return q; },
      limit(n) { rows = rows.slice(0,n); return q; },
      range(a,b) { rows = rows.slice(a,b+1); return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      upsert(value) { writes.push(...value); return q; },
      then(resolve, reject) { return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject); },
    }; return q;
  }};
}
const identity = load('lib/fantasyTeamIdentity.ts');
function fixture(sport = 'nba') {
  return {
    slates: [{ id: 1, league_id: 'l1', sport, start_date: '2026-09-01', end_date: '2026-09-01', date: '2026-09-01', rules_snapshot: null }],
    leagues: [{ id: 'l1', group_id: 'g1', sport_key: sport, game_mode: 'standard' }],
    teams: [
      { id: 11, group_id: 'g1', user_id: 'owner', name: 'Owner' },
      { id: 12, group_id: 'g2', user_id: 'other', name: 'Other Group' },
      { id: 13, group_id: 'g1', user_id: 'former', name: 'Former' },
      { id: 14, group_id: 'g1', user_id: 'blank', name: 'No Avatar' },
    ],
    group_memberships: [
      { group_id: 'g1', user_id: 'owner', is_active: true },
      { group_id: 'g1', user_id: 'former', is_active: false },
      { group_id: 'g1', user_id: 'blank', is_active: true },
      { group_id: 'g2', user_id: 'other', is_active: true },
    ],
    app_users: [
      { id: 'owner', team_id: 999, display_name: 'Owner', avatar_url: '/owner.png', is_active: true },
      { id: 'other', team_id: 11, display_name: 'Wrong Legacy Owner', avatar_url: '/wrong.png', is_active: true },
      { id: 'former', team_id: 13, avatar_url: '/former.png', is_active: true },
      { id: 'blank', team_id: null, avatar_url: null, is_active: true },
    ],
    slate_teams: [11,12,13,14].map((id,i) => ({ slate_id: 1, team_id: id, is_participating: true, draft_order: i+1, teams: { name: `Team ${id}` } })),
    notification_preferences: ['owner','other','former','blank'].map(id => ({ user_id: id, notifications_enabled: true, draft_turn_enabled: true, player_finished_enabled: true, slate_final_enabled: true })),
    lineups: [],
  };
}
const next = { NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) } };
function notificationModule(file, db, sends) {
  return load(file, {
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/fantasyTeamIdentity': identity,
    '@/lib/notifications': { sendLoggedNotification: async (input) => { sends.push(input); return { sent: input.skipReason ? 0 : 1, failed: 0, devices: [] }; } },
    '@/lib/notificationTemplates': { renderNotificationTemplate: () => 'Rendered' },
    '@/lib/leagueNotificationSettings': { getLeagueNotificationTemplate: async () => ({ enabled: true, template: {} }) },
    '@/lib/sports': { getSportConfig: () => ({ emoji: '' }) },
    '@/lib/rules/leagueRules': { getRosterSlotsFromRulesSnapshot: () => [{ position: 'UTIL', slot_count: 2 }] },
  });
}
for (const sport of ['nba','nfl']) {
  test(`${sport}: recipients use Group team owners and active slate participation`, async () => {
    const tables = fixture(sport), db = database(tables);
    const recipients = await identity.loadFantasyNotificationRecipients(db, 1, sport, [11,12,13,14]);
    assert.deepEqual(Array.from(recipients, r => r.id), ['owner','blank']);
    assert.equal(db.calls.some(c => c[0] === 'app_users' && ['eq','in'].includes(c[1]) && c[2] === 'team_id'), false);
    tables.slate_teams[0].is_participating = false;
    assert.equal((await identity.loadFantasyNotificationRecipients(database(tables), 1, sport, [11])).length, 0);
    tables.leagues[0].sport_key = 'nba_skins';
    assert.equal((await identity.loadFantasyNotificationRecipients(database(tables), 1, sport, [14])).length, 0);
  });
  test(`${sport}: all three send paths use scoped recipients and retain league history`, async () => {
    const tables = fixture(sport), db = database(tables), sends = [];
    await notificationModule('lib/draftNotifications.ts', db, sends).notifyNextDrafter(1);
    assert.equal(sends[0].userId, 'owner');
    const input = { slate: tables.slates[0], players: [{ id: 7, name: 'Player' }],
      lineups: [{ team_id: 11, lineup_players: [{ player_id: 7 }] }],
      previousStatuses: [], currentStats: [{ player_id: 7, fantasy_points: 15, game_status: 3 }] };
    await notificationModule('lib/playerFinishedNotifications.ts', db, sends).notifyNewlyFinishedPlayers(input);
    await notificationModule('lib/slateCompleteNotifications.ts', db, sends).notifyCompletedSlate({
      slate: tables.slates[0], teamResults: [11,12,13].map((id,i) => ({ team_id: id, finish_position: i+1, fantasy_points: 30-i })) });
    assert.equal(sends.filter(s => s.userId === 'owner').length, 3);
    assert.equal(sends.some(s => s.userId === 'other' || s.userId === 'former'), false);
    assert.equal(sends.every(s => s.leagueId === 'l1'), true);
    assert.equal(sends.filter(s => s.skipReason).length, 2);
    tables.notification_preferences[0].draft_turn_enabled = false;
    const before = sends.length;
    await notificationModule('lib/draftNotifications.ts', db, sends).notifyNextDrafter(1);
    assert.equal(sends.length, before);
  });
  test(`${sport}: profile history excludes another league, retains inactive results`, async () => {
    const tables = fixture(sport);
    tables.slates.push({ id: 2, league_id: 'l2', sport, start_date: '2026-09-02' });
    tables.lineups = [{ id: 101, slate_id: 1, team_id: 13 }, { id: 102, slate_id: 2, team_id: 12 }];
    tables.lineup_players = [101,102].map(id => ({ lineup_id: id, player_id: 7 }));
    tables.team_slate_results = [{ slate_id: 1, team_id: 13, finish_position: 1 }, { slate_id: 2, team_id: 12, finish_position: 1 }];
    tables[sport === 'nba' ? 'players' : 'players_nfl'] = [{ id: 7, name: 'Player' }];
    tables[sport === 'nba' ? 'player_slate_stats' : 'player_nfl_slate_stats'] = [{ slate_id: 1, player_id: 7, fantasy_points: 50 }];
    let active = { league: { id: 'l1' }, context: { group: { id: 'g1' } } };
    const route = load('app/api/player-league-profile/route.ts', {
      'next/server': next, '@/lib/supabaseAdmin': { supabaseAdmin: database(tables) },
      '@/lib/statColumns': { getStatColumns: () => [] }, '@/lib/auth': { getCurrentUser: async () => ({ id: 'owner' }) },
      '@/lib/groups/context': { getActiveLeagueForSport: async () => active },
    });
    const request = new Request(`http://localhost/api/player-league-profile?playerId=7&sport=${sport}`);
    const result = await route.GET(request);
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.timesDrafted, 1);
    assert.equal(result.body.summary.wins, 1);
    assert.equal(result.body.recentHistory[0].teamName, 'Former');
    active = { league: { id: 'l2' }, context: { group: { id: 'g2' } } };
    assert.equal((await route.GET(request)).body.recentHistory[0].teamName, 'Other Group');
    active = null;
    assert.equal((await route.GET(request)).status, 404);
  });
}
test('avatars follow team.user_id including historical owners and null fallback', async () => {
  const tables = fixture(), db = database(tables);
  const avatars = await identity.loadFantasyTeamAvatars(db, tables.teams.filter(t => t.group_id === 'g1'));
  assert.equal(avatars.get(11), '/owner.png');
  assert.equal(avatars.get(13), '/former.png');
  assert.equal(avatars.get(14), null);
  assert.equal(avatars.has(12), false);
  assert.equal(db.calls.some(c => c[0] === 'app_users' && c[2] === 'team_id'), false);
  assert.match(source('app/lineups/scores/page.tsx'), /loadFantasyTeamAvatars\(supabaseAdmin, teams \?\? \[\]\)/);
  assert.doesNotMatch(source('lib/profile/fantasyTeamProfile.ts'), /\.eq\("team_id", teamId\)[\s\S]{0,40}\.maybeSingle/);
});
test('NCAA and NBA Skins cannot enter fantasy notification workflows', async () => {
  for (const sport of ['ncaa_pickem','nba_skins']) {
    const tables = fixture(sport), sends = [], db = database(tables);
    await notificationModule('lib/draftNotifications.ts', db, sends).notifyNextDrafter(1);
    await notificationModule('lib/playerFinishedNotifications.ts', db, sends).notifyNewlyFinishedPlayers({ slate: tables.slates[0] });
    await notificationModule('lib/slateCompleteNotifications.ts', db, sends).notifyCompletedSlate({ slate: tables.slates[0] });
    assert.equal(sends.length, 0);
  }
});
for (const sport of ['nba','nfl']) test(`${sport}: reseed ignores other leagues/sports and preserves inverse order`, async () => {
  const tables = fixture(sport);
  tables.slates = [
    { id: 10, league_id: 'l1', sport, start_date: '2026-09-10', is_locked: false },
    { id: 1, league_id: 'l1', sport, start_date: '2026-09-01', is_locked: true },
    { id: 2, league_id: 'l2', sport, start_date: '2026-09-09', is_locked: true },
    { id: 3, league_id: 'l1', sport: sport === 'nba' ? 'nfl' : 'nba', start_date: '2026-09-08', is_locked: true },
    { id: 4, league_id: 'l1', sport, start_date: '2026-09-11', is_locked: true },
  ];
  tables.slate_teams = tables.slate_teams.map(t => ({ ...t, slate_id: 10 }));
  tables.team_slate_results = [
    { slate_id: 1, team_id: 11, finish_position: 1 }, { slate_id: 1, team_id: 14, finish_position: 2 },
    { slate_id: 2, team_id: 11, finish_position: 2 }, { slate_id: 3, team_id: 11, finish_position: 2 },
  ];
  const db = database(tables);
  const route = load('app/api/admin/slates/[slateId]/reseed/route.ts', {
    'next/server': next, '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/security/resourceAuthorization': {
      authorizeSlateResource: async () => ({ ok: true, target: { leagueId: 'l1', groupId: 'g1', sportKey: sport } }),
      loadActiveGroupTeamIds: async () => [11,14],
    },
  });
  const response = await route.POST(new Request('http://localhost'), { params: Promise.resolve({ slateId: '10' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(db.writes, r => r.team_id), [14,11,13]);
  assert.equal(db.writes[2].is_participating, false);
  assert.deepEqual(Array.from(db.writes, r => r.draft_order), [1,2,3]);
  assert.equal(tables.team_slate_results.length, 4);
});

for (const sport of ['nba', 'nfl']) test(`${sport}: creation preview and creation lookup enforce the prior date and current teams`, async () => {
  const tables = fixture(sport);
  tables.slates = [
    { id: 1, league_id: 'l1', sport, start_date: '2026-09-01' },
    { id: 2, league_id: 'l2', sport, start_date: '2026-09-09' },
    { id: 3, league_id: 'l1', sport: sport === 'nba' ? 'nfl' : 'nba', start_date: '2026-09-08' },
    { id: 4, league_id: 'l1', sport, start_date: '2026-09-11' },
    { id: 5, league_id: 'l1', sport, start_date: '2026-09-10' },
  ];
  tables.team_slate_results = tables.slates.flatMap(s => [
    { slate_id: s.id, team_id: 11, finish_position: 1, fantasy_points: 100 },
    { slate_id: s.id, team_id: 14, finish_position: 2, fantasy_points: 90 },
    { slate_id: s.id, team_id: 13, finish_position: 3, fantasy_points: 80 },
  ]);
  const db = database(tables);
  const route = load('app/api/slates/route.ts', {
    'next/server': next,
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/requireAdminApi': {},
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'owner' }) },
    '@/lib/groups/context': { getActiveLeagueForSport: async () => ({
      league: { id: 'l1', settings: {} }, context: { group: { id: 'g1' } },
    }) },
    '@/lib/rules/leagueRules': { resolveLeagueRules: () => ({ roster: { slots: [] } }) },
    '@/lib/security/resourcePolicy': {},
  }, '\nexports.previousSetup = getMostRecentCompletedSlateSetup;');
  const get = (date) => route.GET(new Request(`http://localhost/api/slates?sport=${sport}${date ? `&beforeDate=${date}` : ''}`));
  const result = await get('2026-09-10');
  assert.equal(result.status, 200);
  assert.equal(result.body.previousCompletedSlate.id, 1);
  assert.deepEqual(Array.from(result.body.suggestedTeamConfigs, t => t.team_id), [14, 11]);
  assert.deepEqual(Array.from(result.body.suggestedTeamConfigs, t => t.draft_order), [1, 2]);
  assert.equal((await get('2026-09-01')).body.previousCompletedSlate, null);
  assert.equal((await get()).body.previousCompletedSlate, null);
  assert.equal((await route.previousSetup(sport, 'l1', '2026-09-10')).slate.id, 1);
  assert.match(source('app/api/slates/route.ts'), /getMostRecentCompletedSlateSetup\(\s*sport,\s*league.id,\s*startDate,/);
  assert.match(source('app/slates/new/page.tsx'), /beforeDate=\$\{encodeURIComponent\(beforeDate\)\}/);
  assert.equal(db.writes.length, 0);
});

test('own fantasy profile uses active Group context without falling back to legacy identity', () => {
  const page = source('app/profile/page.tsx');
  assert.match(page, /setGroupTeamId\(result.groupContext\?\.team\?\.id \?\? null\)/);
  assert.match(page, /selectedSport === "nba" \|\| selectedSport === "nfl"\s*\? groupTeamId : user.teamId/);
  assert.match(page, /if \(!profileTeamId\) \{[\s\S]*?setProfile\(null\);[\s\S]*?return;/);
  const context = source('lib/groups/context.ts');
  assert.match(context, /if \(\s*!group \|\|\s*!group.is_active \|\|\s*!membership.is_active/);
  assert.match(context, /"user_id",\s*userId,[\s\S]*?"group_id",\s*groupId,/);
  const historicalRoute = source('app/api/team-profile/route.ts');
  assert.match(historicalRoute, /teamBelongsToGroup\(\s*teamId,\s*activeLeague.context.group.id/);
  assert.doesNotMatch(historicalRoute, /loadActiveGroupTeamIds/);
});
