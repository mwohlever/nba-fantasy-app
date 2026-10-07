/* eslint-disable @typescript-eslint/no-require-imports */
/* Execute real route factories against an in-memory Supabase/auth boundary; no network/DB. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
function fixture() {
  let user = { id: 'viewer-a' }, error = null;
  const rows = [], calls = [];
  const mocks = {
    '@/lib/auth': { getCurrentUser: async () => user },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/supabaseAdmin': { supabaseAdmin: { from(table) {
      const filters = {};
      const query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        match(values) { Object.assign(filters, values); return query; },
        order(key, options) {
          calls.push({ method: 'GET', table, filters: { ...filters }, key, options });
          return { data: rows.filter(row => row.table === table && Object.entries(filters).every(([k, v]) => row[k] === v)), error };
        },
        upsert(row, options) {
          calls.push({ method: 'POST', table, row, options });
          if (!error && !rows.some(old => old.table === table && old.user_id === row.user_id && old.sport === row.sport && old.espn_team_id === row.espn_team_id)) rows.push({ table, ...row });
          return { error };
        },
        delete() { return query; },
        then(resolve) {
          calls.push({ method: 'DELETE', table, filters: { ...filters } });
          if (!error) for (let i = rows.length - 1; i >= 0; i--) if (rows[i].table === table && Object.entries(filters).every(([k, v]) => rows[i][k] === v)) rows.splice(i, 1);
          resolve({ error });
        },
      };
      return query;
    } } },
  };
  function load(filename) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'exports', code)(name => mocks[name] ?? load(path.resolve(`${name.slice(2)}.ts`)), exports);
    return exports;
  }
  const routes = Object.fromEntries(['nba', 'nfl', 'ncaa'].map(sport => [sport, load(path.resolve(sport === 'ncaa'
    ? 'app/api/ncaa-pickem/favorites/route.ts' : `app/api/live-scores/${sport}/favorites/route.ts`))]));
  return { routes, calls, rows, setUser(value) { user = value; }, setError(value) { error = value; } };
}
const body = teamId => ({ json: async () => ({ teamId, user_id: 'forged-user', sport: 'nfl', groupId: 'forged-group' }) });
for (const sport of ['nba', 'nfl', 'ncaa']) test(`${sport} GET/POST/DELETE preserve user and sport isolation, numeric ESPN identity and idempotent uniqueness`, async () => {
  const f = fixture(), route = f.routes[sport];
  assert.deepEqual((await route.GET()).body, { teamIds: [] });
  assert.equal((await route.POST(body('9'))).status, 200);
  assert.equal((await route.POST(body('9'))).status, 200);
  assert.deepEqual((await route.GET()).body, { teamIds: ['9'] });
  const post = f.calls.find(call => call.method === 'POST');
  assert.deepEqual(post.row, { ...(sport === 'ncaa' ? {} : { sport }), user_id: 'viewer-a', espn_team_id: '9' });
  assert.equal(post.table, sport === 'ncaa' ? 'ncaa_favorite_teams' : 'live_score_favorite_teams');
  assert.deepEqual(post.options, { onConflict: sport === 'ncaa' ? 'user_id,espn_team_id' : 'user_id,sport,espn_team_id', ignoreDuplicates: true });
  const otherSport = sport === 'nba' ? 'nfl' : 'nba';
  assert.deepEqual((await f.routes[otherSport].GET()).body, { teamIds: [] });
  f.setUser({ id: 'viewer-b' });
  assert.deepEqual((await route.GET()).body, { teamIds: [] });
  await route.POST(body('9'));
  await route.DELETE(body('9'));
  assert.deepEqual((await route.GET()).body, { teamIds: [] });
  f.setUser({ id: 'viewer-a' });
  assert.deepEqual((await route.GET()).body, { teamIds: ['9'] });
  await f.routes[otherSport].POST(body('9'));
  await route.DELETE(body('9'));
  assert.deepEqual((await route.GET()).body, { teamIds: [] });
  assert.deepEqual((await f.routes[otherSport].GET()).body, { teamIds: ['9'] });
  for (const method of ['POST', 'DELETE']) for (const invalid of [9, '', 'GSW', '../9', '9;drop', null]) {
    assert.equal((await route[method](body(invalid))).status, 400);
  }
  assert.equal((await route.POST({ json: async () => { throw new Error('malformed JSON'); } })).status, 400);
  f.setUser(null); const before = f.calls.length;
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.POST(body('9'))).status, 401);
  assert.equal((await route.DELETE(body('9'))).status, 401);
  assert.equal(f.calls.length, before);
});
test('NBA route surfaces persistence failures for load/save/delete without reporting success', async () => {
  const f = fixture(); f.setError({ message: 'fixture failure' });
  const original = console.error; console.error = () => {};
  try {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await f.routes.nba[method](body('9'));
      assert.equal(response.status, 500); assert.match(response.body.error, /favorite team/);
    }
    assert.deepEqual(f.rows, []);
  } finally { console.error = original; }
});
