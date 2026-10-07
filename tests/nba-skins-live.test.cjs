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
  leagues: (context.enabled ?? ['nba', 'nba_skins']).map(sportKey => ({ id: `${sportKey}-${context.group}`, sportKey, gameMode: 'standard', isEnabled: true })) });
const previousLoad = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request.includes('providers/GroupProvider')) return { useGroupContext: () => ({ groupContext: groupContext(), availableGroups: [], isLoading: false, isSwitchingGroup: context.switching }) };
  return previousLoad.call(this, request, parent, ...rest);
};
const Live = require('../components/live-scores/NbaLiveScores.tsx').default;
const Center = require('../components/live-scores/NbaGameCenter.tsx').default;
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
  context.group = 'a'; context.sport = 'nba'; context.switching = false; context.enabled = ['nba', 'nba_skins'];
  const browser = installViewingBrowser(pathname, search);
  Object.assign(window, { setInterval, clearInterval, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const history = [{ href: `${pathname}${search ? `?${search}` : ""}`, state: null }]; let index = 0;
  const originalNavigate = browser.navigate;
  function apply(href, method) { originalNavigate(href, method); }
  window.history = {
    get state() { return history[index].state; },
    pushState(state, _title, href) { history.splice(index + 1); history.push({ href, state }); index++; apply(href, 'push'); },
    replaceState(state, _title, href) { history[index] = { href, state }; apply(href, 'replace'); },
    back() { if (index > 0) apply(history[--index].href, 'back'); },
    forward() { if (index + 1 < history.length) apply(history[++index].href, 'forward'); },
  };
  browser.history = history; browser.reload = () => apply(history[index].href, 'reload');
  return browser;
}
const team = (id) => ({ id, displayName: `Team ${id}`, abbreviation: id, score: 10 });
const game = { espnEventId: '123', name: 'A at H', awayTeam: team('A'), homeTeam: team('H'), status: 'post', statusDetail: 'Final', startAt: '2026-10-01T00:00:00Z' };
const play = (id, period) => ({ id, period, text: `Play ${id}`, shootingPlay: true, pointsAttempted: 2, scoreValue: 2, coordinate: { x: 25, y: 10 }, teamId: 'A', clock: '1:00', awayScore: 10, homeScore: 10 });
const detail = (id = '123') => ({ eventId: id, header: { id, name: 'A at H', competitions: [{ date: game.startAt, status: { type: { state: 'post' } }, competitors: [{ homeAway: 'away', team: team('A'), score: '10' }, { homeAway: 'home', team: team('H'), score: '10' }] }] },
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
  reset(mode === 'nba' ? '/live-scores' : '/nba-skins/live', mode === 'nba' ? 'sport=nba&season=2025' : 'season=2025');
  const calls = []; let payload = { games: [game] }, ok = true;
  global.fetch = async url => { if (url.endsWith("/favorites")) return Response.json({ teamIds: [] }); calls.push(url); return { ok, json: async () => payload }; };
  const h = host(Live), props = { context: mode, viewerId: 'viewer' }; let tree = await settle(h, props);
  assert.equal(new URL(calls[0], 'http://test').searchParams.get('date'), nbaDateKey(easternToday()));
  assert.ok(calls.every(url => !url.includes('season=')));
  assert.equal(new URL(calls[0], 'http://test').searchParams.get('context'), mode === 'nba-skins' ? 'nba-skins' : null);
  find(tree, 'input', 'NBA schedule date').props.onChange({ target: { value: '2026-04-15' } }); tree = await settle(h, props);
  find(tree, 'button', 'Next day').props.onClick(); tree = await settle(h, props);
  assert.equal(find(tree, 'input', 'NBA schedule date').props.value, shiftNbaDate('2026-04-15', 1));
  find(tree, 'button', 'Previous day').props.onClick(); tree = await settle(h, props);
  const card = nodes(tree).find(n => n.type?.name === 'GameCard');
  assert.equal(card.props.game, game); card.props.onClick(); tree = await settle(h, props);
  const modal = nodes(tree).find(n => n.type === Center); assert.equal(modal.props.context, mode);
  modal.props.onBack(); tree = await settle(h, props); assert.ok(!nodes(tree).some(n => n.type === Center));
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
  const h = host(Center), props = { game, eventId: game.espnEventId, viewerId: 'viewer', onBack() {}, ...(mode === "nba-skins" ? { context: mode } : {}) }; let tree = await settle(h, props);
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
  h = host(Live); await settle(h, { context: 'nba-skins', viewerId: 'viewer' }); h.unmount();
  assert.equal(browser.memory.get(key), '2025'); assert.equal(new URLSearchParams(context.search).has('season'), false); assert.equal(new URLSearchParams(context.search).get('date'), easternToday());
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



for (const mode of ['nba', 'nba-skins']) test(`${mode}: detail push, tab replace, Back/Forward and reload use the real URL adapter`, async () => {
  const path = mode === 'nba' ? '/live-scores' : '/nba-skins/live';
  const browser = reset(path, `${mode === 'nba' ? 'sport=nba&' : ''}date=2026-05-25`);
  const calls = []; global.fetch = async url => { calls.push(url); return { ok: true, json: async () => ({ games: [game] }) }; };
  const props = { context: mode, viewerId: 'viewer' }, h = host(Live);
  let tree = await settle(h, props);
  assert.equal(browser.navigation.length, 0, 'already canonical overview adds no history entry');
  nodes(tree).find(n => n.type?.name === 'GameCard').props.onClick(); tree = await settle(h, props);
  let center = nodes(tree).find(n => n.type === Center);
  assert.equal(center.props.eventId, '123'); assert.equal(center.props.tab, 'summary');
  assert.equal(browser.navigation.at(-1).method, 'push'); assert.equal(browser.history.length, 2);
  assert.equal(new URLSearchParams(context.search).get('date'), '2026-05-25');
  assert.ok(!find(tree, 'input', 'NBA schedule date'), 'large overview controls are absent');
  center.props.onTabChange('stats'); tree = await settle(h, props);
  assert.equal(browser.navigation.at(-1).method, 'replace'); assert.equal(browser.history.length, 2);
  assert.equal(nodes(tree).find(n => n.type === Center).props.tab, 'stats');
  browser.reload(); tree = h.remount(props); tree = await settle(h, props);
  center = nodes(tree).find(n => n.type === Center);
  assert.equal(center.props.eventId, '123'); assert.equal(center.props.tab, 'stats');
  center.props.onBack(); tree = await settle(h, props);
  assert.equal(browser.navigation.at(-1).method, 'back'); assert.ok(!nodes(tree).some(n => n.type === Center));
  window.history.forward(); tree = await settle(h, props);
  center = nodes(tree).find(n => n.type === Center); assert.equal(center.props.eventId, '123'); assert.equal(center.props.tab, 'stats');
  window.history.back(); tree = await settle(h, props); assert.ok(find(tree, 'input', 'NBA schedule date'));
  h.unmount();
});

for (const mode of ['nba', 'nba-skins']) test(`${mode}: date-free deep link loads only its event and canonicalizes its date via replace`, async () => {
  const path = mode === 'nba' ? '/live-scores' : '/nba-skins/live';
  const browser = reset(path, `${mode === 'nba' ? 'sport=nba&' : ''}gameId=123&tab=pbp`);
  const calls = []; global.fetch = async url => { calls.push(url); return { ok: true, json: async () => detail() }; };
  const props = { context: mode, viewerId: 'viewer' }, h = host(Live);
  let tree = await settle(h, props), center = nodes(tree).find(n => n.type === Center);
  assert.equal(calls.length, 0, 'detail does not depend on scoreboard or today');
  const ch = host(Center); await settle(ch, center.props);
  tree = await settle(h, props); center = nodes(tree).find(n => n.type === Center);
  assert.equal(calls.length, 1); assert.equal(new URL(calls[0], 'http://test').searchParams.get('eventId'), '123');
  assert.equal(new URLSearchParams(context.search).get('date'), '2026-09-30');
  assert.equal(center.props.tab, 'pbp'); assert.equal(browser.history.length, 1);
  assert.equal(browser.navigation.at(-1).method, 'replace');
  center.props.onBack(); tree = await settle(h, props);
  assert.equal(browser.navigation.at(-1).method, 'replace');
  assert.equal(new URLSearchParams(context.search).has('gameId'), false);
  assert.equal(new URLSearchParams(context.search).get('date'), '2026-09-30');
  ch.unmount(); h.unmount();
});

test('canonical default date replaces history and cleans stale fantasy/Skins identifiers', async () => {
  const browser = reset('/nba-skins/live', 'season=2025&slateId=9&tab=stats');
  global.fetch = async () => ({ ok: true, json: async () => ({ games: [] }) });
  const h = host(Live); const tree = await settle(h, { context: 'nba-skins', viewerId: 'viewer' });
  assert.equal(browser.history.length, 1); assert.equal(browser.navigation.length, 1);
  assert.deepEqual(browser.navigation[0], { method: 'replace', href: `/nba-skins/live?date=${easternToday()}` });
  assert.equal(find(tree, 'input', 'NBA schedule date').props.value, easternToday()); h.unmount();
});

for (const id of ['', 'invalid']) test(`invalid deep link gameId=${id} shows an error and deterministic Back to games`, async () => {
  const browser = reset('/live-scores', `sport=nba&date=2026-05-25&gameId=${id}`);
  let calls = 0; global.fetch = async () => { calls++; throw new Error('should not fetch'); };
  const h = host(Live), props = { viewerId: 'viewer' }; const tree = await settle(h, props);
  const center = nodes(tree).find(n => n.type === Center), ch = host(Center);
  const ct = await settle(ch, center.props); assert.equal(calls, 0);
  assert.match(nodes(ct).find(n => n.props?.role === 'alert').props.children, /Invalid NBA game ID/);
  nodes(ct).find(n => n.type === 'button' && n.props.children === '← Back to games').props.onClick();
  assert.equal(context.search, '?sport=nba&date=2026-05-25'); assert.equal(browser.navigation.at(-1).method, 'replace');
  ch.unmount(); h.unmount();
});

test('unavailable and mismatched detail never silently selects another game', async () => {
  reset(); const h = host(Center), props = { context: 'nba-skins', viewerId: 'viewer', eventId: '123', onBack() {} };
  global.fetch = async () => ({ ok: false, json: async () => ({ error: 'This NBA game is unavailable.' }) });
  let tree = await settle(h, props); assert.match(nodes(tree).find(n => n.props?.role === 'alert').props.children, /unavailable/);
  global.fetch = async () => ({ ok: true, json: async () => detail('999') });
  find(tree, 'button', 'Refresh game center').props.onClick(); tree = await settle(h, props);
  assert.match(nodes(tree).find(n => n.props?.role === 'alert').props.children, /unavailable/);
  assert.ok(!nodes(tree).some(n => n.type?.name === 'Summary')); h.unmount();
});

function deferredFetch() {
  const requests = [];
  global.fetch = (url, options) => url.endsWith("/favorites") ? Promise.resolve(Response.json({ teamIds: [] })) : new Promise((resolve, reject) => requests.push({ url, signal: options.signal, reject,
    resolve: (body, ok = true) => resolve({ ok, json: async () => body }) }));
  return requests;
}

test('rapid detail A → B → A ignores old success, error and completion even when abort is ignored', async () => {
  reset(); const requests = deferredFetch();
  const h = host(Center), props = { viewerId: 'viewer', context: 'nba', eventId: '123', tab: 'stats', onBack() {} };
  await settle(h, props); await settle(h, { ...props, eventId: '456' }); await settle(h, props);
  assert.equal(requests.length, 3); assert.equal(requests[0].signal.aborted, true); assert.equal(requests[1].signal.aborted, true);
  requests[0].resolve(detail('123')); requests[1].reject(new Error('stale error'));
  let tree = await settle(h, props);
  assert.ok(nodes(tree).some(n => n.props?.children === 'Loading game details…'));
  assert.ok(!nodes(tree).some(n => n.type?.name === 'Stats' || n.props?.role === 'alert'));
  const fresh = detail('123'); fresh.ownership.players['42'].name = 'Fresh owner'; requests[2].resolve(fresh);
  tree = await settle(h, props); assert.equal(nodes(tree).find(n => n.type?.name === 'Stats').props.ownership['42'].name, 'Fresh owner');
  assert.ok(!nodes(tree).some(n => n.props?.children === 'Loading game details…')); h.unmount();
});

test('scoreboard date A → B → A has the same generation and abort protection', async () => {
  reset('/live-scores', 'sport=nba&date=2026-05-25'); const requests = deferredFetch();
  const h = host(Live), props = { viewerId: 'viewer' };
  await settle(h, props); context.search = 'sport=nba&date=2026-05-26'; await settle(h, props);
  context.search = 'sport=nba&date=2026-05-25'; await settle(h, props);
  assert.equal(requests.length, 3); requests[2].resolve({ games: [game] }); let tree = await settle(h, props);
  requests[0].resolve({ games: [{ ...game, espnEventId: 'old' }] }); requests[1].reject(new Error('old date error')); tree = await settle(h, props);
  assert.equal(nodes(tree).find(n => n.type?.name === 'GameCard').props.game.espnEventId, '123');
  assert.ok(!nodes(tree).some(n => n.props?.role === 'alert')); h.unmount();
});

test('Group/viewer/app changes immediately remove ownership and supersede old detail requests', async () => {
  reset(); const requests = deferredFetch();
  const h = host(Center), props = { viewerId: 'viewer', eventId: '123', tab: 'stats', onBack() {} };
  await settle(h, props); requests[0].resolve(detail()); let tree = await settle(h, props);
  assert.equal(nodes(tree).find(n => n.type?.name === 'Stats').props.ownership['42'].isYou, true);
  context.group = 'b'; tree = h.render(props);
  assert.ok(!nodes(tree).some(n => n.type?.name === 'Stats'), 'old owners clear before effects');
  await settle(h, props); assert.equal(new URL(requests[1].url, 'http://test').searchParams.get('groupId'), 'b');
  let body = detail(); body.ownership.groupId = 'b'; body.ownership.leagueId = 'nba-b'; body.ownership.players['42'].name = 'Group B';
  requests[1].resolve(body); tree = await settle(h, props); assert.equal(nodes(tree).find(n => n.type?.name === 'Stats').props.ownership['42'].name, 'Group B');
  const otherViewer = { ...props, viewerId: 'other' }; tree = h.render(otherViewer);
  assert.ok(!nodes(tree).some(n => n.type?.name === 'Stats')); await settle(h, otherViewer);
  const skins = { ...otherViewer, context: 'nba-skins' }; tree = h.render(skins);
  assert.ok(!nodes(tree).some(n => n.type?.name === 'Stats')); await settle(h, skins);
  requests[2].resolve(body); requests[3].resolve(body); tree = await settle(h, skins);
  const stats = nodes(tree).find(n => n.type?.name === 'Stats'); assert.equal(stats.props.ownership, undefined); assert.equal(stats.props.showFantasyOwnership, false);
  context.switching = true; tree = h.render(skins); assert.ok(!nodes(tree).some(n => n.type?.name === 'Stats'));
  await settle(h, skins); assert.equal(requests.length, 4, 'no request during Group switch'); h.unmount();
});

test('detail opened in another Group uses deterministic overview instead of the old history entry', async () => {
  const browser = reset('/live-scores', 'sport=nba&date=2026-05-25');
  global.fetch = async () => ({ ok: true, json: async () => ({ games: [game] }) });
  const h = host(Live), props = { viewerId: 'viewer' }; let tree = await settle(h, props);
  nodes(tree).find(n => n.type?.name === 'GameCard').props.onClick(); tree = await settle(h, props);
  context.group = 'b'; tree = await settle(h, props); nodes(tree).find(n => n.type === Center).props.onBack();
  assert.equal(browser.navigation.at(-1).method, 'replace'); assert.equal(context.search, '?sport=nba&date=2026-05-25'); h.unmount();
});

test('same-event refresh keeps tab and selected stats team, and overlapping refresh accepts only the latest', async () => {
  reset(); const requests = deferredFetch();
  const h = host(Center), props = { viewerId: 'viewer', eventId: '123', onBack() {} };
  await settle(h, props); const body = detail(); body.boxscore.players.push({ team: team('H'), statistics: [] }); requests[0].resolve(body);
  let tree = await settle(h, props); find(tree, 'button', 'Player Stats').props.onClick(); tree = h.render(props);
  const stats = nodes(tree).find(n => n.type?.name === 'Stats'), sh = host(stats.type); let st = await settle(sh, stats.props);
  find(st, 'button', 'H').props.onClick(); st = await settle(sh, stats.props); assert.ok(find(st, 'button', 'H').props.className.includes('bg-sky-50'));
  find(tree, 'button', 'Refresh game center').props.onClick(); find(tree, 'button', 'Refresh game center').props.onClick();
  assert.equal(requests[1].signal.aborted, true); requests[2].resolve(body); tree = await settle(h, props);
  requests[1].reject(new Error('old refresh failed')); tree = await settle(h, props);
  const refreshed = nodes(tree).find(n => n.type?.name === 'Stats'); st = await settle(sh, refreshed.props);
  assert.ok(find(st, 'button', 'H').props.className.includes('bg-sky-50')); assert.equal(find(tree, 'button', 'Player Stats').props['aria-current'], 'page');
  assert.ok(!nodes(tree).some(n => n.props?.role === 'alert')); sh.unmount(); h.unmount();
});

test('Skins-only Group loads Live/inline detail with no fantasy UI and remembered season intact', async () => {
  const browser = reset('/nba-skins/live', 'date=2026-05-25&gameId=123&tab=stats'); context.enabled = ['nba_skins'];
  const key = viewingStorageKey('a', 'nba-skins', 'season'); browser.memory.set(key, '2025');
  global.fetch = async () => ({ ok: true, json: async () => detail() });
  const h = host(Live); let tree = await settle(h, { context: 'nba-skins', viewerId: 'viewer' });
  const center = nodes(tree).find(n => n.type === Center), ch = host(Center); const ct = await settle(ch, center.props);
  const stats = nodes(ct).find(n => n.type?.name === 'Stats'); assert.equal(stats.props.showFantasyOwnership, false); assert.equal(stats.props.ownership, undefined);
  assert.equal(browser.memory.get(key), '2025'); ch.unmount(); h.unmount();
});

test('incompatible NBA route context performs no requests and never rewrites NFL URLs', async () => {
  const browser = reset('/live-scores', 'sport=nfl&gameId=123&season=2025'); let calls = 0;
  global.fetch = async () => { calls++; throw new Error('incompatible'); };
  const h = host(Live); await settle(h, { viewerId: 'viewer' }); assert.equal(calls, 0); assert.equal(browser.navigation.length, 0); h.unmount();
});

for (const endpoint of ['scores', 'game-detail']) test(`${endpoint}: mismatched viewer/league and invalid detail IDs are rejected before provider/ownership`, async () => {
  const f = serverFixture(['nba_skins']), route = load(`app/api/live-scores/nba/${endpoint}/route.ts`, f.mocks);
  for (const extra of ['viewerId=other', 'leagueId=nba-a']) {
    assert.equal((await route.GET(request(`context=nba-skins&groupId=a&date=20260525&eventId=123&${extra}`))).status, 409);
  }
  assert.equal(f.calls.scores.length + f.calls.details.length + f.calls.ownership.length, 0);
  if (endpoint === 'game-detail') assert.equal((await route.GET(request('context=nba-skins&eventId=bad'))).status, 400);
  assert.equal(f.calls.details.length, 0);
});

test('inline replay observes the viewport, modal replay observes its scroll container, and only one court animates', async () => {
  reset(); const observers = [];
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  global.IntersectionObserver = window.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe() {} disconnect() { this.disconnected = true; }
  };
  global.fetch = async () => ({ ok: true, json: async () => detail() });
  const h = host(Center); let tree = await settle(h, { eventId: '123', viewerId: 'viewer', tab: 'pbp', onBack() {} });
  assert.ok(!nodes(tree).some(n => n.props?.className?.includes('overflow-y-auto') || n.props?.className?.includes('fixed inset')));
  assert.ok(!nodes(tree).some(n => n.type === 'main'), 'inline content has no nested overall scroll main');
  const pbp = nodes(tree).find(n => n.type?.name === 'Pbp');
  for (const presentation of ['inline', 'modal']) {
    const ph = host(pbp.type), p = { ...pbp.props, presentation };
    let pt = ph.render(p, true); const scrollRoot = {};
    nodes(pt).find(n => n.props?.ref).props.ref.current = { closest(selector) { assert.equal(selector, '[data-nba-modal-scroll]'); return scrollRoot; } };
    pt = await settle(ph, p); const observer = observers.at(-1);
    assert.equal(observer.options.root, presentation === 'inline' ? null : scrollRoot);
    observer.callback([{ isIntersecting: false }]); pt = await settle(ph, p);
    const courts = nodes(pt).filter(n => n.type === Court); assert.equal(courts.length, 2);
    assert.equal(courts[0].props.replayEnabled, false); assert.equal(courts[1].props.compact, true);
    const sticky = nodes(pt).find(n => n.props?.['data-nba-sticky-replay']);
    assert.ok(sticky.props.className.includes('sticky top-0'));
    assert.ok(nodes(sticky).some(n => n.props?.['aria-label'] === 'NBA quarters'), 'Quarters stay with compact court');
    find(pt, 'button', 'Q1').props.onClick(); pt = await settle(ph, p); assert.equal(nodes(pt).filter(n => n.type === Court)[1].props.play.id, 'first');
    observer.callback([{ isIntersecting: true }]); pt = await settle(ph, p); assert.equal(nodes(pt).filter(n => n.type === Court).length, 1);
    ph.unmount(); assert.equal(observer.disconnected, true);
  }
  h.unmount(); delete global.IntersectionObserver; delete window.IntersectionObserver;
});

test('thin modal wrapper remains available and owns overlay/scroll presentation only', () => {
  reset(); const Modal = require('../components/live-scores/NbaGameCenterModal.tsx').default;
  const tree = Modal({ game, viewerId: 'viewer', context: 'nba-skins', onClose() {} });
  assert.ok(tree.props.className.includes('fixed inset'));
  const center = nodes(tree).find(n => n.type === Center); assert.equal(center.props.presentation, 'modal'); assert.equal(center.props.eventId, '123');
});



for (const mode of ['nba', 'nba-skins']) test(`${mode}: mobile/desktop Live stays active and sport switching clears detail parameters atomically`, async () => {
  const browser = reset(mode === 'nba' ? '/live-scores' : '/nba-skins/live', `${mode === 'nba' ? 'sport=nba&' : ''}date=2026-05-25&gameId=123&tab=stats&slateId=99`);
  context.enabled = ['nba', 'nba_skins', 'nfl', 'golf'];
  let selections = 0; context.onSportChange = () => { selections++; };
  const h = host(Nav); let tree = h.render({});
  for (const activeClass of ['app-desktop-link-active', 'app-mobile-nav-active']) {
    const active = nodes(tree).filter(n => n.props?.className?.includes(activeClass));
    assert.ok(active.some(n => n.props?.href === (mode === 'nba' ? '/live-scores?sport=nba' : '/nba-skins/live')));
  }
  find(tree, 'button', `Switch sport, currently ${mode === 'nba' ? 'NBA' : 'NBA Skins'}`).props.onClick(); tree = h.render({});
  const nfl = nodes(tree).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes('NFL'));
  assert.ok(nfl); nfl.props.onClick();
  assert.deepEqual(browser.navigation.at(-1), { href: '/live-scores?sport=nfl', method: 'push' });
  assert.equal(selections, 0, 'Live navigates first; selectedSport sync follows the new route');
  tree = h.render({}); find(tree, 'button', 'Switch sport, currently NFL').props.onClick(); tree = h.render({});
  const nba = nodes(tree).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes('NBA'));
  nba.props.onClick(); assert.deepEqual(browser.navigation.at(-1), { href: '/live-scores?sport=nba', method: 'push' });
  delete context.onSportChange; h.unmount();
});

test('live scoreboard/detail polling, visibility refresh and unmount cleanup are preserved', async () => {
  reset('/live-scores', 'sport=nba&date=2026-05-25');
  const intervals = new Map(), listeners = new Map(); let serial = 0, calls = 0;
  window.setInterval = (callback, delay) => { const id = ++serial; intervals.set(id, { callback, delay }); return id; };
  window.clearInterval = id => intervals.delete(id);
  document.addEventListener = (type, callback) => listeners.set(callback, type);
  document.removeEventListener = (type, callback) => listeners.delete(callback);
  global.fetch = async url => { if (url.endsWith('/favorites')) return Response.json({ teamIds: [] }); calls++; const body = detail(); body.header.competitions[0].status.type.state = 'in'; return { ok: true, json: async () => url.includes('/scores?') ? { games: [{ ...game, status: 'in' }] } : body }; };
  const h = host(Live); await settle(h, { viewerId: 'viewer' });
  assert.ok([...intervals.values()].some(i => i.delay === 30000));
  [...intervals.values()][0].callback(); await tick(); assert.equal(calls, 2);
  [...listeners.keys()][0](); await tick(); assert.equal(calls, 3); h.unmount();
  assert.equal(intervals.size, 0); assert.equal(listeners.size, 0);
  const ch = host(Center), props = { viewerId: 'viewer', eventId: '123', tab: 'stats', onBack() {} }; await settle(ch, props);
  assert.ok([...intervals.values()].some(i => i.delay === 15000));
  const before = calls; [...intervals.values()][0].callback(); await tick(); assert.equal(calls, before + 1);
  [...listeners.keys()][0](); await tick(); assert.equal(calls, before + 2); ch.unmount();
  assert.equal(intervals.size, 0); assert.equal(listeners.size, 0);
});

test('mobile inline page retains bottom navigation clearance without a vertical overflow ancestor', async () => {
  reset('/live-scores', 'sport=nba&date=2026-05-25&gameId=123');
  const h = host(Live); const tree = await settle(h, { viewerId: 'viewer' });
  assert.ok(tree.props.className.includes('pb-24')); assert.ok(tree.props.className.includes('nba-live-page'));
  const css = fs.readFileSync('app/globals.css', 'utf8');
  assert.match(css, /main\.nba-live-page\s*\{\s*overflow-x: clip;\s*overflow-y: visible;/);
  assert.ok(css.includes("html:has(main.nba-live-page)")); assert.ok(css.includes("body:has(main.nba-live-page)"));
  assert.match(css, /padding-bottom: 9rem !important/); h.unmount();
});

test.after(() => { Module._load = previousLoad; });
