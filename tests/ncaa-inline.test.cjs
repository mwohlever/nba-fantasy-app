/* Real Scores controller + URL hooks; captured GET-handler data, no database writes. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const { parseNcaaLiveOverview: parse, ncaaLiveOverviewHref: href } = require('../lib/live-scores/ncaaUrlState.ts');
const { useNcaaLiveUrl } = require('../lib/live-scores/useNcaaLiveUrl.ts');
const { getGroupSwitchDestination } = require('../lib/groups/navigation.ts');
const Page = require('../app/ncaa-pickem/scores/page.tsx').default;
const Card = require('../components/ncaa/NcaaScoreCard.tsx').default;
const Center = require('../components/ncaa/NcaaGameCenter.tsx').default;
const Modal = require('../components/ncaa/NcaaGameCenterModal.tsx').default;
const routeData = require('./helpers/ncaa-game-center-route-data.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function browser(search) {
  context.pathname = '/ncaa-pickem/scores'; context.search = search;
  context.group = 'group-a'; context.loading = false; context.switching = false;
  const entries = [{ search, state: null }]; let index = 0;
  function navigate(state, url, push) {
    const entry = { state, search: new URL(url, 'http://test').search };
    if (push) { entries.splice(index + 1); entries.push(entry); index++; } else entries[index] = entry;
    context.search = entry.search;
  }
  global.window = { location: { get search() { return context.search; } }, scrollTo() {}, setInterval, clearInterval, history: {
    get state() { return entries[index].state; },
    pushState: (state, _, url) => navigate(state, url, true),
    replaceState: (state, _, url) => navigate(state, url, false),
    back() { if (index) context.search = entries[--index].search; },
    forward() { if (index + 1 < entries.length) context.search = entries[++index].search; },
  } };
}

test('NCAA detail URL round trips tabs/quarter/team; standings excludes detail and invalid calendar is safe', () => {
  for (const tab of ['summary', 'pbp', 'stats']) {
    const state = parse(`season=2026&week=5&gameId=401858473&tab=${tab}&period=4&statsTeam=194`);
    assert.deepEqual(parse(href(state).split('?')[1]), state);
  }
  assert.equal(parse('gameId=').view, 'detail');
  assert.equal(parse('season=oops&week=6&gameId=123').calendar, null);
  assert.equal(parse('gameId=123&period=-1&statsTeam=bad').period, null);
  assert.doesNotMatch(href(parse('view=standings&gameId=123&tab=pbp')), /gameId|tab/);
});

test('NCAA URL uses push for opening, replace for tabs; Back/Forward and calendar change keep context', () => {
  browser('?season=2026&week=5'); const h = host(() => useNcaaLiveUrl('group-a'));
  h.render({}, true).openGame('401858473');
  let live = h.render({}, true); assert.equal(live.state.view, 'detail');
  live.selectDetail({ tab: 'pbp', period: 4 }); live = h.render({}, true);
  live.selectDetail({ tab: 'stats' }); live.selectDetail({ period: 3 });
  assert.equal(parse(context.search).tab, 'stats', 'Same-commit quarter correction retains the newer tab');
  live = h.render({}, true);
  live.backToGames(); assert.equal(h.render({}, true).state.view, 'games');
  window.history.forward(); live = h.render({}, true); assert.equal(live.state.tab, 'stats');
  live.selectCalendar({ season: 2025, week: 6 });
  assert.deepEqual(h.render({}, true).state, { view: 'games', calendar: { season: 2025, week: 6 } });
  browser('?season=2026&week=5&gameId=401858473');
  const direct = host(() => useNcaaLiveUrl('group-a')); direct.render({}, true).backToGames();
  assert.equal(parse(context.search).view, 'games'); h.unmount(); direct.unmount();
});

test('REAL NCAA Scores: overview → card → inline, direct/reload, stale week/season/ID and Group request isolation', async () => {
  const { scores } = await routeData(); const original = global.fetch;
  browser('?season=2026&week=5'); const calls = [];
  global.fetch = async url => {
    calls.push({ url, group: context.group });
    const params = new URL(url, 'http://test').searchParams;
    return { ok: true, json: async () => url.includes('/scores')
      ? { ...scores, games: params.get('week') === '6' || params.get('season') === '2025' ? [] : scores.games }
      : { teamIds: [] } };
  };
  const content = Page().props.children.type, h = host(content);
  async function settle() { let tree; for (let i = 0; i < 5; i++) { tree = h.render({}, true); await tick(); } return tree; }
  try {
    let tree = await settle(); assert.equal(nodes(tree).filter(n => n.type === Center).length, 0);
    const card = nodes(tree).find(n => n.type === Card); assert.ok(card); card.props.onClick();
    tree = await settle(); const center = nodes(tree).find(n => n.type === Center);
    assert.ok(center); assert.equal(center.props.game.espnEventId, '401858473');
    assert.equal(nodes(tree).filter(n => n.type === Modal || n.type === Card).length, 0);
    center.props.onDetailChange({ tab: 'stats' }); tree = await settle();
    assert.equal(nodes(tree).find(n => n.type === Center).props.tab, 'stats');
    center.props.onBack(); assert.ok(nodes(await settle()).some(n => n.type === Card));
    window.history.forward(); assert.ok(nodes(await settle()).some(n => n.type === Center));
    h.remount({}, true); assert.ok(nodes(await settle()).some(n => n.type === Center), 'Reload/direct restores detail');
    context.switching = true; assert.ok(!nodes(await settle()).some(n => n.type === Center), 'Hide old Group data while switching');
    context.group = 'group-b'; context.switching = false; tree = await settle();
    assert.equal(nodes(tree).find(n => n.type === Center).props.scope.groupId, 'group-b');
    assert.ok(calls.some(c => c.group === 'group-b' && c.url.includes('/scores')));
    for (const query of ['season=2026&week=6&gameId=401858473', 'season=2025&week=5&gameId=401858473', 'season=2026&week=5&gameId=999999', 'season=2026&week=5&gameId=bad', 'season=2026&week=5&gameId=']) {
      context.search = `?${query}`; tree = await settle();
      assert.equal(parse(context.search).view, 'games', query); assert.ok(!nodes(tree).some(n => n.type === Center));
      assert.equal(parse(context.search).calendar.week, Number(new URLSearchParams(query).get('week')));
    }
  } finally { h.unmount(); global.fetch = original; }
});

test('Group navigation preserves public NCAA detail only for enabled NCAA; explicit Group IDs cannot transfer', () => {
  const input = { pathname: '/ncaa-pickem/scores', search: '?season=2026&week=5&gameId=401858473&tab=pbp&period=4', targetGroupSlug: 'b', enabledSports: ['ncaa'], canAdministerGroup: false };
  assert.equal(getGroupSwitchDestination(input), '/ncaa-pickem/scores?season=2026&week=5&gameId=401858473&tab=pbp&period=4');
  assert.equal(getGroupSwitchDestination({ ...input, enabledSports: ['nfl'] }), '/groups/b');
  assert.equal(getGroupSwitchDestination({ ...input, search: `${input.search}&groupId=a` }), '/groups/b');
});
