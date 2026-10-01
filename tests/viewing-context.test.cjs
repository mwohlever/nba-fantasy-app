/* eslint-disable @typescript-eslint/no-require-imports */
/* Behavioral tests with synthetic hooks/URL/storage; real browser checks are separate. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { renderToStaticMarkup } = require('react-dom/server');
const { host, nodes, context, React } = require('./helpers/scores-harness.cjs');
const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');
const { resolveViewingValue, viewingStorageKey, viewingNavigationHref, readViewingMemory, writeViewingMemory } = require('../lib/viewing-context/context.ts');
const { useViewingContext } = require('../lib/viewing-context/useViewingContext.ts');
const Selector = require('../components/ui/ViewingContextSelector.tsx').default;
const Boundary = require('../components/lineups/SlateViewingBoundary.tsx').default;
const Ticker = require('../components/home/FunFactCarousel.tsx').default;
const Home = require('../components/home/SportHomePage.tsx').default().props.children.type;
const SkinsHome = require('../app/nba-skins/page.tsx').default;
const SkinsDraft = require('../app/nba-skins/draft/page.tsx').default;
const SkinsStandings = require('../app/nba-skins/standings/page.tsx').default;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(h, props = {}) { let tree; for (let i = 0; i < 6; i++) { tree = h.render(props, true); await tick(); } return tree; }
const options = [{ value: 190, label: 'Week 4' }, { value: 180, label: 'Week 2' }];
function hook(props) { return host(() => useViewingContext(props)); }
function reset(game = 'nfl', search = `sport=${game}`, stored = {}, path = '/home') {
  context.group = 'a'; context.sport = game; context.loading = false; context.switching = false;
  return installViewingBrowser(path, search, stored);
}

test('resolver checks URL then remembered then default against authoritative availability', () => {
  const base = { available: [190, 180], remembered: '180', fallback: 190 };
  assert.equal(resolveViewingValue({ ...base, explicit: '190' }), 190);
  for (const explicit of [null, '', 'junk', '-1', '1.8', '190suffix', '9007199254740992', '149', '191', '192']) {
    assert.equal(resolveViewingValue({ ...base, explicit }), 180);
  }
  assert.equal(resolveViewingValue({ ...base, explicit: '191', remembered: '999' }), 190);
  assert.equal(resolveViewingValue({ ...base, available: [] }), null);
});

test('storage keys isolate Group, sport, NBA fantasy versus Skins, and dimension', () => {
  const keys = ['a', 'b'].flatMap(group => ['nba', 'nfl', 'golf', 'nba-skins'].flatMap(game => ['slate', 'season'].map(dimension => viewingStorageKey(group, game, dimension))));
  assert.equal(new Set(keys).size, 16);
  const throwing = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(readViewingMemory(throwing, keys[0]), null);
  assert.doesNotThrow(() => writeViewingMemory(throwing, keys[0], 190));
});

test('hook gives valid URL precedence, restores memory, canonicalizes invalid/deleted IDs, and survives storage denial', async () => {
  const key = viewingStorageKey('a', 'nfl', 'slate');
  for (const [search, stored, expected] of [
    ['sport=nfl&slateId=190', '180', 190], ['sport=nfl', '180', 180],
    ['sport=nfl&slateId=bad', '180', 180], ['sport=nfl&slateId=149', '180', 180],
    ['sport=nfl&slateId=191', '999', 190], ['sport=nfl', '999', 190],
  ]) {
    const browser = reset('nfl', search, { [key]: stored });
    const h = hook({ game: 'nfl', options, fallback: 190 });
    const state = await settle(h);
    assert.equal(state.value, expected); assert.equal(state.ready, true);
    assert.equal(new URLSearchParams(context.search).get('slateId'), String(expected));
    assert.equal(browser.memory.get(key), String(expected)); h.unmount();
  }
  reset(); Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('denied'); } });
  const h = hook({ game: 'nfl', options, fallback: 190 });
  assert.equal((await settle(h)).value, 190); h.unmount();
});

for (const game of ['nba', 'nfl', 'golf', 'nba-skins']) test(`${game}: selectors update URL/memory and every shared navigation destination, with refresh/deep links`, async () => {
  const skins = game === 'nba-skins';
  const routes = skins ? ['/nba-skins', '/nba-skins/draft', '/nba-skins/standings'] : ['/home', '/lineups/draft', '/lineups/scores'];
  const dimension = skins ? 'season' : 'slate';
  const key = viewingStorageKey('a', game, dimension);
  const list = skins ? [{ value: 2026, label: '2026-27' }, { value: 2025, label: '2025-26' }] : options;
  const browser = reset(game, skins ? '' : `sport=${game}`, {}, routes[0]);
  let h = hook({ game, options: list, fallback: list[0].value });
  let state = await settle(h);
  for (const route of routes) {
    const control = nodes(Selector({ label: skins ? 'Season' : 'Slate', options: list, value: state.value, onChange: state.select })).find(n => n.type === 'select');
    control.props.onChange({ target: { value: String(list[1].value) } });
    state = await settle(h);
    assert.equal(state.value, list[1].value); assert.equal(browser.memory.get(key), String(list[1].value));
    const href = viewingNavigationHref(`${route}${skins ? '' : `?sport=${game}`}`, game, context.pathname, context.search);
    assert.equal(new URL(href, 'http://test').searchParams.get(skins ? 'season' : 'slateId'), String(list[1].value));
    browser.navigate(href, 'link'); h.unmount();
    // New page mount also models refresh/direct URL with the same authorized list.
    h = hook({ game, options: list, fallback: list[0].value }); state = await settle(h);
    assert.equal(state.value, list[1].value);
  }
  h.unmount();
});

test('sport switching and Live destinations cannot inherit fantasy slate or Skins season', () => {
  for (const href of ['/live-scores?sport=nfl', '/live-scores?sport=nba', '/golf/live', '/profile?sport=nfl']) {
    assert.equal(viewingNavigationHref(href, 'nfl', '/lineups/scores', 'sport=nfl&slateId=190'), href);
  }
  assert.equal(viewingNavigationHref('/lineups/draft?sport=nba', 'nba', '/home', 'sport=nfl&slateId=190'), '/lineups/draft?sport=nba');
});

test('Group switching restores only destination memory; old server payload and route sport cannot canonicalize', async () => {
  const browser = reset('nfl', 'sport=nfl', { [viewingStorageKey('a', 'nfl', 'slate')]: '180', [viewingStorageKey('b', 'nfl', 'slate')]: '280' });
  const h = host(props => useViewingContext(props));
  let props = { game: 'nfl', options, fallback: 190, serverGroupId: 'a', serverValue: 180 };
  assert.equal((await settle(h, props)).value, 180);
  context.group = 'b'; context.search = 'sport=nfl';
  assert.equal((await settle(h, props)).ready, false);
  props = { ...props, serverGroupId: 'b', serverValue: 290, fallback: 290, options: [{ value: 290, label: 'Week 4' }, { value: 280, label: 'Week 2' }] };
  assert.equal((await settle(h, props)).value, 280);
  context.search = 'sport=nba&slateId=149';
  const before = browser.navigation.length;
  assert.equal((await settle(h, props)).ready, false);
  assert.equal(browser.navigation.length, before); h.unmount();
});

test('server boundary blocks mismatched slate payload and renders one compact selector', async () => {
  reset('nfl', 'sport=nfl&slateId=180');
  const h = host(Boundary);
  let props = { groupId: 'a', sport: 'nfl', options, selectedId: 190, children: React.createElement('div', null, 'Week 4 data') };
  let tree = await settle(h, props);
  assert.ok(!nodes(tree).some(n => n.props?.children === 'Week 4 data'));
  props = { ...props, selectedId: 180, children: React.createElement('div', null, 'Week 2 data') };
  tree = await settle(h, props);
  assert.ok(nodes(tree).some(n => n.props?.children === 'Week 2 data'));
  assert.equal(nodes(tree).filter(n => n.type === 'select').length, 1);
  const markup = renderToStaticMarkup(tree);
  assert.match(markup, /min-w-0/); assert.match(markup, /w-full/); assert.doesNotMatch(markup, /min-w-\[|hero/); h.unmount();
});

for (const game of ['nba', 'nfl', 'golf']) test(`${game} Home fetches chosen resource, rejects stale responses, and exposes its selector`, async () => {
  reset(game, `sport=${game}&slateId=180`);
  const calls = []; let late;
  global.fetch = async url => {
    calls.push(url);
    if (url.includes('/api/home-summary')) {
      if (url.includes('slateId=190')) await new Promise(resolve => { late = resolve; });
      return { ok: true, json: async () => ({ groupId: 'a', sport: game, availableSlates: options, latestSlate: { id: url.includes('slateId=190') ? 190 : 180, date: '2026-09-10', start_date: '2026-09-10', end_date: '2026-09-14', is_locked: true }, latestSlateRows: [], seasonSnapshot: [], funFacts: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const h = host(Home); let tree = await settle(h);
  const content = nodes(tree);
  const tickerIndex = content.findIndex(node => node.type === Ticker);
  const selectorIndex = content.findIndex(node => node.type === Selector);
  const slateIndex = content.findIndex(node => node.props?.className?.includes('home-current-slate'));
  assert.ok(tickerIndex >= 0 && tickerIndex < selectorIndex && selectorIndex < slateIndex, 'ticker, selector, then main Home content');
  const selector = content.find(n => n.type === 'select');
  assert.equal(selector.props.value, 180);
  assert.ok(calls.some(url => url.includes(`sport=${game}&slateId=180`)));
  selector.props.onChange({ target: { value: '190' } }); h.render({}, true); await tick();
  window.history.pushState(null, '', `/home?sport=${game}&slateId=180`);
  tree = await settle(h); late?.(); tree = await settle(h);
  assert.equal(nodes(tree).find(n => n.type === 'select').props.value, 180); h.unmount();
});

for (const [Component, pathname, endpoint] of [[SkinsHome, '/nba-skins', 'standings'], [SkinsDraft, '/nba-skins/draft', 'draft'], [SkinsStandings, '/nba-skins/standings', 'standings']]) test(`${pathname}: historical selector/URL and read-only draft`, async () => {
  reset('nba-skins', 'season=2025', {}, pathname);
  const calls = [];
  global.fetch = async url => {
    calls.push(url); const year = url.includes('season=2026') ? 2026 : 2025;
    const season = { id: year, season: year, label: `${year}-${String(year + 1).slice(-2)}`, status: 'final', editable: false };
    return { ok: true, json: async () => ({ availableSeasons: [2026, 2025].map(season => ({ season, label: `${season}-${String(season + 1).slice(-2)}` })), selectedSeason: season, season, rules: { nbaTeamsPerParticipant: 7 }, standings: [], picks: [], hasValidDraftOrder: true, draftOrder: [], nbaTeams: [] }) };
  };
  const h = host(Component); let tree = await settle(h);
  let select = nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === 'Season');
  assert.equal(select.props.value, 2025);
  assert.ok(calls.some(url => url.includes(`/api/nba-skins/${endpoint}`) && url.includes('season=2025')));
  assert.ok(!nodes(tree).some(n => n.type === 'button' && n.props.children === 'Save Draft'));
  if (endpoint === 'standings') assert.doesNotMatch(renderToStaticMarkup(tree), /7\/7 picks/);
  select.props.onChange({ target: { value: '2026' } }); tree = await settle(h);
  select = nodes(tree).find(n => n.type === 'select' && n.props['aria-label'] === 'Season');
  assert.equal(select.props.value, 2026); assert.equal(new URLSearchParams(context.search).get('season'), '2026'); h.unmount();
});


test('a resolved absence of Group is terminal on every context page; stored hints never trigger unscoped requests', async () => {
  for (const [Component, pathname] of [[SkinsHome, '/nba-skins'], [SkinsDraft, '/nba-skins/draft'], [SkinsStandings, '/nba-skins/standings']]) {
    reset('nba-skins', 'season=2025', {}, pathname); context.group = null;
    global.fetch = () => { throw Error('unscoped request'); };
    const h = host(Component), tree = await settle(h);
    assert.match(renderToStaticMarkup(tree), /No active Group is available/);
    h.unmount();
  }
  reset('nfl', 'sport=nfl&slateId=180'); context.group = null;
  const h = host(Boundary);
  const tree = await settle(h, { groupId: '__no_active_group__', sport: 'nfl', options: [], selectedId: null });
  assert.match(renderToStaticMarkup(tree), /No active Group is available/); h.unmount();
});
