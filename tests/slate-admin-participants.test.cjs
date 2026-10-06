const assert = require('node:assert/strict');
const test = require('node:test');
const { createSlateAdminFixture } = require('./helpers/slate-admin-fixture.cjs');

for (const sport of ['nfl', 'nba', 'golf']) {
  test(`${sport}: editable admin uses active memberships, including Jon sitting out, without a phantom YMCA row`, async () => {
    const f = createSlateAdminFixture({ sport, newMember: true });
    const before = structuredClone(f.tables);
    const result = await f.route.GET({}, f.context());
    assert.equal(result.status, 200);
    assert.equal(result.body.slate.participants_editable, true);
    assert.deepEqual(new Set(result.body.teams.map(t => t.team_id)), new Set([1, 2, 3, 4, 6]));
    assert.equal(result.body.teams.find(t => t.team_id === 3).is_participating, false);
    assert.ok(!result.body.teams.some(t => t.team_id === 5 || t.team_id === 11));
    assert.deepEqual(f.tables, before);
    assert.deepEqual(f.writes, []);
  });

  test(`${sport}: valid weekly opt-out saves without changing membership or other slates`, async () => {
    const f = createSlateAdminFixture({ sport });
    const membershipBefore = structuredClone(f.tables.group_memberships);
    const detail = await f.route.GET({}, f.context());
    const saved = await f.route.PATCH(f.request({ teams: detail.body.teams, cut_penalty_per_round: 10 }), f.context());
    assert.equal(saved.status, 200);
    const stored = f.tables.slate_teams.filter(t => t.slate_id === 191);
    assert.deepEqual(new Set(stored.map(t => t.team_id)), new Set([1, 2, 3, 4]));
    assert.equal(stored.find(t => t.team_id === 3).is_participating, false);
    assert.deepEqual(f.tables.group_memberships, membershipBefore);
    assert.equal(f.tables.slate_teams.find(t => t.slate_id === 300).team_id, 11);
  });

  for (const invalidId of [5, 11]) test(`${sport}: manually injected team ${invalidId} is rejected even unchecked`, async () => {
    const f = createSlateAdminFixture({ sport });
    const detail = await f.route.GET({}, f.context());
    const result = await f.route.PATCH(f.request({ teams: [...detail.body.teams,
      { team_id: invalidId, draft_order: 5, is_participating: false }] }), f.context());
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Every slate team must be an active member/);
    assert.deepEqual(f.writes, []);
  });

  test(`${sport}: Group switching returns only target-Group teams and rejects prior-Group resources`, async () => {
    const f = createSlateAdminFixture({ sport });
    await f.route.GET({}, f.context());
    f.switchGroup('other');
    assert.equal((await f.route.GET({}, f.context())).status, 404);
    const other = await f.route.GET({}, f.context(300));
    assert.deepEqual(other.body.teams.map(t => t.team_id), [11]);
    const cross = await f.route.PATCH(f.request({ teams: [{ team_id: 2, draft_order: 1, is_participating: true }] }), f.context(300));
    assert.equal(cross.status, 400);
    assert.equal((await f.reseed.POST({}, f.context())).status, 404);
    assert.deepEqual(f.writes, []);
  });

  test(`${sport}: creation preview and new slate seed only active members; weekly opt-out does not carry forward`, async () => {
    const f = createSlateAdminFixture({ sport, newMember: true });
    const preview = await f.creation.GET({ url: `http://fixture/api/slates?sport=${sport}&beforeDate=2099-10-15` });
    assert.equal(preview.status, 200);
    assert.deepEqual(new Set(preview.body.teams.map(t => t.id)), new Set([1, 2, 3, 4, 6]));
    assert.ok(preview.body.suggestedTeamConfigs.every(t => t.is_participating));
    const oldFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({}) });
    try {
      const result = await f.creation.POST(f.request({ sport, startDate: '2099-10-15', endDate: '2099-10-15',
        nflSeason: 2099, nflWeek: 6, displayName: 'QA Tournament', externalEventId: 'qa', cutPenaltyPerRound: 10 }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(result.body.slateTeams.map(t => t.team_id), [2, 3, 4, 1, 6]);
      assert.ok(result.body.slateTeams.every(t => t.is_participating));
    } finally { global.fetch = oldFetch; }
  });

  test(`${sport}: reseed excludes former members in previous results and appends new members consistently`, async () => {
    const f = createSlateAdminFixture({ sport, newMember: true });
    // A more recent result from another Group or sport must not influence this reseed.
    f.tables.slates.push({ id: 500, sport, league_id: `${sport}-other`, start_date: '2099-10-07', is_locked: true },
      { id: 501, sport: 'unrelated', league_id: `${sport}-111`, start_date: '2099-10-07', is_locked: true });
    f.tables.team_slate_results.push({ slate_id: 500, team_id: 11, finish_position: 1, fantasy_points: 999 });
    const historyBefore = structuredClone(f.tables.team_slate_results);
    const result = await f.reseed.POST({}, f.context());
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const payload = f.writes.find(w => w.table === 'slate_teams').payload;
    assert.deepEqual(payload.map(t => t.team_id), [2, 4, 1, 6, 3]);
    assert.equal(payload.at(-1).is_participating, false);
    assert.deepEqual(payload.map(t => t.draft_order), [1, 2, 3, 4, 5]);
    assert.deepEqual(f.tables.team_slate_results, historyBefore);
  });

  test(`${sport}: existing inactive configuration grants no eligibility; reconciliation is explicitly deferred without writes`, async () => {
    const f = createSlateAdminFixture({ sport, stale: true });
    const before = structuredClone(f.tables);
    const detail = await f.route.GET({}, f.context());
    assert.ok(!detail.body.teams.some(t => t.team_id === 5));
    assert.equal(detail.body.slate.participants_editable, false);
    assert.match(detail.body.slate.participant_notice, /former Group member/);
    const saved = await f.route.PATCH(f.request({ teams: detail.body.teams }), f.context());
    assert.equal(saved.status, 409);
    assert.equal((await f.reseed.POST({}, f.context())).status, 409);
    assert.deepEqual(f.tables, before);
    assert.deepEqual(f.writes, []);
  });

  test(`${sport}: historical association remains visible without adding new members or rewriting order/history`, async () => {
    const f = createSlateAdminFixture({ sport, historical: true, newMember: true });
    f.tables.slate_teams.find(t => t.team_id === 5).draft_order = 9;
    f.tables.team_slate_results.push({ slate_id: 191, team_id: 5, fantasy_points: 123, finish_position: 1 });
    const before = structuredClone(f.tables);
    const detail = await f.route.GET({}, f.context());
    assert.equal(detail.body.slate.participants_editable, false);
    assert.equal(detail.body.teams.find(t => t.team_id === 5).draft_order, 9);
    assert.equal(detail.body.teams.find(t => t.team_id === 5).is_participating, true);
    assert.ok(!detail.body.teams.some(t => t.team_id === 6));
    assert.equal((await f.reseed.POST({}, f.context())).status, 409);
    assert.equal((await f.route.PATCH(f.request({ teams: detail.body.teams }), f.context())).status, 409);
    assert.deepEqual(f.tables, before);
    assert.deepEqual(f.writes, []);
  });
}

for (const sport of ['nba', 'nfl']) test(`${sport}: a frozen draft without lineups blocks participant edits and reseed, but settings save leaves history intact`, async () => {
  const f = createSlateAdminFixture({ sport, frozen: true, newMember: true });
  const history = structuredClone({ teams: f.tables.slate_teams, drafts: f.tables.fantasy_drafts, picks: f.tables.draft_picks });
  const detail = await f.route.GET({}, f.context());
  assert.equal(detail.body.slate.participants_editable, false);
  assert.match(detail.body.slate.participant_notice, /locked after drafting begins/);
  assert.deepEqual(detail.body.teams.map(t => t.team_id), [2, 4, 1, 3]);
  assert.equal((await f.route.PATCH(f.request({ teams: detail.body.teams }), f.context())).status, 409);
  assert.equal((await f.reseed.POST({}, f.context())).status, 409);
  assert.deepEqual(f.writes, []);
  assert.equal((await f.route.PATCH(f.request({ tournament_analysis: 'Settings only' }), f.context())).status, 200);
  assert.ok(f.writes.every(w => w.table === 'slates'));
  assert.deepEqual({ teams: f.tables.slate_teams, drafts: f.tables.fantasy_drafts, picks: f.tables.draft_picks }, history);
});

for (const dependency of ['lineups', 'team_slate_results', 'golf_salary_cap_lineups', 'golf_snake_period_lineups']) {
  test(`Golf ${dependency} locks participant configuration and preserves roster/results`, async () => {
    const f = createSlateAdminFixture({ sport: 'golf', stale: true });
    f.tables[dependency].push({ slate_id: 191, team_id: 5 });
    const before = structuredClone(f.tables);
    const detail = await f.route.GET({}, f.context());
    assert.equal(detail.body.slate.participants_editable, false);
    assert.ok(detail.body.teams.some(t => t.team_id === 5));
    assert.equal((await f.route.PATCH(f.request({ teams: detail.body.teams }), f.context())).status, 409);
    assert.deepEqual(f.tables, before);
    assert.deepEqual(f.writes, []);
  });
}

for (const dependency of ['lineups', 'team_slate_results', 'draft_picks', 'draft_corrections']) {
  test(`NFL ${dependency} protects configuration even without a fantasy_drafts row`, async () => {
    const f = createSlateAdminFixture({ stale: true });
    f.tables[dependency].push({ slate_id: 191, team_id: 5 });
    const before = structuredClone(f.tables);
    const detail = await f.route.GET({}, f.context());
    assert.equal(detail.body.slate.participants_editable, false);
    assert.ok(detail.body.teams.some(t => t.team_id === 5));
    assert.equal((await f.route.PATCH(f.request({ teams: detail.body.teams }), f.context())).status, 409);
    assert.equal((await f.reseed.POST({}, f.context())).status, 409);
    assert.deepEqual(f.tables, before);
    assert.deepEqual(f.writes, []);
  });
}

test('archived and ended-but-unlocked slates retain original associations', async () => {
  for (const change of [{ archived_at: '2026-10-01' }, { date: '2020-10-08', end_date: '2020-10-12' }]) {
    const f = createSlateAdminFixture({ stale: true, newMember: true });
    Object.assign(f.tables.slates[0], change);
    const result = await f.route.GET({}, f.context());
    assert.equal(result.body.slate.participants_editable, false);
    assert.ok(result.body.teams.some(t => t.team_id === 5));
    assert.ok(!result.body.teams.some(t => t.team_id === 6));
    assert.deepEqual(f.writes, []);
  }
});
