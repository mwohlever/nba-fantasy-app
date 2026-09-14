/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, console, URL, require: (id) => mocks[id] || (() => { throw Error(`Unexpected import ${id}`); })(),
  });
  return module.exports;
}

function setup({ admin = true } = {}) {
  const tables = {
    ncaa_pickem_weeks: [{ id: 1, league_id: 'league-a', status: 'final' }],
    ncaa_pickem_games: [{ id: 10, week_id: 1, included: true, away_team_id: 'away', home_team_id: 'home', winner_team_id: 'home', kickoff_at: '2026-09-01T00:00Z' }, { id: 11, week_id: 1, included: true, away_team_id: 'away2', home_team_id: 'home2', winner_team_id: null, kickoff_at: '2026-09-02T00:00Z' }],
    ncaa_pickem_picks: [{ id: 1, week_id: 1, game_id: 10, team_id: 7, picked_team_id: 'away', is_correct: false }, { id: 2, week_id: 1, game_id: 10, team_id: 8, picked_team_id: 'home', is_correct: true }],
  };
  const db = { from(table) { const filters = []; let rows, payload, operation, single = false; const q = {
    select() { return q; }, eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return q; }, order() { return q; }, maybeSingle() { single = true; return q; },
    upsert(value) { operation = 'upsert'; payload = value; return q; },
    then(resolve) { rows = tables[table].filter((row) => filters.every((filter) => filter(row))); if (operation === 'upsert') { for (const row of payload) { const found = tables[table].find((item) => item.game_id === row.game_id && item.team_id === row.team_id); if (found) Object.assign(found, row); else tables[table].push({ id: tables[table].length + 1, ...row }); } } return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve); },
  }; return q; } };
  const access = { league: { id: 'league-a' }, context: { canAdministerGroup: admin }, participants: [{ teamId: 7, name: 'Target' }, { teamId: 8, name: 'Other' }] };
  const route = load('app/api/admin/ncaa-pickem/pick-corrections/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } }, '@/lib/auth': { getCurrentUser: async () => ({ id: 'commissioner' }) }, '@/lib/ncaaPickEm/access': { getNcaaPickEmAccess: async () => access }, '@/lib/supabaseAdmin': { supabaseAdmin: db },
  });
  return { route, tables, post: (body) => route.POST({ json: async () => body }) };
}

test('commissioner corrections save after a final lock, update existing picks, add missing picks, and grade completed games', async () => {
  const h = setup();
  const result = await h.post({ weekId: 1, teamId: 7, picks: [{ gameId: 10, pickedTeamId: 'home' }, { gameId: 11, pickedTeamId: 'away2' }] });
  assert.equal(result.status, 200); assert.equal(result.body.graded, 1);
  assert.deepEqual(h.tables.ncaa_pickem_picks.find((pick) => pick.team_id === 7 && pick.game_id === 10).is_correct, true);
  assert.equal(h.tables.ncaa_pickem_picks.find((pick) => pick.team_id === 7 && pick.game_id === 11).picked_team_id, 'away2');
  assert.equal(h.tables.ncaa_pickem_picks.find((pick) => pick.team_id === 8).picked_team_id, 'home');
});
test('correction route rejects non-admins, foreign participants, foreign games, and invalid matchup teams', async () => {
  assert.equal((await setup({ admin: false }).post({ weekId: 1, teamId: 7, picks: [{ gameId: 10, pickedTeamId: 'home' }] })).status, 403);
  assert.equal((await setup().post({ weekId: 1, teamId: 99, picks: [{ gameId: 10, pickedTeamId: 'home' }] })).status, 404);
  assert.equal((await setup().post({ weekId: 1, teamId: 7, picks: [{ gameId: 99, pickedTeamId: 'home' }] })).status, 400);
  assert.equal((await setup().post({ weekId: 1, teamId: 7, picks: [{ gameId: 10, pickedTeamId: 'not-in-game' }] })).status, 400);
});
test('normal player save keeps its independent post-lock rejection', async () => {
  const normalRoute = load('app/api/ncaa-pickem/picks/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'player' }) },
    '@/lib/ncaaPickEm/access': { getNcaaPickEmAccess: async () => ({ league: { id: 'league-a' }, viewerTeam: { teamId: 7 } }) },
    '@/lib/supabaseAdmin': { supabaseAdmin: { from: (table) => {
      if (table !== 'ncaa_pickem_weeks') throw Error('normal locked check should stop before games');
      const q = { select: () => q, eq: () => q, maybeSingle: () => q, then: (resolve) => Promise.resolve({ data: { id: 1, league_id: 'league-a', status: 'locked', lock_at: null }, error: null }).then(resolve) };
      return q;
    } } },
  });
  const result = await normalRoute.POST({ json: async () => ({ weekId: 1, picks: [] }) });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "This week's picks are locked.");
});
