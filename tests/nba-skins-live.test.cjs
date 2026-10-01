/* eslint-disable @typescript-eslint/no-require-imports */
/* Real components/handlers with synthetic hooks and read-only provider fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const { host, nodes, context, React } = require('./helpers/scores-harness.cjs');
const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');
const { renderToStaticMarkup } = require('react-dom/server');
const groupContext = () => ({ group: { id: context.group, name: 'Test Group', slug: 'test' }, membership: { role: 'member' },
  leagues: ['nba', 'nba_skins'].map(sportKey => ({ id: `${sportKey}-${context.group}`, sportKey, gameMode: 'standard', isEnabled: true })) });
const previousLoad = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request.includes('providers/GroupProvider')) return { useGroupContext: () => ({ groupContext: groupContext(), availableGroups: [], isLoading: false, isSwitchingGroup: context.switching }) };
  return previousLoad.call(this, request, parent, ...rest);
};
const Live = require('../components/live-scores/NbaLiveScores.tsx').default;
const Center = require('../components/live-scores/NbaGameCenterModal.tsx').default;
const Court = require('../components/live-scores/NbaPlayCourt.tsx').default;
const OwnerLabel = require('../components/live-scores/FantasyOwnerLabel.tsx').default;
const Nav = require('../components/AppNav.tsx').default().props.children.type;
const { viewingNavigationHref, viewingStorageKey } = require('../lib/viewing-context/context.ts');
const { useViewingContext } = require('../lib/viewing-context/useViewingContext.ts');
const { easternToday, nbaDateKey, shiftNbaDate } = require('../lib/live-scores/nbaDate.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(h, props = {}) { let tree; for (let i = 0; i < 5; i++) { tree = h.render(props, true); await tick(); } return tree; }
function find(tree, type, label) { return nodes(tree).find(n => n.type === type && (n.props.children === label || n.props['aria-label'] === label)); }
function reset(pathname = '/nba-skins/live', search = '') {
  context.group = 'a'; context.sport = 'nba'; context.switching = false;
  const browser = installViewingBrowser(pathname, search);
  Object.assign(window, { setInterval, clearInterval, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  return browser;
}
const team = (id) => ({ id, displayName: `Team ${id}`, abbreviation: id, score: 10 });
const game = { espnEventId: '123', name: 'A at H', awayTeam: team('A'), homeTeam: team('H'), status: 'post', statusDetail: 'Final', startAt: '2026-10-01T00:00:00Z' };
const play = (id, period) => ({ id, period, text: `Play ${id}`, shootingPlay: true, pointsAttempted: 2, scoreValue: 2, coordinate: { x: 25, y: 10 }, teamId: 'A', clock: '1:00', awayScore: 10, homeScore: 10 });
const detail = () => ({ header: { competitions: [{ status: { type: { state: 'post' } }, competitors: [] }] },
  plays: [play('first', 1), play('last', 4)], boxscore: { players: [{ team: team('A'), statistics: [{ labels: ['PTS'], athletes: [{ athlete: { id: '42', displayName: 'Test Player' }, stats: ['10'] }] }] }] },
  ownership: { groupId: 'a', leagueId: 'nba-a', players: { '42': { name: 'Mark', isYou: true } } } });

// Load server modules with explicit dependency fixtures; never touch auth/DB/provider services.
function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
      return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`, mocks);
    }
    return require(name);
  }, exports);
  return exports;
}
function serverFixture(enabled = ['nba', 'nba_skins'], user = { id: 'viewer' }) {
  const calls = { leagues: [], scores: [], details: [], ownership: [] };
  const mocks = {
    '@/lib/auth': { getCurrentUser: async () => user },
    '@/lib/groups/context': { getActiveLeagueForSport: async (_user, sport) => {
      calls.leagues.push(sport); return enabled.includes(sport) ? { context: { group: { id: 'a' } }, league: { id: `${sport}-a` } } : null;
    } },
    '@/lib/providers/nbaLiveScores': { fetchNbaLiveScores: async date => { calls.scores.push(date); return [game]; } },
    '@/lib/live-scores/nbaGameDetail': { fetchNbaGameDetail: async id => { calls.details.push(id); const payload = detail(); delete payload.ownership; return payload; } },
    '@/lib/live-scores/nbaOwnership.server': { loadNbaOwnership: async (...args) => { calls.ownership.push(args); return detail().ownership; } },
    '@/components/AppNav': { __esModule: true, default: () => null },
    '@/components/live-scores/NbaLiveScores': { __esModule: true, default: Live },
    '@/components/live-scores/NflLiveScores': { __esModule: true, default: () => null },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers }) } },
  };
  return { calls, mocks };
}
const request = search => ({ nextUrl: new URL(`http://test/api?${search}`) });

test('desktop/mobile Skins navigation has Home, Draft, Live, Standings and active Skins Live context', () => {
  reset('/nba-skins/live', 'sport=nba&season=2025');
  const h = host(Nav), tree = h.render({});
  for (const [className, activeClass] of [['app-desktop-link', 'app-desktop-link-active'], ['app-mobile-nav-item', 'app-mobile-nav-active']]) {
    const links = nodes(tree).filter(n => n.props?.href?.startsWith('/nba-skins') && n.props.className?.includes(className));
    assert.deepEqual(links.map(n => n.props.href), ['/nba-skins', '/nba-skins/draft', '/nba-skins/live', '/nba-skins/standings']);
    assert.deepEqual(links.filter(n => n.props.className.includes(activeClass)).map(n => n.props.href), ['/nba-skins/live']);
  }
  assert.ok(nodes(tree).some(n => n.props?.['aria-label'] === 'Switch sport, currently NBA Skins'));
  assert.ok(nodes(tree).some(n => n.props?.className?.includes('grid-cols-4')));
  assert.equal(context.group, 'a'); h.unmount();
});

test('Skins page reuses NBA Live, authorizes Skins-only Groups, and keys by viewer/Group', async () => {
  const f = serverFixture(['nba_skins']);
  const page = load('app/nba-skins/live/page.tsx', f.mocks).default;
  const tree = await page();
  assert.equal(tree.type, Live); assert.equal(tree.props.context, 'nba-skins'); assert.equal(tree.key, 'viewer:a');
  assert.deepEqual(f.calls.leagues, ['nba_skins']); assert.equal(f.calls.ownership.length, 0);
  const denied = serverFixture(['nba']);
  assert.match(renderToStaticMarkup(await load('app/nba-skins/live/page.tsx', denied.mocks).default()), /NBA Skins is not enabled/);
  const anon = serverFixture([], null);
  assert.match(renderToStaticMarkup(await load('app/nba-skins/live/page.tsx', anon.mocks).default()), /Log in/);
  assert.equal(anon.calls.leagues.length, 0);
  const fantasy = await load('app/live-scores/page.tsx', f.mocks).default({ searchParams: Promise.resolve({ sport: 'nba' }) });
  assert.notEqual(fantasy.type, Live, 'Skins access does not authorize fantasy NBA');
  const regular = serverFixture(['nba']);
  assert.equal((await load('app/live-scores/page.tsx', regular.mocks).default({ searchParams: Promise.resolve({ sport: 'nba' }) })).type, Live);
});

for (const mode of ['nba', 'nba-skins']) test(`${mode}: shared scoreboard date controls, open/close Game Center, refresh and states`, async () => {
  reset(mode === 'nba' ? '/live-scores' : '/nba-skins/live', 'season=2025');
  const calls = []; let payload = { games: [game] }, ok = true;
  global.fetch = async url => { calls.push(url); return { ok, json: async () => payload }; };
  const h = host(Live), props = mode === "nba" ? {} : { context: mode }; let tree = await settle(h, props);
  assert.equal(new URL(calls[0], 'http://test').searchParams.get('date'), nbaDateKey(easternToday()));
  assert.ok(calls.every(url => !url.includes('season=')));
  assert.equal(new URL(calls[0], 'http://test').searchParams.get('context'), mode === 'nba-skins' ? 'nba-skins' : null);
  find(tree, 'input', 'NBA schedule date').props.onChange({ target: { value: '2026-04-15' } }); tree = await settle(h, props);
  find(tree, 'button', 'Next day').props.onClick(); tree = await settle(h, props);
  assert.equal(find(tree, 'input', 'NBA schedule date').props.value, shiftNbaDate('2026-04-15', 1));
  find(tree, 'button', 'Previous day').props.onClick(); tree = await settle(h, props);
  const card = nodes(tree).find(n => n.type?.name === 'GameCard');
  assert.equal(card.props.game, game); card.props.onClick(); tree = h.render(props);
  const modal = nodes(tree).find(n => n.type === Center); assert.equal(modal.props.context, mode);
  modal.props.onClose(); assert.ok(!nodes(h.render(props)).some(n => n.type === Center));
  find(tree, 'button', 'Refresh NBA scores').props.onClick(); await tick();
  payload = { games: [] }; find(tree, 'input', 'NBA schedule date').props.onChange({ target: { value: '2026-04-20' } }); tree = await settle(h, props);
  assert.ok(nodes(tree).some(n => n.props?.children === 'No NBA games scheduled for this date.'));
  ok = false; payload = { error: 'Provider unavailable' }; find(tree, 'button', 'Refresh NBA scores').props.onClick(); tree = await settle(h, props);
  assert.ok(nodes(tree).some(n => n.props?.children === 'Provider unavailable')); h.unmount();
});

for (const mode of ['nba', 'nba-skins']) test(`${mode}: real Game Center tabs/PBP replay and explicit ownership presentation`, async () => {
  reset(); const calls = [];
  // Even a payload containing owners cannot annotate Skins.
  global.fetch = async url => { calls.push(url); const body = detail(); if (mode === 'nba-skins') body.ownership.leagueId = 'nba_skins-a'; return { ok: true, json: async () => body }; };
  const h = host(Center), props = { game, onClose() {}, ...(mode === "nba-skins" ? { context: mode } : {}) }; let tree = await settle(h, props);
  assert.deepEqual(nodes(tree).filter(n => n.type === 'button' && ['Summary', 'Play-by-Play', 'Player Stats'].includes(n.props.children)).map(n => n.props.children), ['Summary', 'Play-by-Play', 'Player Stats']);
  assert.ok(nodes(tree).some(n => n.type?.name === 'Summary'));
  assert.equal(new URL(calls[0], 'http://test').searchParams.get('groupId'), 'a');
  assert.equal(new URL(calls[0], 'http://test').searchParams.get('context'), mode === 'nba-skins' ? mode : null);
  find(tree, 'button', 'Play-by-Play').props.onClick(); tree = h.render(props);
  const pbp = nodes(tree).find(n => n.type?.name === 'Pbp'), ph = host(pbp.type); let pt = await settle(ph, pbp.props);
  assert.equal(nodes(pt).find(n => n.type === Court).props.play.id, 'last');
  find(pt, 'button', 'Q1').props.onClick(); pt = await settle(ph, pbp.props);
  assert.equal(nodes(pt).find(n => n.type === Court).props.play.id, 'first');
  nodes(pt).find(n => n.type === 'button' && n.props.className?.includes('block w-full')).props.onClick(); pt = await settle(ph, pbp.props);
  assert.equal(nodes(pt).find(n => n.type === Court).props.play.id, 'first'); ph.unmount();
  find(tree, 'button', 'Player Stats').props.onClick(); tree = h.render(props);
  const stats = nodes(tree).find(n => n.type?.name === 'Stats'), sh = host(stats.type), st = await settle(sh, stats.props);
  const labels = nodes(st).filter(n => n.type === OwnerLabel);
  assert.equal(stats.props.showFantasyOwnership, mode === 'nba');
  if (mode === 'nba') assert.match(renderToStaticMarkup(React.createElement(OwnerLabel, labels[0].props)), /Mark.*You/);
  else { assert.equal(labels.length, 0); assert.equal(stats.props.ownership, undefined); }
  assert.ok(nodes(st).filter(n => n.type === 'tr').every(n => !n.props.className?.includes('bg-sky')));
  context.group = 'b'; tree = await settle(h, props);
  find(tree, 'button', 'Player Stats').props.onClick(); tree = h.render(props);
  assert.equal(nodes(tree).find(n => n.type?.name === 'Stats').props.ownership, undefined, 'stale Group owners are rejected');
  sh.unmount(); h.unmount();
});

for (const endpoint of ['scores', 'game-detail']) test(`${endpoint}: shared API authorizes correct game, ignores Skins season and rejects cross-Group requests`, async () => {
  for (const mode of ['nba', 'nba-skins']) {
    const sport = mode === 'nba' ? 'nba' : 'nba_skins', f = serverFixture([sport]);
    const route = load(`app/api/live-scores/nba/${endpoint}/route.ts`, f.mocks);
    const query = `context=${mode === "nba-skins" ? mode : ""}&season=2025&groupId=a&date=20260415&eventId=123`;
    const response = await route.GET(request(query)); assert.equal(response.status, 200);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(f.calls.leagues, [sport]);
    if (endpoint === 'scores') assert.deepEqual(f.calls.scores, ['20260415']);
    else { assert.deepEqual(f.calls.details, ['123']); assert.equal(f.calls.ownership.length, mode === 'nba' ? 1 : 0); assert.equal(Object.hasOwn(response.body, 'ownership'), mode === 'nba'); }
    const before = JSON.stringify(f.calls);
    assert.equal((await route.GET(request(query.replace('groupId=a', 'groupId=b')))).status, 409);
    assert.equal(JSON.stringify({ ...f.calls, leagues: [] }), JSON.stringify({ ...JSON.parse(before), leagues: [] }));
    const wrong = serverFixture([mode === 'nba' ? 'nba_skins' : 'nba']);
    assert.equal((await load(`app/api/live-scores/nba/${endpoint}/route.ts`, wrong.mocks).GET(request(query))).status, 403);
    assert.equal(wrong.calls.scores.length + wrong.calls.details.length + wrong.calls.ownership.length, 0);
    const anon = serverFixture([], null);
    assert.equal((await load(`app/api/live-scores/nba/${endpoint}/route.ts`, anon.mocks).GET(request(query))).status, 403);
    assert.equal(anon.calls.leagues.length, 0);
  }
});

test('historical Skins season survives Live and restores on every season page with Group-isolated memory', async () => {
  const browser = reset('/nba-skins', 'season=2025');
  const options = [{ value: 2026, label: '2026-27' }, { value: 2025, label: '2025-26' }];
  const props = { game: 'nba-skins', options, fallback: 2026 };
  let h = host(() => useViewingContext(props)); assert.equal((await settle(h)).value, 2025); h.unmount();
  const key = viewingStorageKey('a', 'nba-skins', 'season');
  browser.navigate(viewingNavigationHref('/nba-skins/live', 'nba-skins', context.pathname, context.search), 'link');
  assert.equal(context.search, '');
  global.fetch = async () => ({ ok: true, json: async () => ({ games: [] }) });
  h = host(Live); await settle(h, { context: 'nba-skins' }); h.unmount();
  assert.equal(browser.memory.get(key), '2025'); assert.equal(context.search, '');
  for (const route of ['/nba-skins', '/nba-skins/draft', '/nba-skins/standings']) {
    browser.navigate('/nba-skins/live', 'link');
    browser.navigate(viewingNavigationHref(route, 'nba-skins', context.pathname, context.search), 'link');
    h = host(() => useViewingContext(props)); assert.equal((await settle(h)).value, 2025); h.unmount();
  }
  browser.navigate('/nba-skins/live', 'link'); context.group = 'b';
  browser.memory.set(viewingStorageKey('b', 'nba-skins', 'season'), '2026');
  browser.navigate('/nba-skins/standings', 'link');
  h = host(() => useViewingContext(props)); assert.equal((await settle(h)).value, 2026); h.unmount();
  assert.equal(browser.memory.get(key), '2025');
});

test.after(() => { Module._load = previousLoad; });
