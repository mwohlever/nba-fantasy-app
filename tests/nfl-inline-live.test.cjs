/* eslint-disable @typescript-eslint/no-require-imports */
/* Synthetic history/hook integration and provider fixtures; no authenticated browser or DB writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const { host, nodes, context, React } = require('./helpers/scores-harness.cjs');
const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');
const { renderToStaticMarkup: render } = require('react-dom/server');
const previousLoad = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request.includes('providers/GroupProvider')) return { useGroupContext: () => ({
    groupContext: { group: { id: context.group, slug: 'test', name: 'Test' }, membership: { role: 'member' },
      leagues: (context.enabled ?? ['nfl']).map(sportKey => ({ id: `${sportKey}-${context.group}`, sportKey, gameMode: 'standard', isEnabled: true })) },
    availableGroups: [], isLoading: context.loading, isSwitchingGroup: context.switching,
  }) };
  return previousLoad.call(this, request, parent, ...rest);
};
const Live = require('../components/live-scores/NflLiveScores.tsx').default;
const Center = require('../components/live-scores/NflGameCenter.tsx').default;
const Content = require('../components/live-scores/FootballGameCenter.tsx').default;
const Pbp = require('../components/live-scores/FootballPlayByPlay.tsx').default;
const Field = require('../components/live-scores/FootballPlayField.tsx').default;
const Nav = require('../components/AppNav.tsx').default().props.children.type;
const { useNflLiveUrl } = require('../lib/live-scores/useNflLiveUrl.ts');
const { parseNflLiveState, nflLiveHref, parseNflCalendar, validNflEventId } = require('../lib/live-scores/urlState.ts');
const { getGroupSwitchDestination } = require('../lib/groups/navigation.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(h, props = {}) { let tree; for (let i = 0; i < 5; i++) { tree = h.render(props, true); await tick(); } return tree; }
const find = (tree, type, label) => nodes(tree).find(n => n.type === type && (n.props.children === label || n.props['aria-label'] === label));
const calendar = { season: 2025, seasonType: 2, week: 2 };
const overview = 'sport=nfl&season=2025&seasonType=2&week=2';
const game = (id = '123') => ({ espnEventId: id, name: 'Away at Home', shortName: 'AWY @ HME', kickoffAt: '2025-09-12T00:15Z',
  awayTeam: { id: '1', abbreviation: 'AWY', displayName: 'Away', score: 7 }, homeTeam: { id: '2', abbreviation: 'HME', displayName: 'Home', score: 0 }, status: 'post' });
const detail = (id = '123', group = context.group) => ({ eventId: id, game: game(id), liveContext: calendar, seasonYear: 2025,
  header: { id, competitions: [{ date: game().kickoffAt, status: { type: { state: 'post' } }, competitors: [
    { id: '1', homeAway: 'away', team: { id: '1', abbreviation: 'AWY' }, score: '7' },
    { id: '2', homeAway: 'home', team: { id: '2', abbreviation: 'HME' }, score: '0' },
  ] }] }, drives: { previous: [1, 4, 5].map(period => ({ plays: [{ id: `play-${period}`, text: `Play in quarter ${period}`, period: { number: period },
    start: { team: { id: '1' }, down: 1, distance: 10, yardsToEndzone: 60 }, end: { team: { id: '1' }, down: 2, distance: 5, yardsToEndzone: 55 } }] })) },
  ownership: { groupId: group, leagueId: `nfl-${group}`, players: { '42': { name: `Owner ${group}`, isYou: true } } },
  boxscore: { players: ['1', '2'].map(id => ({ team: { id, abbreviation: id }, statistics: [{ name: 'passing', labels: ['YDS'], athletes: [
    { athlete: { id: '42', displayName: 'Owned player' }, stats: ['100'] }, { athlete: { id: '99', displayName: 'Unowned player' }, stats: ['50'] },
  ] }] })) },
});
function reset(search = overview) {
  context.group = 'a'; context.sport = 'nfl'; context.switching = false; context.loading = false; context.enabled = ['nfl'];
  const browser = installViewingBrowser('/live-scores', search);
  Object.assign(window, { setInterval, clearInterval, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const history = [{ href: `/live-scores${search ? `?${search}` : ''}`, state: null }]; let index = 0;
  window.history = {
    get state() { return history[index].state; },
    pushState(state, _title, href) { history.splice(index + 1); history.push({ href, state }); index++; browser.navigate(href, 'push'); },
    replaceState(state, _title, href) { history[index] = { href, state }; browser.navigate(href, 'replace'); },
    back() { if (index > 0) browser.navigate(history[--index].href, 'back'); },
    forward() { if (index + 1 < history.length) browser.navigate(history[++index].href, 'forward'); },
  };
  browser.history = history;
  browser.reload = () => browser.navigate(history[index].href, 'reload');
  return browser;
}
function fetchScores() {
  const calls = [];
  global.fetch = async url => { calls.push(url); return Response.json(url.includes('/favorites') ? { teamIds: ['1'] } : {
    ...calendar, games: [game()], calendar: [{ value: '2', label: 'Regular Season', entries: [{ value: '2', label: 'Week 2' }] }],
  }); };
  return calls;
}
const props = { viewerId: 'viewer' };
const centerProps = { ...props, eventId: '123', tab: 'stats', period: null, statsTeam: '1', onBack() {}, onCalendar() {}, onDetailChange() {} };

test('NFL URL calendar and detail round trips keep only the public NFL namespace', () => {
  assert.deepEqual(parseNflLiveState(overview), { sport: 'nfl', context: 'nfl', view: 'games', calendar });
  const state = parseNflLiveState(`${overview}&gameId=123&tab=pbp&period=5&statsTeam=2&slateId=9&date=2025-09-11&golferId=5&groupId=old`);
  const href = nflLiveHref(state);
  assert.equal(href, `/live-scores?${overview}&gameId=123&tab=pbp&period=5&statsTeam=2`);
  assert.deepEqual(parseNflLiveState(href.split('?')[1]), state);
  for (const query of ['', 'season=2026', 'season=1999&seasonType=2&week=1', 'season=2025&seasonType=4&week=1', 'season=2025&seasonType=2&week=19']) {
    assert.equal(parseNflLiveState(query).calendar, null);
    assert.equal(nflLiveHref(parseNflLiveState(query)), '/live-scores?sport=nfl');
  }
  for (const seasonType of [1, 2, 3]) assert.ok(parseNflCalendar(new URLSearchParams({ season: '2025', seasonType: String(seasonType), week: '1' })));
  const invalid = parseNflLiveState('gameId=&tab=no&period=-1&statsTeam=bad');
  assert.equal(invalid.view, 'detail'); assert.equal(invalid.gameId, ''); assert.equal(invalid.tab, 'summary');
  assert.equal(invalid.period, null); assert.equal(invalid.statsTeam, null);
  for (const id of ['', '-1', 'bad', '12/34']) assert.equal(validNflEventId(id), false);
});

test('NFL current/default overview canonicalizes by replace using the provider week; week controls push', async () => {
  const browser = reset('sport=nfl&date=2026-01-05&slateId=9'); const calls = fetchScores(); const h = host(Live);
  let tree = await settle(h, props);
  assert.equal(context.search, `?${overview}`); assert.equal(browser.history.length, 1);
  assert.ok(browser.navigation.every(n => n.method === 'replace'));
  assert.equal(new URL(calls.find(url => url.includes('/scores')), 'http://test').searchParams.has('season'), false);
  find(tree, 'select', 'Season').props.onChange({ target: { value: '2024' } }); tree = await settle(h, props);
  assert.match(context.search, /season=2024&seasonType=2&week=1/); assert.equal(browser.navigation.at(-1).method, 'push');
  browser.reload(); h.remount(props); tree = await settle(h, props);
  assert.equal(find(tree, 'select', 'Season').props.value, 2024); h.unmount();
});

test('opening NFL pushes inline detail, tabs/quarter/team replace, reload restores and Back/Forward return/reopen', async () => {
  const browser = reset(); fetchScores(); const h = host(Live); let tree = await settle(h, props);
  nodes(tree).find(n => n.type?.name === 'LiveScoreCard').props.onClick(); tree = await settle(h, props);
  let center = nodes(tree).find(n => n.type === Center);
  assert.equal(center.props.eventId, '123'); assert.equal(center.props.tab, 'summary'); assert.equal(browser.history.length, 2);
  assert.equal(browser.navigation.at(-1).method, 'push'); assert.ok(!nodes(tree).some(n => n.type?.name === 'LiveScoreCard'));
  center.props.onDetailChange({ tab: 'pbp', period: 5 }); tree = await settle(h, props);
  center = nodes(tree).find(n => n.type === Center); center.props.onDetailChange({ tab: 'stats', statsTeam: '2' });
  tree = await settle(h, props); assert.equal(browser.navigation.at(-1).method, 'replace'); assert.equal(browser.history.length, 2);
  browser.reload(); h.remount(props); tree = await settle(h, props); center = nodes(tree).find(n => n.type === Center);
  assert.equal(center.props.tab, 'stats'); assert.equal(center.props.period, 5); assert.equal(center.props.statsTeam, '2');
  center.props.onBack(); tree = await settle(h, props); assert.ok(nodes(tree).some(n => n.type?.name === 'LiveScoreCard'));
  assert.equal(browser.navigation.at(-1).method, 'back'); window.history.forward(); tree = await settle(h, props);
  assert.equal(nodes(tree).find(n => n.type === Center).props.tab, 'stats'); h.unmount();
});

test('direct event-only deep link loads that event, resolves its own season/week and has deterministic Back', async () => {
  const browser = reset('sport=nfl&gameId=123&tab=pbp&period=1'); global.fetch = async () => Response.json(detail());
  const h = host(Live); let tree = await settle(h, props); const ch = host(Center);
  let center = nodes(tree).find(n => n.type === Center); await settle(ch, center.props); tree = await settle(h, props);
  assert.match(context.search, /season=2025&seasonType=2&week=2&gameId=123&tab=pbp&period=1/);
  center = nodes(tree).find(n => n.type === Center); center.props.onBack();
  assert.equal(context.search, `?${overview}`); assert.equal(browser.navigation.at(-1).method, 'replace'); assert.equal(browser.history.length, 1);
  ch.unmount(); h.unmount();
});

test('invalid/unavailable/mismatched games never substitute another matchup', async () => {
  for (const id of ['', 'bad']) {
    reset(`sport=nfl&gameId=${id}`); let calls = 0; global.fetch = async () => { calls++; return Response.json(detail()); };
    const h = host(Center), tree = await settle(h, { ...centerProps, eventId: id });
    assert.match(render(tree), /game link is invalid/); assert.equal(calls, 0); h.unmount();
  }
  for (const response of [Response.json({ error: 'Game unavailable' }, { status: 404 }), Response.json(detail('999')), Response.json({ eventId: '123', game: null })]) {
    reset(); global.fetch = async () => response.clone(); const h = host(Center); const tree = await settle(h, centerProps);
    assert.match(render(tree), /unavailable/); assert.ok(find(tree, 'button', '← Back to games')); assert.ok(!nodes(tree).some(n => n.type === Content)); h.unmount();
  }
});

test('NFL ownership/highlighting and player actions survive inline presentation and clear immediately on Group switch', async () => {
  reset(); global.fetch = async () => Response.json(detail()); const h = host(Center); let tree = await settle(h, centerProps);
  let html = render(tree); assert.match(html, /Owner a · You/); assert.match(html, /bg-sky-50 dark:bg-sky-950/); assert.match(html, /role="button"/);
  assert.doesNotMatch(html, /data-game-center-scroll|fixed inset|overflow-y-auto/);
  context.switching = true; tree = h.render(centerProps, true); assert.doesNotMatch(render(tree), /Owner a|Owned player/);
  context.group = 'b'; context.switching = false; tree = h.render(centerProps, true); assert.doesNotMatch(render(tree), /Owner a/);
  tree = await settle(h, centerProps); assert.match(render(tree), /Owner b · You/); assert.doesNotMatch(render(tree), /Owner a/);
  context.enabled = []; tree = h.render(centerProps, true); assert.doesNotMatch(render(tree), /Owner b/); h.unmount();
});

test('NFL Group navigation preserves public detail and rejects disabled or explicit old Group/league context', () => {
  const input = { pathname: '/live-scores', search: `${overview}&gameId=123&tab=stats&period=1&statsTeam=2&slateId=9&teamId=old`, targetGroupSlug: 'b', enabledSports: ['nfl'], canAdministerGroup: false };
  assert.equal(getGroupSwitchDestination(input), `/live-scores?${overview}&gameId=123&tab=stats&period=1&statsTeam=2`);
  assert.equal(getGroupSwitchDestination({ ...input, enabledSports: ['nba'] }), '/groups/b');
  for (const field of ['groupId', 'leagueId']) assert.equal(getGroupSwitchDestination({ ...input, search: `${input.search}&${field}=old` }), '/groups/b');
});

test('Back after changing Group uses deterministic overview rather than the old scoped marker', () => {
  const browser = reset(); const h = host(() => useNflLiveUrl(context.group)); let state = h.render({}, true);
  state.openGame('123'); context.group = 'b'; state = h.render({}, true); state.backToGames();
  assert.equal(browser.navigation.at(-1).method, 'replace'); assert.equal(context.search, `?${overview}`); h.unmount();
});

test('simultaneous detail/default-context corrections merge without losing quarter or stats team', () => {
  reset('sport=nfl&gameId=123&tab=stats');
  const h = host(() => useNflLiveUrl('viewer:a:nfl-a'));
  const live = h.render({}, true);
  live.selectDetail({ statsTeam: '2', period: 1 });
  live.resolveCalendar(calendar);
  const restored = parseNflLiveState(context.search);
  assert.deepEqual(restored.calendar, calendar); assert.equal(restored.statsTeam, '2'); assert.equal(restored.period, 1);
  h.unmount();
});

test('repeated NFL default corrections and settled rerenders do not repeat history writes', async () => {
  const browser = reset('sport=nfl&gameId=123&tab=pbp');
  const h = host(() => useNflLiveUrl('viewer:a:nfl-a'));
  let live = h.render({}, true);
  live.selectDetail({ period: 1 }); live.selectDetail({ period: 1 });
  live.resolveCalendar(calendar); live.resolveCalendar(calendar);
  const count = browser.navigation.length;
  for (let i = 0; i < 20; i++) {
    live = h.render({}, true); live.selectDetail({ period: 1 }); live.resolveCalendar(calendar);
  }
  assert.equal(browser.navigation.length, count); h.unmount();
});

test('rapid events A → B → A reject old data/errors/completion even when requests ignore abort', async () => {
  reset(); const pending = []; global.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }));
  const h = host(Center); h.render(centerProps, true); h.render({ ...centerProps, eventId: '456' }, true); h.render(centerProps, true);
  assert.equal(pending.length, 3); assert.equal(pending[0].options.signal.aborted, true); assert.equal(pending[1].options.signal.aborted, true);
  pending[0].resolve(Response.json(detail())); pending[1].resolve(Response.json({ error: 'Old error' }, { status: 502 })); await tick();
  assert.match(render(h.render(centerProps)), /Loading game details/); assert.doesNotMatch(render(h.render(centerProps)), /Old error|Owner a/);
  pending[2].resolve(Response.json(detail())); await tick(); let tree = h.render(centerProps);
  assert.match(render(tree), /Owner a · You/);
  const content = nodes(tree).find(n => n.type === Content); content.props.request.refresh(); content.props.request.refresh();
  pending[4].resolve(Response.json({ ...detail(), ownership: { ...detail().ownership, players: { '42': { name: 'Newest', isYou: true } } } })); await tick();
  pending[3].resolve(Response.json({ error: 'Old refresh error' }, { status: 502 })); await tick(); tree = h.render(centerProps);
  assert.match(render(tree), /Newest · You/); assert.doesNotMatch(render(tree), /Old refresh error/); h.unmount();
});

test('Group A → B → A and viewer changes reject superseded NFL ownership requests', async () => {
  reset(); const pending = []; global.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }));
  const h = host(Center); h.render(centerProps, true); context.group = 'b'; h.render(centerProps, true); context.group = 'a'; h.render(centerProps, true);
  pending[2].resolve(Response.json(detail())); await tick(); assert.match(render(h.render(centerProps)), /Owner a/);
  pending[0].resolve(Response.json({ ...detail(), ownership: { ...detail().ownership, players: { '42': { name: 'Stale', isYou: true } } } }));
  pending[1].resolve(Response.json(detail('123', 'b'))); await tick(); assert.doesNotMatch(render(h.render(centerProps)), /Stale|Owner b/);
  const other = { ...centerProps, viewerId: 'other' }; assert.doesNotMatch(render(h.render(other, true)), /Owner a/);
  assert.match(pending[3].url, /viewerId=other/); h.unmount();
});

test('refresh preserves tab/team/quarter, updates data and retains last data on refresh failure', async () => {
  reset(); let fail = false; global.fetch = async () => fail ? Response.json({ error: 'Provider offline' }, { status: 502 }) : Response.json(detail());
  const h = host(Center), p = { ...centerProps, tab: 'pbp', period: 1, statsTeam: '2' }; let tree = await settle(h, p);
  const content = nodes(tree).find(n => n.type === Content); await content.props.request.refresh(); tree = await settle(h, p);
  assert.equal(nodes(tree).find(n => n.type === Content).props.tab, 'pbp'); assert.equal(nodes(tree).find(n => n.type === Content).props.period, 1);
  fail = true; await nodes(tree).find(n => n.type === Content).props.request.refresh(); tree = await settle(h, p);
  assert.match(render(tree), /Refresh failed/); assert.match(render(tree), /Play in quarter 1/); h.unmount();
});

test('NFL live detail keeps one 15-second poll through rerenders and cleans up on unmount', async () => {
  reset(); let tickPoll, setups = 0, clears = 0; const calls = [];
  window.setInterval = (fn, ms) => { assert.equal(ms, 15000); setups++; tickPoll = fn; return 7; }; window.clearInterval = id => { assert.equal(id, 7); clears++; };
  global.fetch = async (url, options) => { calls.push({ url, options }); const body = detail(); body.header.competitions[0].status.type.state = 'in'; return Response.json(body); };
  const h = host(Center); await settle(h, centerProps);
  for (let i = 0; i < 20; i++) await settle(h, centerProps);
  assert.equal(setups, 1); assert.equal(calls.length, 1);
  tickPoll(); await tick(); assert.equal(calls.length, 2);
  h.unmount(); assert.equal(clears, 1);
});

test('football inline field observes viewport; modal field retains its scroll root and quarter/OT controls', async () => {
  reset(); window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); const observers = [];
  global.IntersectionObserver = window.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
  try {
    for (const presentation of ['inline', 'modal']) {
      const h = host(Pbp), scrollRoot = {}, selections = [], p = { presentation, drives: detail().drives.previous, isLive: false, offenseNames: { '1': 'AWY', '2': 'HME' }, period: 1, onPeriodChange: n => selections.push(n) };
      let tree = h.render(p); nodes(tree).find(n => n.props?.ref).props.ref.current = { closest(selector) { assert.equal(selector, '[data-game-center-scroll]'); return scrollRoot; } };
      tree = await settle(h, p); const observer = observers.at(-1); assert.equal(observer.options.root, presentation === 'inline' ? null : scrollRoot);
      observer.callback([{ isIntersecting: false }]); tree = await settle(h, p);
      assert.equal(nodes(tree).filter(n => n.type === Field).length, 2); assert.ok(nodes(tree).some(n => n.props?.className?.includes('sticky top-0')));
      const compact = nodes(tree).find(n => n.type === Field && n.props.compact);
      assert.equal(compact.props.play.id, 'play-1');
      find(tree, 'button', 'OT1').props.onClick(); assert.equal(selections.at(-1), 5);
      tree = await settle(h, { ...p, period: 5 }); assert.match(render(tree), /Play in quarter 5/);
      const updated = nodes(tree).find(n => n.type === Field && n.props.compact);
      assert.equal(updated.props.play.id, 'play-5'); assert.equal(updated.props.replayEnabled, true);
      observer.callback([{ isIntersecting: true }]); tree = await settle(h, { ...p, period: 5 });
      assert.equal(nodes(tree).filter(n => n.type === Field).length, 1);
      assert.ok(!nodes(tree).some(n => n.props?.className?.includes('sticky top-0')));
      h.unmount(); assert.equal(observer.disconnected, true);
    }
  } finally { delete global.IntersectionObserver; delete window.IntersectionObserver; }
});

test('football observer attaches after delayed plays, stays stable through selections and cleans up each host', async () => {
  for (const presentation of ['inline', 'modal']) {
    reset(); window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    const observers = [], scrollRoot = {};
    global.IntersectionObserver = window.IntersectionObserver = class {
      constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    };
    const h = host(Pbp);
    const p = { presentation, drives: [], isLive: false, offenseNames: { '1': 'AWY', '2': 'HME' } };
    try {
      await settle(h, p); assert.equal(observers.length, 0);
      const loaded = { ...p, drives: detail().drives.previous };
      const tree = h.render(loaded); const target = { closest() { return scrollRoot; } };
      nodes(tree).find(n => n.props?.ref).props.ref.current = target;
      await settle(h, loaded);
      assert.equal(observers.length, 1);
      assert.equal(observers[0].target, target);
      assert.equal(observers[0].options.root, presentation === 'inline' ? null : scrollRoot);
      observers[0].callback([{ isIntersecting: false }]);
      for (let i = 0; i < 10; i++) await settle(h, loaded);
      assert.equal(observers.length, 1);
      await settle(h, p); assert.equal(observers[0].disconnected, true);
    } finally { h.unmount(); delete global.IntersectionObserver; delete window.IntersectionObserver; }
  }
});

test('NFL inline team and quarter defaults correct by callback, modal shell/NCAA keep modal presentation', async () => {
  reset(); const changes = []; const h = host(Content);
  const p = { game: game(), apiBase: '/api/live-scores/nfl', request: { data: detail(), loading: false, refreshing: false, error: '', refresh() {} }, presentation: 'inline',
    tab: 'stats', statsTeam: '999', onStatsTeamChange: id => changes.push(id), onClose() {} };
  await settle(h, p); assert.equal(changes.at(-1), '1'); const tree = h.render(p);
  find(tree, 'button', '2').props.onClick(); assert.equal(changes.at(-1), '2'); h.unmount();
  const Modal = require('../components/live-scores/GameCenterModal.tsx').default;
  const modal = Modal({ game: game(), apiBase: '/api/ncaa-pickem', onClose() {} });
  assert.match(modal.props.className, /fixed inset/); assert.equal(nodes(modal).find(n => n.type === Content).props.presentation, 'modal');
});

test('mobile/desktop NFL Live highlighting and sport switching clear event/weekly/slate context atomically', () => {
  for (const destination of ['NBA', 'NBA Skins', 'Golf']) {
    const browser = reset(`${overview}&gameId=123&tab=pbp&period=1&slateId=8`); context.enabled = ['nba', 'nba_skins', 'nfl', 'golf'];
    const h = host(Nav); let tree = h.render({});
    for (const activeClass of ['app-desktop-link-active', 'app-mobile-nav-active']) {
      assert.ok(nodes(tree).some(n => n.props?.className?.includes(activeClass) && n.props.href === '/live-scores?sport=nfl'));
    }
    find(tree, 'button', 'Switch sport, currently NFL').props.onClick(); tree = h.render({});
    const button = nodes(tree).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children.includes(destination));
    assert.ok(button); button.props.onClick(); const href = browser.navigation.at(-1).href;
    assert.ok(!/gameId|period|week|slateId|statsTeam|seasonType/.test(href));
    assert.equal(href, destination === 'NBA' ? '/live-scores?sport=nba' : destination === 'NBA Skins' ? '/nba-skins/live' : '/golf/live');
    h.unmount();
  }
  assert.match(fs.readFileSync('components/live-scores/NflLiveScores.tsx', 'utf8'), /pb-24/);
});

// Isolated server loader: every auth/provider/database dependency is supplied explicitly.
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
test('NFL page passes viewer/Group identity and authorizes only enabled NFL', async () => {
  let allowed = true;
  const mocks = { '@/components/AppNav': { __esModule: true, default: () => null }, '@/components/live-scores/NflLiveScores': { __esModule: true, default: Live }, '@/components/live-scores/NbaLiveScores': { __esModule: true, default: () => null },
    '@/lib/auth': { getCurrentUser: async () => ({ id: 'viewer' }) }, '@/lib/groups/context': {},
    '@/lib/live-scores/access': { getNflLiveAccess: async () => allowed ? { context: { group: { id: 'a' } } } : null } };
  const Page = load('app/live-scores/page.tsx', mocks).default; let tree = await Page({ searchParams: Promise.resolve({ sport: 'nfl' }) });
  assert.equal(tree.type, Live); assert.equal(tree.key, 'viewer:a'); assert.equal(tree.props.viewerId, 'viewer');
  allowed = false; tree = await Page({ searchParams: Promise.resolve({ sport: 'nfl' }) }); assert.match(render(tree), /NFL is not enabled/);
});

for (const endpoint of ['scores', 'game-detail']) test(`NFL ${endpoint} rejects changed request identities before provider/ownership access`, async () => {
  let calls = 0;
  const mocks = { '@/lib/auth': { getCurrentUser: async () => ({ id: 'viewer' }) }, '@/lib/live-scores/access': { getNflLiveAccess: async () => ({ context: { group: { id: 'a' } }, league: { id: 'nfl-a' } }) },
    '@/lib/live-scores/nflOwnership.server': { loadNflOwnership: async () => { calls++; return null; } }, '@/lib/supabaseAdmin': { supabaseAdmin: {} },
    '@/lib/providers/nflLiveScores': { fetchNflLiveScores: async () => { calls++; return {}; }, normalizeNflGame: () => game() },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } } };
  const route = load(`app/api/live-scores/nfl/${endpoint}/route.ts`, mocks);
  const oldFetch = global.fetch; global.fetch = async () => { calls++; return Response.json({}); };
  try {
    for (const extra of ['viewerId=other&leagueId=nfl-a&groupId=a', 'viewerId=viewer&leagueId=nfl-b&groupId=a', 'viewerId=viewer&leagueId=nfl-a&groupId=b']) {
      const url = new URL(`http://test/api?eventId=123&${extra}`); const response = await route.GET({ url: String(url), nextUrl: url }); assert.equal(response.status, 409);
    }
    assert.equal(calls, 0);
  } finally { global.fetch = oldFetch; }
});


test('mobile NFL replay has the same viewport scroll ancestors and navigation clearance as NBA', () => {
  const css = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8');
  for (const sport of ['nba', 'nfl']) {
    // Inspect the scoped selector block independently of the surrounding comments.
    const selectorStart = css.indexOf(`html:has(main.${sport}-live-page)`);
    const rule = css.slice(selectorStart, css.indexOf('}', selectorStart));
    for (const element of ['html:has', 'body:has']) assert.ok(rule.includes(`${element}(main.${sport}-live-page)`));
    assert.ok(rule.includes(`main.${sport}-live-page`));
    assert.match(rule, /overflow-x: clip/); assert.match(rule, /overflow-y: visible/);
  }
  assert.match(css, /main \{\s*padding-bottom: 9rem !important/);
  reset(); const h = host(Live); const tree = h.render(props);
  assert.match(tree.props.className, /nfl-live-page/); h.unmount();
});

test('NCAA Pick’em finishes its week loader, settles calendar defaults and only mounts a modal on selection', async () => {
  reset(); context.pathname = '/ncaa-pickem'; context.sport = 'ncaa';
  const Page = require('../app/ncaa-pickem/page.tsx').default;
  const week = { id: 3, season: 2026, week_number: 3, label: 'Week 3', status: 'locked', lock_at: null };
  const body = { success: true, week, weeks: [week], games: [{ id: 7, espn_event_id: '401858432', kickoff_at: '2026-09-19T17:00Z',
    away_team_id: '1', away_team_name: 'Away college', away_team_abbreviation: 'AWY', home_team_id: '2', home_team_name: 'Home college', home_team_abbreviation: 'HME', status: 'post', away_score: 7, home_score: 3 }],
    viewer: { teamId: 1 }, participants: [], picks: [], groupPicks: [], locked: true };
  const calls = []; global.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(url.includes('refresh-stats') ? { success: true } : body); };
  const h = host(Page); let tree = await settle(h); const html = render(tree);
  assert.doesNotMatch(html, /Loading NCAA Pick/); assert.match(html, /Away college|AWY/); assert.match(html, /Week 3/);
  assert.equal(calls.filter(c => c.url.includes('refresh-stats')).length, 1);
  assert.ok(calls.some(c => c.url === '/api/ncaa-pickem/week?season=2026&week=3'));
  const count = calls.length; await settle(h); assert.equal(calls.length, count);
  const NcaaModal = require('../components/ncaa/NcaaGameCenterModal.tsx').default;
  assert.ok(!nodes(tree).some(n => n.type === NcaaModal));
  const open = nodes(tree).find(n => n.props?.['aria-label'] === 'Open Away college at Home college Game Center');
  assert.ok(open); open.props.onClick(); tree = await settle(h);
  assert.equal(nodes(tree).find(n => n.type === NcaaModal).props.game.espnEventId, '401858432'); h.unmount();
});

for (const apiBase of ['/api/ncaa-pickem', '/api/live-scores/nfl', '/api/bracket-challenge/contests/test']) {
  test(`remaining football modal loader settles and renders every tab: ${apiBase}`, async () => {
    reset(); const calls = []; global.fetch = async url => { calls.push(url); return Response.json(detail()); };
    const h = host(Content), p = { game: game(), apiBase, onClose() {} }; let tree = await settle(h, p);
    assert.equal(calls.length, 1); assert.match(calls[0], /game-detail\?eventId=123/);
    assert.doesNotMatch(render(tree), /Loading game details/);
    assert.ok(nodes(tree).some(n => n.props?.['data-game-center-scroll']));
    for (const label of ['Play-by-Play', 'Player Stats', 'Summary']) {
      find(tree, 'button', label).props.onClick(); tree = await settle(h, p);
      assert.doesNotMatch(render(tree), /Loading game details/);
    }
    assert.equal(calls.length, 1); h.unmount();
  });
}
