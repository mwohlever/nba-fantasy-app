/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSlateAdminFixture } = require('./helpers/slate-admin-fixture.cjs');
const body = id => ({ action: 'discard', confirmedSlateId: id ?? 191 });

for (const frozen of [false, true]) test(`NFL detail supplies server eligibility with frozen=${frozen}`, async () => {
  const f = createSlateAdminFixture({ frozen });
  const result = await f.route.GET({}, f.context());
  assert.equal(result.status, 200); assert.equal(result.body.slate.discard.eligible, true);
  assert.equal(result.body.slate.participants_editable, !frozen);
  assert.deepEqual(f.rpcCalls[0], { name: 'inspect_nfl_slate_discard', args: {
    p_slate_id: 191, p_group_id: '111', p_league_id: 'nfl-111', p_actor_id: 'commissioner',
  } });
});
test('discard authorizes first and passes only server-derived ownership and session actor to one RPC', async () => {
  const f = createSlateAdminFixture({ frozen: true });
  const r = await f.route.DELETE(f.request({ ...body(), groupId: 'other', leagueId: 'nfl-other', actorId: 'forged', is_locked: false }), f.context());
  assert.equal(r.status, 200); assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.rpcCalls[0].name, 'discard_abandoned_nfl_slate');
  assert.deepEqual(f.rpcCalls[0].args, { p_slate_id: 191, p_group_id: '111', p_league_id: 'nfl-111', p_actor_id: 'commissioner' });
});
for (const [name, options, expected] of [
  ['signed out', { user: null }, 401], ['ordinary member', { commissioner: false }, 404],
]) test(`${name} is rejected before any discard RPC`, async () => {
  const f = createSlateAdminFixture(options);
  assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, expected);
  assert.deepEqual(f.rpcCalls, []);
});
test('Group switching rejects the old Group slate and never invokes discard', async () => {
  const f = createSlateAdminFixture(); f.switchGroup('other');
  assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, 404);
  assert.deepEqual(f.rpcCalls, []); assert.ok(f.tables.slates.some(s => s.id === 191));
});
test('explicit super-admin policy remains authorized across Groups', async () => {
  const f = createSlateAdminFixture({ commissioner: false, user: { id: 'super', systemRole: 'super_admin' } });
  f.switchGroup('other'); assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, 200);
  assert.equal(f.rpcCalls[0].args.p_actor_id, 'super'); assert.equal(f.rpcCalls[0].args.p_group_id, '111');
});
for (const confirmation of [{}, { action: 'delete', confirmedSlateId: 191 }, { action: 'discard', confirmedSlateId: 300 }]) {
  test(`missing or wrong target confirmation rejected: ${JSON.stringify(confirmation)}`, async () => {
    const f = createSlateAdminFixture(); assert.equal((await f.route.DELETE(f.request(confirmation), f.context())).status, 400);
    assert.deepEqual(f.rpcCalls, []);
  });
}
test('malformed JSON and invalid IDs do not invoke the RPC', async () => {
  const f = createSlateAdminFixture();
  assert.equal((await f.route.DELETE({ json: async () => { throw Error('JSON'); } }, f.context())).status, 400);
  for (const id of [-1, 0, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await f.route.DELETE(f.request(body(id)), f.context(id))).status, 400);
  assert.deepEqual(f.rpcCalls, []);
});
for (const sport of ['nba', 'golf']) test(`${sport} never presents or invokes discard`, async () => {
  const f = createSlateAdminFixture({ sport });
  assert.equal((await f.route.GET({}, f.context())).body.slate.discard.eligible, false);
  assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, 409);
  assert.deepEqual(f.rpcCalls, []);
});
for (const code of ['locked','not_pre_game','scoring_exists','scoring_activity','unreviewed_dependencies','not_found','dependency_failure']) {
  test(`database rejection ${code} reaches the UI without an alternate cleanup path`, async () => {
    const f = createSlateAdminFixture();
    // Test API mapping, not a replacement for actual PostgreSQL safety tests.
    f.rpcErrors.inspect_nfl_slate_discard = { code: 'PGRST202' };
    const expected = code === 'not_found' ? 404 : code === 'dependency_failure' ? 500 : 409;
    f.setDiscardResult({ success: false, code, reason: `Refused ${code}` });
    assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, expected);
    assert.ok(f.tables.slates.some(s => s.id === 191));
  });
}
test('missing migration disables UI eligibility and rejects destructive call with 503', async () => {
  const f = createSlateAdminFixture();
  for (const name of ['inspect_nfl_slate_discard', 'discard_abandoned_nfl_slate']) f.rpcErrors[name] = { code: 'PGRST202' };
  assert.equal((await f.route.GET({}, f.context())).body.slate.discard.eligible, false);
  assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, 503);
  assert.ok(f.tables.slates.some(s => s.id === 191));
});
test('discard followed by actual creation/reseed handlers recreates same week with active members and no old state', async () => {
  const f = createSlateAdminFixture({ frozen: true, nflWeek: 5 });
  f.tables.slates[0].display_name = '2099 Week 5';
  f.tables.lineups.push({ id: 1075, slate_id: 191, team_id: 2 });
  f.tables.lineup_players.push({ id: 3997, lineup_id: 1075, player_id: 283 });
  f.tables.notification_history.push({ id: 'delivery', slate_id: 191, status: 'sent' });
  assert.equal((await f.creation.POST(f.request({ sport: 'nfl', nflSeason: 2099, nflWeek: 5 }))).status, 409);
  const memberships = structuredClone(f.tables.group_memberships);
  assert.equal((await f.route.DELETE(f.request(body()), f.context())).status, 200);
  for (const table of ['fantasy_drafts','draft_picks','draft_corrections','lineups','slate_teams']) assert.ok(!f.tables[table].some(r => r.slate_id === 191));
  assert.deepEqual(f.tables.lineup_players, []); assert.equal(f.tables.notification_history[0].slate_id, null);
  const preview = await f.creation.GET({ url: 'http://fixture/api/slates?sport=nfl&beforeDate=2099-10-08' });
  assert.equal(preview.status, 200); assert.equal(preview.body.previousCompletedSlate.id, 190);
  assert.deepEqual(new Set(preview.body.teams.map(t => t.id)), new Set([1,2,3,4]));
  const configs = preview.body.suggestedTeamConfigs.map(t => ({ ...t, is_participating: t.team_id !== 3 }));
  const created = await f.creation.POST(f.request({ sport: 'nfl', nflSeason: 2099, nflWeek: 5, teamConfigs: configs }));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.deepEqual(created.body.slateTeams.map(t => t.team_id), [2,4,1,3]);
  assert.equal(created.body.slateTeams.at(-1).is_participating, false);
  assert.equal(f.tables.fantasy_drafts.length, 0); assert.equal(f.tables.draft_picks.length, 0); assert.equal(f.tables.lineups.length, 0);
  assert.equal((await f.reseed.POST({}, f.context(created.body.slate.id))).status, 200);
  const detail = await f.route.GET({}, f.context(created.body.slate.id));
  assert.deepEqual(detail.body.teams.filter(t => t.is_participating).map(t => t.team_name), ['Josh','Mark','Andy']);
  assert.deepEqual(f.tables.group_memberships, memberships);
});
