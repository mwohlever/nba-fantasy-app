/* Execute the real read route with Group-scoped fixtures; no external data writes. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return load(path.resolve(`${name.slice(2)}.ts`), mocks);
    return require(name);
  }, exports);
  return exports;
}

function fixture(season, order = []) {
  const tables = {
    nba_skins_seasons: [{ id: 1, league_id: 'skins-a', season, status: 'final', participant_count: 2, nba_teams_per_participant: 2 },
      { id: 2, league_id: 'skins-b', season, status: 'final', participant_count: 2, nba_teams_per_participant: 2 }],
    nba_skins_draft_order: order.map((teamId, index) => ({ season_id: 1, team_id: teamId, draft_position: index + 1 })),
    nba_skins_nba_teams: [{ abbreviation: 'BOS', display_name: 'Boston' }, { abbreviation: 'ATL', display_name: 'Atlanta' }],
    nba_skins_picks: [
      { id: 50, season_id: 1, team_id: 101, nba_team_abbreviation: 'BOS', pick_type: 'wins', draft_round: 7, overall_pick: 25, final_points: 41 },
      { id: 51, season_id: 1, team_id: 102, nba_team_abbreviation: 'ATL', pick_type: 'losses', draft_round: 1, overall_pick: 1, final_points: 42 },
      { id: 52, season_id: 2, team_id: 999, nba_team_abbreviation: 'LAL', pick_type: 'wins', draft_round: 1 },
      { id: 53, season_id: 1, team_id: 999, nba_team_abbreviation: 'DEN', pick_type: 'losses', draft_round: 1 },
    ],
  };
  const db = { from(table) {
    let rows = [...tables[table]];
    const query = {
      select() { return query; },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return query; },
      order() { return query; },
      then(resolve) { resolve({ data: rows, error: null }); },
    };
    return query;
  } };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'owner', displayName: 'Owner' }) },
    '@/lib/nbaSkins/access': { getNbaSkinsAccess: async () => ({
      league: { id: 'skins-a' }, context: { canAdministerGroup: true }, viewerTeam: { teamId: 101 },
      teams: [{ teamId: 101, teamName: 'Alpha' }, { teamId: 102, teamName: 'Beta' }],
    }) },
    '@/lib/security/resourceAuthorization': { authorizeNbaSkinsSeasonResource: () => assert.fail('GET must not mutate') },
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
  };
  return { tables, GET: load('app/api/nba-skins/draft/route.ts', mocks).GET };
}

for (const season of [2023, 2024, 2025]) test(`${season}: no historical participant order or pick sequence is inferred, even from imported order rows`, async () => {
  for (const order of [[], [102, 101]]) {
    const { GET, tables } = fixture(season, order);
    const before = structuredClone(tables);
    const response = await GET({ nextUrl: new URL(`http://local/api/nba-skins/draft?season=${season}`) });
    assert.equal(response.status, 200);
    assert.equal(response.body.season.season, season);
    assert.equal(response.body.season.editable, false);
    assert.equal(response.body.hasValidDraftOrder, false);
    assert.deepEqual(response.body.draftOrder, []);
    assert.deepEqual(response.body.picks, [
      { pickId: 50, pickNumber: null, round: null, roundPick: null, teamId: 101, teamName: 'Alpha', nbaTeamAbbreviation: 'BOS', pickType: 'wins' },
      { pickId: 51, pickNumber: null, round: null, roundPick: null, teamId: 102, teamName: 'Beta', nbaTeamAbbreviation: 'ATL', pickType: 'losses' },
    ]);
    assert.deepEqual(tables, before, 'historical records remain unchanged');
  }
});

test('tracked seasons use their persisted participant order and preserve configured snake slots', async () => {
  const { GET } = fixture(2026, [102, 101]);
  const response = await GET({ nextUrl: new URL('http://local/api/nba-skins/draft?season=2026') });
  assert.equal(response.body.hasValidDraftOrder, true);
  assert.deepEqual(response.body.draftOrder.map(team => team.teamId), [102, 101]);
  assert.deepEqual(response.body.picks.map(pick => [pick.pickNumber, pick.round, pick.teamId]), [[1, 1, 102], [2, 1, 101], [3, 2, 101], [4, 2, 102]]);
});
