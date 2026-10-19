/* Real routes and page callbacks against an isolated in-memory database. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { createFixture, orderRows } = require('./helpers/nba-skins-admin-fixture.cjs');
const { host, nodes, React } = require('./helpers/scores-harness.cjs');
const { renderToStaticMarkup } = require('react-dom/server');
const previousLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request.includes('components/AppNav')) return () => null;
  if (request === 'next/link') return props => React.createElement('a', props);
  return previousLoad.call(this, request, parent, ...rest);
};
const Admin = require('../app/admin/nba-skins/page.tsx').default;
const html = tree => renderToStaticMarkup(tree);
const orderIds = (f, id) => f.tables.nba_skins_draft_order.filter(row => row.season_id === id).sort((a, b) => a.draft_position - b.draft_position).map(row => row.team_id);

test('legacy initialization persists only the selected season and builds 28 frozen snake slots', async () => {
  const f = createFixture(), before = structuredClone(f.tables);
  // Current league settings must not change the legacy season's frozen format.
  f.league.settings = { draft: { participantCount: 6, nbaTeamsPerParticipant: 5 } };
  const response = await f.save([4, 1, 3, 2]);
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /2026-27.*initialized/);
  assert.deepEqual(orderIds(f, 7), [4, 1, 3, 2]);
  assert.deepEqual(f.writes, [{ table: 'nba_skins_draft_order', operation: 'insert' }]);
  for (const table of Object.keys(before)) {
    if (table !== 'nba_skins_draft_order') assert.deepEqual(f.tables[table], before[table], table);
  }
  assert.deepEqual(f.tables.nba_skins_draft_order.filter(row => row.season_id !== 7), before.nba_skins_draft_order);
  const reloaded = await (await f.admin.GET()).json();
  assert.deepEqual(reloaded.seasons.find(s => s.id === 7).draftOrder.map(e => e.teamId), [4, 1, 3, 2]);
  const draft = await (await f.draft.GET({ nextUrl: new URL('http://local/api/nba-skins/draft?season=2026') })).json();
  assert.equal(draft.hasValidDraftOrder, true);
  assert.equal(draft.picks.length, 28);
  assert.deepEqual(draft.picks.slice(0, 8).map(p => p.teamId), [4, 1, 3, 2, 2, 3, 1, 4]);
});

test('an initialized season can reorder only its frozen participants', async () => {
  const f = createFixture();
  const response = await f.save([4, 3, 2, 1], { seasonId: 8, season: 2027, initializeParticipants: false });
  assert.equal(response.status, 200);
  assert.deepEqual(orderIds(f, 8), [4, 3, 2, 1]);
  f.tables.teams.push({ id: 6, group_id: 'group-a', user_id: 'user-6', name: 'Extra' });
  f.tables.app_users.push({ id: 'user-6', is_active: true });
  f.tables.group_memberships.push({ group_id: 'group-a', user_id: 'user-6', is_active: true });
  const before = structuredClone(f.tables);
  const rejected = await f.save([1, 2, 3, 6], { seasonId: 8, season: 2027, initializeParticipants: false });
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /participants are frozen/);
  assert.deepEqual(f.tables, before);
});

test('a failed reorder restores the previous saved rows', async () => {
  const f = createFixture(), before = structuredClone(f.tables);
  f.failOrderInserts = 1;
  const response = await f.save([4, 3, 2, 1], { seasonId: 8, season: 2027, initializeParticipants: false });
  assert.equal(response.status, 500);
  f.tables.nba_skins_draft_order.sort((a, b) => a.id - b.id);
  before.nba_skins_draft_order.sort((a, b) => a.id - b.id);
  assert.deepEqual(f.tables, before);
});

test('a failed initialization leaves the season and all other records intact', async () => {
  const f = createFixture(), before = structuredClone(f.tables);
  f.failOrderInserts = 1;
  assert.equal((await f.save()).status, 500);
  assert.deepEqual(f.tables, before);
  assert.deepEqual(f.writes, [{ table: 'nba_skins_draft_order', operation: 'insert' }]);
});

test('pick-count read failures block initialization without writes', async () => {
  const f = createFixture(), before = structuredClone(f.tables);
  f.failPickRead = true;
  assert.equal((await f.save()).status, 500);
  assert.deepEqual(f.tables, before);
  assert.deepEqual(f.writes, []);
});

test('restoration failures explicitly require review rather than reporting a successful save', async () => {
  const f = createFixture();
  f.failOrderInserts = 2;
  const response = await f.save([4, 3, 2, 1], { seasonId: 8, season: 2027, initializeParticipants: false });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /2027-28.*Failed to save and restore.*review/);
  assert.equal(f.tables.nba_skins_picks.length, 1);
  assert.deepEqual(orderIds(f, 4), [1, 2, 3, 4]);
});

for (const [name, setup, ids, overrides, status] of [
  ['explicit initialization consent', () => {}, [1, 2, 3, 4], { initializeParticipants: false }, 409],
  ['partial submitted participants', () => {}, [1, 2, 3], {}, 400],
  ['duplicate participants', () => {}, [1, 2, 3, 3], {}, 400],
  ['cross-Group participant', () => {}, [1, 2, 3, 99], {}, 400],
  ['inactive membership', () => {}, [1, 2, 3, 5], {}, 400],
  ['inactive account', f => { f.tables.app_users.find(u => u.id === 'user-4').is_active = false; }, [1, 2, 3, 4], {}, 400],
  ['partial existing order', f => f.tables.nba_skins_draft_order.push(...orderRows(7, [1, 2, 3])), [1, 2, 3, 4], { initializeParticipants: false }, 409],
  ['noncontiguous existing order', f => { f.tables.nba_skins_draft_order.push(...orderRows(7)); f.tables.nba_skins_draft_order.find(o => o.season_id === 7).draft_position = 8; }, [1, 2, 3, 4], { initializeParticipants: false }, 409],
  ['picks without participants', f => f.tables.nba_skins_picks.push({ id: 701, season_id: 7, team_id: 1 }), [1, 2, 3, 4], {}, 409],
  ['picks with participants', f => { f.tables.nba_skins_draft_order.push(...orderRows(7)); f.tables.nba_skins_picks.push({ id: 701, season_id: 7, team_id: 1 }); }, [1, 2, 3, 4], { initializeParticipants: false }, 409],
  ['locked status', f => { f.tables.nba_skins_seasons.find(s => s.id === 7).status = 'locked'; }, [1, 2, 3, 4], {}, 409],
  ['final status', f => { f.tables.nba_skins_seasons.find(s => s.id === 7).status = 'final'; }, [1, 2, 3, 4], {}, 409],
  ['lock timestamp on open season', f => { f.tables.nba_skins_seasons.find(s => s.id === 7).draft_locked_at = '2026-10-19'; }, [1, 2, 3, 4], {}, 409],
  ['finalization timestamp on open season', f => { f.tables.nba_skins_seasons.find(s => s.id === 7).finalized_at = '2026-10-19'; }, [1, 2, 3, 4], {}, 409],
  ['wrong selected year', () => {}, [1, 2, 3, 4], { season: 2027 }, 409],
  ['missing selected year', () => {}, [1, 2, 3, 4], { season: undefined }, 409],
  ['historical season', () => {}, [1, 2, 3, 4], { seasonId: 4, season: 2025 }, 409],
  ['cross-Group season', () => {}, [1, 2, 3, 4], { seasonId: 9 }, 404],
  ['noncommissioner', f => { f.context.canAdministerGroup = false; }, [1, 2, 3, 4], {}, 404],
  ['unauthenticated', f => { f.user = null; }, [1, 2, 3, 4], {}, 401],
  ['stale initialization request', () => {}, [1, 2, 3, 4], { seasonId: 8, season: 2027 }, 409],
]) test(`rejects ${name} without changing any records`, async () => {
  const f = createFixture(); setup(f);
  const before = structuredClone(f.tables);
  assert.equal((await f.save(ids, overrides)).status, status);
  assert.deepEqual(f.tables, before);
  assert.deepEqual(f.writes, []);
});

test('duplicate year returns the existing Group-owned season without writes', async () => {
  const f = createFixture();
  const response = await f.create(2026);
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).season.id, 7);
  assert.deepEqual(f.writes, []);
});

async function mount(f, fetcher) {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    assert.equal(url, '/api/admin/nba-skins');
    requests.push({ method: options.method ?? 'GET', body: options.body && JSON.parse(options.body) });
    if (fetcher) return fetcher(url, options);
    if (!options.method) return f.admin.GET();
    if (options.method === 'PATCH') return f.admin.PATCH(new Request('http://local/api/admin/nba-skins', options));
    assert.fail('Unexpected mutation');
  };
  const h = host(Admin);
  const render = async () => {
    for (let i = 0; i < 4; i++) { h.render({}, true); await new Promise(setImmediate); }
    return h.render({}, true);
  };
  await render();
  return { h, render, requests };
}
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && n.props.children === label);
const yearInput = tree => nodes(tree).find(n => n.type === 'input' && n.props.type === 'number');
const seasonSelect = tree => nodes(tree).find(n => n.type === 'select' && n.props['aria-label']);
const orderSelects = tree => nodes(tree).filter(n => n.type === 'select' && !n.props['aria-label']);

test('legacy UI proposes eligible participants, saves the explicit target, and retains feedback after reload', async () => {
  const f = createFixture(), { h, render, requests } = await mount(f);
  let tree = await render();
  seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await render();
  assert.match(html(tree), /Saved order:.*Not initialized/);
  assert.match(html(tree), /Proposed order \(not saved\)/);
  assert.equal(yearInput(tree).props.value, '');
  assert.equal(orderSelects(tree).length, 4);
  assert.deepEqual(orderSelects(tree).map(s => nodes(s).filter(n => n.type === 'option' && n.props.value !== '').map(n => n.props.value)), Array(4).fill([1, 2, 3, 4]));
  orderSelects(tree)[0].props.onChange({ target: { value: '4' } });
  tree = await render();
  await button(tree, 'Initialize 2026-27 Draft Order').props.onClick();
  tree = await render();
  const request = requests.find(r => r.method === 'PATCH');
  assert.equal(request.body.seasonId, 7); assert.equal(request.body.season, 2026);
  assert.equal(request.body.initializeParticipants, true);
  assert.deepEqual(orderIds(f, 7), [4, 2, 3, 1]);
  assert.match(html(tree), /2026-27 draft order saved and participants initialized/);
  assert.doesNotMatch(html(tree), /Proposed order/);
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), [4, 2, 3, 1]);
  h.unmount();
  const reload = await mount(f);
  tree = await reload.render(); seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await reload.render();
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), [4, 2, 3, 1]);
  assert.equal(yearInput(tree).props.value, '');
  reload.h.unmount();
});

test('typed year survives saving and switching; duplicate year opens the existing season without POST', async () => {
  const f = createFixture(), { h, render, requests } = await mount(f);
  let tree = await render();
  yearInput(tree).props.onChange({ target: { value: '2026' } });
  tree = await render();
  await button(tree, 'Open 2026-27 Season').props.onClick();
  tree = await render();
  assert.equal(seasonSelect(tree).props.value, 7);
  assert.match(html(tree), /2026-27 already exists/);
  await button(tree, 'Initialize 2026-27 Draft Order').props.onClick();
  tree = await render();
  assert.equal(yearInput(tree).props.value, '2026');
  seasonSelect(tree).props.onChange({ target: { value: '8' } });
  tree = await render();
  assert.equal(yearInput(tree).props.value, '2026');
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  h.unmount();
});

test('partial setup UI stays blocked and server errors remain visible with their target season', async () => {
  const f = createFixture(); f.tables.nba_skins_draft_order.push(...orderRows(7, [1, 2, 3]));
  const { h, render } = await mount(f);
  let tree = await render(); seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await render();
  assert.equal(button(tree, 'Save 2026-27 Draft Order').props.disabled, true);
  assert.match(html(tree), /Incomplete or inconsistent/);
  assert.doesNotMatch(html(tree), /Proposed order/);
  h.unmount();

  const g = createFixture();
  const page = await mount(g, async (_url, opts) => opts.method
    ? Response.json({ error: 'Failed to save draft order.' }, { status: 500 }) : g.admin.GET());
  tree = await page.render();
  await button(tree, 'Save 2027-28 Draft Order').props.onClick();
  tree = await page.render();
  assert.match(html(tree), /2027-28: Failed to save draft order/);
  page.h.unmount();
});
