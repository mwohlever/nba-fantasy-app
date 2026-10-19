/* Real routes and page callbacks against an isolated in-memory database. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture, orderRows } = require('./helpers/nba-skins-admin-fixture.cjs');
const { host, nodes, React } = require('./helpers/scores-harness.cjs');
const { renderToStaticMarkup } = require('react-dom/server');
const previousLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request.includes('components/AppNav')) return () => null;
  if (request.endsWith('.module.css')) {
    const css = fs.readFileSync(path.resolve(path.dirname(parent.filename), request), 'utf8');
    return Object.fromEntries([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
  }
  if (request === 'next/link') return props => React.createElement('a', props);
  return previousLoad.call(this, request, parent, ...rest);
};
const Admin = require('../app/admin/nba-skins/page.tsx').default;
const html = tree => renderToStaticMarkup(tree);
const { shuffleNbaSkinsOrder, secureRandomIndex, nextLotteryPick } = require('../lib/nbaSkins/lottery.ts');
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
    const tree = h.render({}, true);
    return tree.type?.name === 'LotteryReveal' ? tree.type(tree.props) : tree;
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

test('Fisher–Yates reaches all 24 permutations without modifying its input', () => {
  const input = [1, 2, 3, 4], permutations = new Set();
  for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 2; c++) {
    const draws = [a, b, c];
    const result = shuffleNbaSkinsOrder(input, () => draws.shift());
    assert.deepEqual([...result].sort(), input);
    permutations.add(result.join(','));
  }
  assert.equal(permutations.size, 24);
  assert.deepEqual(input, [1, 2, 3, 4]);
});

test('secure sampling rejects biased boundary values and invalid random sources', () => {
  const draws = [2 ** 32 - 1, 4];
  assert.equal(secureRandomIndex(3, () => draws.shift()), 1);
  assert.equal(draws.length, 0, 'top value was rejected rather than reduced modulo three');
  assert.equal(secureRandomIndex(4, () => 2 ** 32 - 1), 3);
  for (const bound of [0, -1, 2 ** 32 + 1, NaN]) assert.throws(() => secureRandomIndex(bound, () => 0));
  for (const value of [-1, 2 ** 32, NaN, .5]) assert.throws(() => secureRandomIndex(4, () => value));
  assert.deepEqual([0, 1, 2, 3, 4].map(count => nextLotteryPick(4, count)), [4, 3, 2, 1, null]);
});

test('browser shuffle uses Web Crypto and never falls back to Math.random', t => {
  let draws = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', values => { draws++; values[0] = 0; return values; });
  t.mock.method(Math, 'random', () => assert.fail('insecure random source'));
  assert.deepEqual(shuffleNbaSkinsOrder([1, 2, 3, 4]), [2, 3, 4, 1]);
  assert.equal(draws, 3);
});

const randomizeButton = tree => button(tree, '🎲 Randomize Order');
const showButton = (tree, pick) => nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === `Show Pick #${pick}`);
const participantNames = ['Andy', 'Josh', 'Jon', 'Mark'];
const expectedAscending = [2, 3, 4, 1];

test('lottery hides all names, gates #4→#3→#2→#1, then saves exactly the reveal and stays visible', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', values => { values[0] = 0; return values; });
  const f = createFixture(), page = await mount(f);
  let tree = await page.render(); seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await page.render();
  const staleSave = button(tree, 'Initialize 2026-27 Draft Order').props.onClick;
  const draw = randomizeButton(tree).props.onClick;
  const before = structuredClone(f.tables);
  draw(); draw();
  tree = await page.render();
  assert.match(html(tree), /Order randomized! Ready for the reveal/);
  for (const name of participantNames) assert.doesNotMatch(html(tree), new RegExp(name));
  assert.equal(nodes(tree).filter(n => n.type === 'select' || n.type === 'input').length, 0);
  assert.equal(nodes(tree).filter(n => n.type === 'button' && /^Show Pick/.test(n.props['aria-label'] ?? '')).length, 4);
  assert.equal(button(tree, 'Initialize 2026-27 Draft Order').props.disabled, true);
  page.h.strictReplayEffects(); tree = await page.render();
  assert.match(html(tree), /Order randomized! Ready for the reveal/, 'late mount loads cannot dismiss the lottery');
  for (const name of participantNames) assert.doesNotMatch(html(tree), new RegExp(name));
  await staleSave();
  for (const pick of [4, 3, 2, 1]) {
    const wrong = pick > 1 ? 1 : 4;
    assert.equal(showButton(tree, wrong).props.disabled, true);
    showButton(tree, wrong).props.onClick();
    assert.equal(showButton(await page.render(), pick).props.disabled, false);
    const reveal = showButton(tree, pick).props.onClick;
    reveal(); reveal();
    tree = await page.render();
    const revealedIds = expectedAscending.slice(pick - 1);
    for (let id = 1; id <= 4; id++) {
      if (revealedIds.includes(id)) assert.match(html(tree), new RegExp(participantNames[id - 1]));
      else assert.doesNotMatch(html(tree), new RegExp(participantNames[id - 1]));
    }
    if (pick > 1) {
      assert.equal(button(tree, 'Initialize 2026-27 Draft Order').props.disabled, true);
      await button(tree, 'Initialize 2026-27 Draft Order').props.onClick();
    }
    assert.deepEqual(f.tables, before);
    assert.deepEqual(f.writes, []);
  }
  assert.match(html(tree), /Draft order revealed!/);
  await button(tree, 'Initialize 2026-27 Draft Order').props.onClick();
  tree = await page.render();
  assert.deepEqual(orderIds(f, 7), expectedAscending);
  assert.match(html(tree), /Saved order · verified after reload/);
  assert.match(html(tree), /Draft order revealed!/);
  assert.equal(button(tree, 'Clear Draft Order').props.disabled, true);
  assert.deepEqual(page.requests.filter(r => r.method === 'PATCH').map(r => r.body.order.map(e => e.teamId)), [expectedAscending]);
  page.h.unmount();
  const reloaded = await mount(f);
  tree = await reloaded.render(); seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await reloaded.render();
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), expectedAscending);
  reloaded.h.unmount();
});

test('clear resets all local slots; restart and early exit require confirmation without writes', async t => {
  let draws = 0, confirms = 0, accept = false;
  t.mock.method(globalThis.crypto, 'getRandomValues', values => { draws++; values[0] = 0; return values; });
  const previousWindow = global.window;
  t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
  global.window = { confirm: () => { confirms++; return accept; } };
  const f = createFixture(), page = await mount(f);
  let tree = await page.render(); seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await page.render();
  button(tree, 'Clear Draft Order').props.onClick();
  tree = await page.render();
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), ['', '', '', '']);
  assert.equal(button(tree, 'Initialize 2026-27 Draft Order').props.disabled, true);
  randomizeButton(tree).props.onClick(); tree = await page.render();
  assert.equal(draws, 3);
  showButton(tree, 4).props.onClick(); tree = await page.render();
  button(tree, 'Restart lottery').props.onClick(); tree = await page.render();
  assert.equal(draws, 3);
  assert.match(html(tree), /Andy/);
  button(tree, 'Exit reveal').props.onClick(); tree = await page.render();
  assert.match(html(tree), /Next up: Pick #3/);
  accept = true;
  button(tree, 'Restart lottery').props.onClick(); tree = await page.render();
  assert.equal(draws, 6);
  for (const name of participantNames) assert.doesNotMatch(html(tree), new RegExp(name));
  button(tree, 'Exit reveal').props.onClick(); tree = await page.render();
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), ['', '', '', '']);
  randomizeButton(tree).props.onClick(); tree = await page.render();
  button(tree, 'Clear Draft Order').props.onClick(); tree = await page.render();
  assert.equal(confirms, 4);
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), ['', '', '', '']);
  assert.deepEqual(f.writes, []);
  assert.equal(page.requests.filter(r => r.method !== 'GET').length, 0);
  page.h.unmount();
});

test('persisted clearing is unavailable, and clearing a replacement proposal leaves saved rows intact', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', values => { values[0] = 0; return values; });
  const f = createFixture(), before = structuredClone(f.tables), page = await mount(f);
  let tree = await page.render();
  assert.equal(button(tree, 'Clear Draft Order').props.disabled, true);
  button(tree, 'Clear Draft Order').props.onClick(); tree = await page.render();
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), [1, 2, 3, 4]);
  randomizeButton(tree).props.onClick(); tree = await page.render();
  for (const name of participantNames) assert.doesNotMatch(html(tree), new RegExp(name));
  button(tree, 'Clear Draft Order').props.onClick(); tree = await page.render();
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), ['', '', '', '']);
  assert.deepEqual(f.tables, before);
  assert.deepEqual(f.writes, []);
  page.h.unmount();
});

test('no saved-order clearing endpoint can bypass authorization or lifecycle protections', async () => {
  for (const [seasonId, season, setup] of [[8, 2027, () => {}], [8, 2027, f => { f.tables.nba_skins_seasons[0].status = 'locked'; }],
    [8, 2027, f => { f.tables.nba_skins_seasons[0].status = 'final'; }], [8, 2027, f => { f.tables.nba_skins_picks.push({ id: 800, season_id: 8 }); }],
    [4, 2025, () => {}], [9, 2026, () => {}], [8, 2027, f => { f.context.canAdministerGroup = false; }]]) {
    const f = createFixture(); setup(f);
    const before = structuredClone(f.tables);
    const response = await f.save([], { action: 'clear-order', seasonId, season });
    assert.ok(response.status >= 400);
    const emptySave = await f.save([], { seasonId, season, initializeParticipants: false });
    assert.ok(emptySave.status >= 400, 'an empty save is not a supported way to clear persisted participants');
    assert.deepEqual(f.tables, before); assert.deepEqual(f.writes, []);
  }
});

test('read-only and inconsistent seasons cannot start or clear a lottery', async () => {
  for (const setup of [f => { f.tables.nba_skins_seasons[0].status = 'locked'; }, f => { f.tables.nba_skins_seasons[0].status = 'final'; },
    f => { f.tables.nba_skins_seasons[0].draft_locked_at = '2026-10-19'; }, f => { f.tables.nba_skins_seasons[0].finalized_at = '2026-10-19'; },
    f => { f.tables.nba_skins_picks.push({ id: 800, season_id: 8 }); }, f => { f.tables.nba_skins_draft_order = f.tables.nba_skins_draft_order.filter(r => r.id !== 80); }]) {
    const f = createFixture(); setup(f);
    const page = await mount(f); const tree = await page.render();
    assert.equal(randomizeButton(tree).props.disabled, true);
    assert.equal(button(tree, 'Clear Draft Order').props.disabled, true);
    randomizeButton(tree).props.onClick();
    assert.doesNotMatch(html(await page.render()), /Ready for the reveal/);
    assert.deepEqual(f.writes, []); page.h.unmount();
  }
  const f = createFixture(), page = await mount(f);
  let tree = await page.render(); seasonSelect(tree).props.onChange({ target: { value: '4' } });
  tree = await page.render();
  assert.equal(randomizeButton(tree).props.disabled, true);
  assert.equal(button(tree, 'Clear Draft Order').props.disabled, true);
  page.h.unmount();
});

test('crypto failure keeps manual controls and does not change or write the proposed order', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('Secure random source unavailable.'); });
  const f = createFixture(), page = await mount(f);
  let tree = await page.render();
  randomizeButton(tree).props.onClick(); tree = await page.render();
  assert.match(html(tree), /Secure random source unavailable/);
  assert.deepEqual(orderSelects(tree).map(s => s.props.value), [1, 2, 3, 4]);
  assert.deepEqual(f.writes, []); page.h.unmount();
});

test('an unverified save keeps the completed reveal and can retry verification without another write', async t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', values => { values[0] = 0; return values; });
  const f = createFixture();
  let failGet = false;
  const page = await mount(f, async (_url, options) => {
    if (options.method === 'PATCH') {
      const response = await f.admin.PATCH(new Request('http://local/api/admin/nba-skins', options));
      failGet = true; return response;
    }
    if (failGet) { failGet = false; return Response.json({ error: 'Verification read failed.' }, { status: 500 }); }
    return f.admin.GET();
  });
  let tree = await page.render(); seasonSelect(tree).props.onChange({ target: { value: '7' } });
  tree = await page.render(); randomizeButton(tree).props.onClick();
  for (const pick of [4, 3, 2, 1]) { tree = await page.render(); showButton(tree, pick).props.onClick(); }
  tree = await page.render(); await button(tree, 'Initialize 2026-27 Draft Order').props.onClick();
  tree = await page.render();
  assert.match(html(tree), /Verification read failed/);
  assert.match(html(tree), /Draft order revealed/);
  assert.doesNotMatch(html(tree), /Saved order · verified/);
  assert.deepEqual(orderIds(f, 7), expectedAscending);
  const writes = f.writes.length;
  await button(tree, 'Verify saved order').props.onClick(); tree = await page.render();
  assert.match(html(tree), /Saved order · verified after reload/);
  assert.equal(f.writes.length, writes);
  assert.equal(page.requests.filter(r => r.method === 'PATCH').length, 1);
  page.h.unmount();
});
