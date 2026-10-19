/* In-memory database for the real admin/access/authorization/draft routes. No network. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = new Map();

function load(file, mocks, cache = new Map()) {
  const filename = path.resolve(__dirname, '../..', file);
  if (cache.has(filename)) return cache.get(filename);
  if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const exports = {};
  cache.set(filename, exports);
  new Function('require', 'exports', compiled.get(filename))(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, mocks, cache);
    return require(name);
  }, exports);
  return exports;
}

function orderRows(seasonId, ids = [1, 2, 3, 4]) {
  return ids.map((team_id, index) => ({
    id: seasonId * 10 + index, season_id: seasonId, team_id, draft_position: index + 1, created_at: '2026-08-18',
  }));
}

function createFixture() {
  const tables = {
    nba_skins_seasons: [
      { id: 8, season: 2027, league_id: 'league-a', status: 'open', draft_locked_at: null, finalized_at: null, participant_count: 4, nba_teams_per_participant: 7 },
      { id: 7, season: 2026, league_id: 'league-a', status: 'open', draft_locked_at: null, finalized_at: null, participant_count: 4, nba_teams_per_participant: 7 },
      { id: 4, season: 2025, league_id: 'league-a', status: 'final', participant_count: 4, nba_teams_per_participant: 7 },
      { id: 9, season: 2026, league_id: 'league-b', status: 'open', participant_count: 4, nba_teams_per_participant: 7 },
    ],
    nba_skins_draft_order: [...orderRows(8), ...orderRows(4), ...orderRows(9, [99, 98, 97, 96])],
    nba_skins_picks: [{ id: 401, season_id: 4, team_id: 1, nba_team_abbreviation: 'BOS' }],
    nba_skins_team_records: [{ id: 401, season_id: 4, nba_team_abbreviation: 'BOS', wins: 60 }],
    nba_skins_nba_teams: Array.from({ length: 30 }, (_, i) => ({ abbreviation: `T${i}`, display_name: `NBA ${i}`, is_active: true })),
    teams: [...['Andy', 'Josh', 'Jon', 'Mark', 'Inactive'].map((name, i) => ({ id: i + 1, name, group_id: 'group-a', user_id: `user-${i + 1}`, display_order: i + 1 })),
      { id: 99, name: 'Other Group', group_id: 'group-b', user_id: 'user-99', display_order: 1 }],
    group_memberships: [1, 2, 3, 4, 5, 99].map(id => ({ user_id: `user-${id}`, group_id: id === 99 ? 'group-b' : 'group-a', is_active: id !== 5 })),
    app_users: [1, 2, 3, 4, 5, 99].map(id => ({ id: `user-${id}`, is_active: true, avatar_url: null })),
    leagues: [{ id: 'league-a', group_id: 'group-a', sport_key: 'nba_skins' }, { id: 'league-b', group_id: 'group-b', sport_key: 'nba_skins' }],
  };
  const fixture = {
    tables, writes: [], failOrderInserts: 0, failPickRead: false,
    user: { id: 'admin', systemRole: 'user' },
    context: { group: { id: 'group-a' }, canAdministerGroup: true, leagues: [{ id: 'league-a', isEnabled: true }] },
    league: { id: 'league-a', settings: {} },
  };
  const db = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    const filters = [], sorts = [];
    let operation = 'select', values, options, singular = false;
    const query = {
      select(_columns, opts) { options = opts; return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      order(key, opts) { sorts.push([key, opts?.ascending !== false]); return query; },
      maybeSingle() { singular = true; return query; },
      single() { singular = true; return query; },
      delete() { operation = 'delete'; return query; },
      insert(rows) { operation = 'insert'; values = Array.isArray(rows) ? rows : [rows]; return query; },
      then(resolve) {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)));
        if (operation !== 'select') fixture.writes.push({ table, operation });
        if (operation === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
        if (operation === 'insert') {
          if (table === 'nba_skins_draft_order' && fixture.failOrderInserts > 0) {
            fixture.failOrderInserts--;
            return resolve({ data: null, error: { message: 'simulated insertion failure' } });
          }
          let nextId = Math.max(0, ...tables[table].map(row => row.id ?? 0)) + 1;
          rows = values.map(row => ({ id: nextId++, ...row }));
          if (table === 'nba_skins_draft_order') {
            const all = [...tables[table], ...rows];
            for (const key of ['team_id', 'draft_position']) {
              if (new Set(all.map(row => `${row.season_id}:${row[key]}`)).size !== all.length)
                return resolve({ data: null, error: { message: 'unique constraint violation' } });
            }
          }
          tables[table].push(...structuredClone(rows));
        }
        for (const [key, ascending] of sorts.reverse()) rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (ascending ? 1 : -1));
        if (table === 'nba_skins_picks' && fixture.failPickRead) return resolve({ data: null, count: null, error: { message: 'pick read failed' } });
        resolve({ data: options?.head ? null : structuredClone(singular ? rows[0] ?? null : rows), count: options?.count ? rows.length : null, error: null });
      },
    };
    return query;
  } };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/auth': { getCurrentUser: async () => fixture.user },
    '@/lib/groups/context': {
      getGroupContextForUser: async () => fixture.context,
      getActiveLeagueForSport: async () => ({ context: fixture.context, league: fixture.league }),
    },
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
  };
  fixture.admin = load('app/api/admin/nba-skins/route.ts', mocks);
  fixture.draft = load('app/api/nba-skins/draft/route.ts', mocks);
  fixture.save = (ids = [1, 2, 3, 4], overrides = {}) => fixture.admin.PATCH(new Request('http://local/api/admin/nba-skins', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonId: 7, season: 2026, action: 'save-order', initializeParticipants: true, order: ids.map(teamId => ({ teamId })), ...overrides }),
  }));
  fixture.create = year => fixture.admin.POST(new Request('http://local/api/admin/nba-skins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ season: year, participantTeamIds: [1, 2, 3, 4] }),
  }));
  return fixture;
}

module.exports = { createFixture, orderRows };
