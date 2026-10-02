/* eslint-disable @typescript-eslint/no-require-imports */
/* Captured ESPN fixtures, real normalizers/components/hooks, no database writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const test = require('node:test');
const { host, nodes, context, React } = require('./helpers/scores-harness.cjs');
const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');
const { renderToStaticMarkup: render } = require('react-dom/server');
const { normalizeNbaStandings, normalizeNflStandings, fetchProStandings, NBA_STANDINGS_URL, NFL_STANDINGS_URL } = require('../lib/providers/proStandings.ts');
const { normalizeNcaaStandings, fetchNcaaStandings, allConferenceTeams, NCAA_STANDINGS_URL, NCAA_RANKINGS_URL } = require('../lib/providers/ncaaStandings.ts');
const { parseNbaLiveState, nbaLiveHref, parseNflLiveState, nflLiveHref } = require('../lib/live-scores/urlState.ts');
const { parseNcaaLiveOverview, ncaaLiveOverviewHref } = require('../lib/live-scores/ncaaUrlState.ts');
const { useNbaLiveUrl } = require('../lib/live-scores/useNbaLiveUrl.ts');
const { useNflLiveUrl } = require('../lib/live-scores/useNflLiveUrl.ts');
const { useNcaaLiveUrl } = require('../lib/live-scores/useNcaaLiveUrl.ts');
const { getGroupSwitchDestination } = require('../lib/groups/navigation.ts');
const Views = require('../components/live-scores/StandingsViews.tsx');
const Panel = require('../components/live-scores/StandingsPanel.tsx').default;
const Selector = require('../components/live-scores/LiveViewSelector.tsx').default;
const NcaaScores = require('../app/ncaa-pickem/scores/page.tsx').default().props.children.type;
const NbaLive = require('../components/live-scores/NbaLiveScores.tsx').default;
const NflLive = require('../components/live-scores/NflLiveScores.tsx').default;
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/standings', `${name}.json`), 'utf8'));
const nba = () => normalizeNbaStandings(fixture('nba-current'));
const nfl = () => normalizeNflStandings(fixture('nfl-current'));
const ncaa = () => normalizeNcaaStandings(fixture('ncaa-conferences'), fixture('ncaa-ap'));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(h, props = {}, count = 6) { let tree; for (let i = 0; i < count; i++) { tree = h.render(props, true); await tick(); } return tree; }
function browser(pathname, search) {
  context.enabled = ['nba', 'nba_skins', 'nfl', 'ncaa_pickem']; context.group = 'a'; context.switching = false; context.loading = false;
  const b = installViewingBrowser(pathname, search);
  const entries = [{ href: `${pathname}?${search}`, state: null }]; let index = 0;
  window.scrollTo = () => {};
  window.setInterval = setInterval; window.clearInterval = clearInterval;
  window.history = {
    get state() { return entries[index].state; },
    pushState(state, title, href) { entries.splice(index + 1); entries.push({ href, state }); index++; b.navigate(href, 'push'); },
    replaceState(state, title, href) { entries[index] = { href, state }; b.navigate(href, 'replace'); },
    back() { if (index > 0) b.navigate(entries[--index].href, 'back'); },
    forward() { if (index < entries.length - 1) b.navigate(entries[++index].href, 'forward'); },
  };
  const listeners = new Map();
  global.document = { visibilityState: 'visible', addEventListener(k, fn) { listeners.set(k, fn); }, removeEventListener(k, fn) { if (listeners.get(k) === fn) listeners.delete(k); } };
  return { ...b, entries, listeners, reload() { b.navigate(entries[index].href, 'reload'); } };
}

test('NBA identifies current 2026-27 preseason, both conferences, and ignores projected BPI seeds', () => {
  const data = nba(); assert.equal(data.season, 2027); assert.equal(data.seasonLabel, '2026-27'); assert.equal(data.hasResults, false);
  assert.deepEqual(data.conferences.map(c => c.teams.length), [15, 15]); assert.equal(data.playoffs.available, false);
  assert.ok(data.conferences.every(c => c.teams.every(t => t.rank === null && t.conferenceRank === null && t.record === '0-0')));
  const historical = normalizeNbaStandings(fixture('nba-history')); assert.equal(historical.hasResults, true);
  assert.equal(historical.playoffs.available, false); assert.ok(historical.conferences[0].teams[0].logo);
  const raw = fixture('nba-current'); raw.children[0].standings.season = 2026;
  assert.throws(() => normalizeNbaStandings(raw), /regular season/);
  const duplicate = fixture('nba-current'); duplicate.children[0].standings.entries[1].team = duplicate.children[0].standings.entries[0].team;
  assert.throws(() => normalizeNbaStandings(duplicate), /duplicate/);
});

test('NFL uses complete ESPN conference/division ranks with provider tiebreak order and overall stat types', () => {
  const data = nfl(); assert.equal(data.playoffs.available, true); assert.equal(data.season, 2026);
  for (const conference of data.conferences) {
    assert.deepEqual(conference.teams.map(t => t.conferenceRank), Array.from({ length: 16 }, (_, i) => i + 1));
    assert.ok(conference.teams.slice(0, 4).every(t => t.divisionRank === 1));
    assert.equal(conference.groups.length, 4);
    for (const division of conference.groups) assert.deepEqual(division.teams.map(t => t.divisionRank), [1, 2, 3, 4]);
  }
  const raw = fixture('nfl-current'), entry = raw.children[0].children[0].standings.entries[0];
  entry.stats.find(s => s.type === 'wins').value = 999;
  const normalized = normalizeNflStandings(raw).conferences[0].teams.find(t => t.id === entry.team.id);
  assert.equal(normalized.wins, 3); assert.equal(normalized.percentage, '1.000'); assert.equal(normalized.record, '3-0');
  entry.stats = entry.stats.filter(s => s.type !== 'conferencerank');
  assert.equal(normalizeNflStandings(raw).playoffs.available, false);
  const clinchers = normalizeNflStandings(fixture('nfl-clinchers')).conferences.flatMap(c => c.teams).filter(t => t.clincher);
  assert.ok(clinchers.some(t => t.clincher.description === 'Clinched Division and Bye'));
  assert.ok(clinchers.some(t => t.clincher.description === 'Eliminated from Playoff Contention'));
});

test('NCAA AP is distinct from Coaches, current season, conference metadata, records and returned ordering', () => {
  const data = ncaa(); assert.equal(data.season, 2026); assert.equal(data.ap.source, 'ap'); assert.equal(data.ap.teams.length, 25);
  assert.equal(data.ap.teams[0].rank, 1); assert.ok(data.ap.teams.every(t => t.logo && t.record && t.conference));
  for (const id of ['1', '4', '5', '8', '9', '18', '37']) assert.ok(data.conferences.some(c => c.id === id));
  const sunBelt = data.conferences.find(c => c.id === '37'); assert.equal(sunBelt.groups.length, 2);
  const raw = fixture('ncaa-conferences');
  for (const conference of data.conferences) {
    const original = raw.children.find(c => c.id === conference.id);
    if (conference.teams.length) assert.deepEqual(conference.teams.map(t => t.id), original.standings.entries.map(t => t.team.id));
  }
  const teams = allConferenceTeams(data.conferences); assert.ok(teams.length > 130); assert.ok(teams.every(t => t.record && t.conferenceRecord));
  const polls = fixture('ncaa-ap'); polls.rankings = polls.rankings.filter(p => p.type !== 'ap');
  assert.equal(normalizeNcaaStandings(raw, polls).ap, null);
  const stale = fixture('ncaa-ap'); stale.rankings.forEach(p => { p.season.year = 2025; });
  assert.equal(normalizeNcaaStandings(raw, stale).ap, null);
});

test('NCAA CFP unavailable is separate from AP; explicit CFP ranking and official seed polls normalize independently', () => {
  const current = ncaa(); assert.equal(current.cfp.rankings, null); assert.equal(current.cfp.field, null); assert.match(current.cfp.message, /not been released/);
  const polls = fixture('ncaa-cfp'); polls.latestSeason.year = 2025;
  const historical = normalizeNcaaStandings(null, polls);
  assert.equal(historical.cfp.rankings.source, 'cfp'); assert.equal(historical.cfp.rankings.teams.length, 25);
  assert.equal(historical.cfp.field.source, 'cfp-seeds'); assert.deepEqual(historical.cfp.field.teams.map(t => t.rank), Array.from({ length: 12 }, (_, i) => i + 1));
  const invalid = structuredClone(polls); invalid.rankings.find(p => p.id === '22').ranks.pop();
  const partial = normalizeNcaaStandings(null, invalid); assert.equal(partial.cfp.field, null); assert.ok(partial.ap && partial.cfp.rankings);
  assert.match(partial.cfp.message, /temporarily unavailable/);
  const pretend = structuredClone(polls); pretend.rankings.find(p => p.id === '22').name = 'Projected playoff field';
  assert.equal(normalizeNcaaStandings(null, pretend).cfp.field, null);
  const tied = fixture('ncaa-ap'); tied.rankings.find(p => p.type === 'ap').ranks[1].current = 1;
  assert.deepEqual(normalizeNcaaStandings(fixture('ncaa-conferences'), tied).ap.teams.slice(0, 2).map(t => t.rank), [1, 1]);
  const malformed = fixture('ncaa-conferences'); malformed.children[0].standings.seasonType = 1;
  const apOnly = normalizeNcaaStandings(malformed, fixture('ncaa-ap')); assert.ok(apOnly.ap); assert.equal(apOnly.conferences.length, 0);
});

test('provider fetches cache five minutes, use current season only, and follow advertised CFP week once', async () => {
  const original = global.fetch; const calls = [];
  try {
    global.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(url === NBA_STANDINGS_URL ? fixture('nba-current') : fixture('nfl-current')); };
    await fetchProStandings('nba'); await fetchProStandings('nfl');
    assert.ok(calls.every(c => c.options.next.revalidate === 300 && !new URL(c.url).searchParams.has('season')));
    assert.ok(calls.every(c => c.options.signal instanceof AbortSignal)); calls.length = 0;
    const finalPolls = fixture('ncaa-cfp'); finalPolls.latestSeason.year = 2025;
    const defaults = structuredClone(finalPolls); defaults.rankings = defaults.rankings.filter(p => !['21', '22'].includes(p.id));
    global.fetch = async url => { calls.push({ url }); if (url === NCAA_STANDINGS_URL) throw new Error('standings outage'); return Response.json(url === NCAA_RANKINGS_URL ? defaults : finalPolls); };
    const data = await fetchNcaaStandings(); assert.ok(data.ap && data.cfp.field && data.cfp.rankings);
    assert.deepEqual(calls.map(c => c.url), [NCAA_STANDINGS_URL, NCAA_RANKINGS_URL, `${NCAA_RANKINGS_URL}?seasons=2025&seasontypes=2&weeks=16`]);
    calls.length = 0;
    global.fetch = async url => { calls.push({ url }); if (url === NCAA_RANKINGS_URL) throw new Error('rankings outage'); return Response.json(fixture('ncaa-conferences')); };
    const standingsOnly = await fetchNcaaStandings(); assert.ok(standingsOnly.conferences.length); assert.equal(standingsOnly.ap, null);
    assert.match(standingsOnly.cfp.message, /temporarily/);
    global.fetch = async () => new Response('', { status: 503 }); await assert.rejects(fetchProStandings('nba'), /503/);
    await assert.rejects(fetchNcaaStandings(), /unavailable/);
  } finally { global.fetch = original; }
});

test('public standings presentation is compact, labeled and has no ownership or game-level controls', () => {
  const data = normalizeNbaStandings(fixture('nba-history'));
  for (const selection of ['east', 'west']) {
    const html = render(React.createElement(Views.NbaStandingsView, { data, selection, onChange() {} }));
    assert.match(html, new RegExp(selection === 'east' ? 'Eastern Conference' : 'Western Conference'));
    assert.match(html, /W-L/); assert.match(html, /PCT/); assert.match(html, /GB/);
    assert.equal((html.match(/scope="row"/g) ?? []).length, 15); assert.doesNotMatch(html, /Owner|Your Team|Play-by-Play|Player Stats/);
  }
  assert.match(render(React.createElement(Views.NbaStandingsView, { data: nba(), selection: 'east', onChange() {} })), /Regular season has not started/);
  assert.doesNotMatch(render(React.createElement(Views.NbaStandingsView, { data, selection: 'playoffs', onChange() {} })), /scope="row"/);
  for (const selection of ['afc', 'nfc', 'playoffs']) {
    const html = render(React.createElement(Views.NflStandingsView, { data: nfl(), selection, onChange() {} }));
    assert.match(html, /W-L-T/); assert.equal((html.match(/scope="row"/g) ?? []).length, selection === 'playoffs' ? 32 : 16);
    if (selection === 'playoffs') { assert.match(html, /Division Leaders/); assert.match(html, /Wild Card/); assert.match(html, /Outside the Field/); }
    else for (const division of ['East', 'North', 'South', 'West']) assert.match(html, new RegExp(`${selection.toUpperCase()} ${division}`));
  }
  for (const selection of ['top25', 'cfp', 'conference:5', 'conference:8', 'conference:9', 'conference:37']) {
    const html = render(React.createElement(Views.NcaaStandingsView, { data: ncaa(), selection, onChange() {} }));
    assert.match(html, /aria-label="NCAA standings view"/); assert.match(html, /Pac-12/);
    if (selection === 'top25') assert.match(html, /AP Top 25/);
    if (selection.startsWith('conference:')) { assert.match(html, /Overall/); assert.match(html, /Conf/); }
    if (selection === 'cfp') assert.match(html, /not been released/);
  }
});

test('standings URL normalization whitelists public calendar context and strips all game detail identifiers', () => {
  const extras = '&gameId=123&tab=stats&period=5&statsTeam=1&groupId=old&slateId=3&golferId=4&conference=5';
  for (const context of ['nba', 'nba-skins']) {
    const state = parseNbaLiveState(context, `date=2026-05-25&view=standings&standingsView=west${extras}`);
    assert.equal(state.view, 'standings'); assert.equal(state.date, '2026-05-25');
    const href = nbaLiveHref(state); assert.doesNotMatch(href, /gameId|tab=|period|statsTeam|groupId|conference|slateId/);
    assert.deepEqual(parseNbaLiveState(context, href.split('?')[1]), state);
    assert.doesNotMatch(nbaLiveHref(parseNbaLiveState(context, 'gameId=123&standingsView=west&conference=5')), /standingsView|conference/);
  }
  const football = parseNflLiveState(`season=2025&seasonType=2&week=4&view=standings&standingsView=playoffs${extras}`);
  assert.equal(football.standingsView, 'playoffs'); assert.doesNotMatch(nflLiveHref(football), /gameId|tab=|period|statsTeam|groupId|conference/);
  for (const query of ['standingsView=top25', 'standingsView=cfp', 'conference=5']) {
    const state = parseNcaaLiveOverview(`view=standings&season=2025&week=10&${query}&gameId=123&tab=pbp`);
    assert.deepEqual(parseNcaaLiveOverview(ncaaLiveOverviewHref(state).split('?')[1]), state);
    assert.doesNotMatch(ncaaLiveOverviewHref(state), /gameId|tab=/);
  }
  assert.equal(parseNbaLiveState('nba', 'view=standings&standingsView=afc').standingsView, 'east');
  assert.equal(parseNflLiveState('view=standings&standingsView=east').standingsView, 'afc');
  assert.equal(parseNcaaLiveOverview('view=standings&conference=invalid').selection, 'top25');
});

test('Games/Standings push, standings selectors replace, reload and browser Back/Forward preserve calendar and selection', () => {
  for (const sport of ['nba', 'nba-skins', 'nfl', 'ncaa']) {
    const path = sport === 'nba-skins' ? '/nba-skins/live' : sport === 'ncaa' ? '/ncaa-pickem/scores' : '/live-scores';
    const search = sport.startsWith('nba') ? 'sport=nba&date=2026-05-25' : sport === 'nfl' ? 'sport=nfl&season=2025&seasonType=2&week=4' : 'season=2025&week=10';
    const b = browser(path, search);
    const h = host(() => sport.startsWith('nba') ? useNbaLiveUrl(sport === 'nba-skins' ? sport : 'nba', 'viewer:a') : sport === 'nfl' ? useNflLiveUrl('viewer:a') : useNcaaLiveUrl());
    let live = h.render({}, true); live.selectView('standings', { season: 2025, week: 10 }); live = h.render({}, true);
    assert.equal(b.navigation.at(-1).method, 'push'); assert.equal(live.state.view, 'standings');
    live.selectStandings(sport.startsWith('nba') ? 'west' : sport === 'nfl' ? 'nfc' : 'conference:5'); live = h.render({}, true);
    assert.equal(b.navigation.at(-1).method, 'replace'); assert.equal(b.entries.length, 2);
    b.reload(); h.remount({}); live = h.render({}, true);
    assert.equal(sport === 'ncaa' ? live.state.selection : live.state.standingsView, sport.startsWith('nba') ? 'west' : sport === 'nfl' ? 'nfc' : 'conference:5');
    window.history.back(); live = h.render({}, true); assert.equal(live.state.view, 'games');
    window.history.forward(); live = h.render({}, true); assert.equal(live.state.view, 'standings');
    live.selectView('games', live.state.calendar); live = h.render({}, true); assert.equal(live.state.view, 'games'); assert.doesNotMatch(context.search, /view=standings|standingsView|conference/);
    if (sport.startsWith('nba')) assert.equal(live.state.date, '2026-05-25'); else assert.equal(live.state.calendar.season, 2025);
    h.unmount();
  }
});

test('Group navigation preserves standings only for enabled destinations; ownership/group/fantasy params cannot leak', () => {
  for (const [pathname, search, sport] of [
    ['/live-scores', 'sport=nba&date=2026-05-25&view=standings&standingsView=west', 'nba'],
    ['/nba-skins/live', 'date=2026-05-25&view=standings&standingsView=west', 'nba-skins'],
    ['/live-scores', 'sport=nfl&view=standings&standingsView=playoffs', 'nfl'],
    ['/ncaa-pickem/scores', 'view=standings&conference=5', 'ncaa'],
  ]) {
    const input = { pathname, search: `${search}&slateId=99&teamId=old&gameId=123&tab=pbp`, targetGroupSlug: 'b', enabledSports: [sport], canAdministerGroup: false };
    const result = getGroupSwitchDestination(input); assert.match(result, /view=standings/); assert.doesNotMatch(result, /slateId|teamId|gameId|tab=/);
    assert.equal(getGroupSwitchDestination({ ...input, enabledSports: [] }), '/groups/b');
    assert.equal(getGroupSwitchDestination({ ...input, search: `${search}&groupId=old` }), '/groups/b');
  }
});

test('standings requests ignore calendar and selection changes, do not poll, throttle foreground refresh and retain data on errors', async () => {
  const b = browser('/live-scores', 'sport=nfl&view=standings'); const calls = [];
  const scope = { viewerId: 'viewer', groupId: 'a', leagueId: 'nfl-a', context: 'nfl', sport: 'nfl' };
  global.fetch = async url => { calls.push(url); return Response.json(nfl()); };
  const h = host(Panel), props = { scope, sport: 'nfl', selection: 'afc', onChange() {} };
  await settle(h, props, 30); assert.equal(calls.length, 1); assert.doesNotMatch(calls[0], /season|week|ownership/);
  await settle(h, { ...props, selection: 'nfc' }, 20); assert.equal(calls.length, 1);
  b.listeners.get('visibilitychange')(); await settle(h, props); assert.equal(calls.length, 1);
  const originalNow = Date.now; const later = Date.now() + 300001;
  try { Date.now = () => later; b.listeners.get('visibilitychange')(); await settle(h, props); assert.equal(calls.length, 2); }
  finally { Date.now = originalNow; }
  global.fetch = async url => { calls.push(url); return Response.json({ error: 'Provider unavailable' }, { status: 502 }); };
  let tree = h.render(props, true); nodes(tree).find(n => n.props['aria-label'] === 'Refresh standings').props.onClick(); tree = await settle(h, props);
  assert.match(render(tree), /Showing the last loaded standings/); assert.ok(nodes(tree).some(n => n.type === Views.NflStandingsView));
  tree = h.render({ ...props, scope: { ...scope, groupId: 'b', leagueId: 'nfl-b' } }, true);
  assert.ok(!nodes(tree).some(n => n.type === Views.NflStandingsView)); h.unmount();
});

test('NBA Fantasy/Skins use the same standings panel; standings entry does not fetch Games or Game Center ownership', async () => {
  for (const [contextValue, pathname] of [['nba', '/live-scores'], ['nba-skins', '/nba-skins/live']]) {
    browser(pathname, 'sport=nba&date=2026-05-25&view=standings&standingsView=west&season=2025');
    const calls = []; global.fetch = async url => { calls.push(url); return Response.json(nba()); };
    const h = host(NbaLive); const tree = await settle(h, { context: contextValue, viewerId: 'viewer' });
    const panel = nodes(tree).find(n => n.type === Panel); assert.equal(panel.props.sport, 'nba'); assert.equal(panel.props.selection, 'west');
    assert.equal(panel.props.scope.context, contextValue); assert.equal(calls.length, 0);
    assert.doesNotMatch(context.search, /season=/); assert.equal(panel.props.ownership, undefined);
    const ph = host(Panel); await settle(ph, panel.props); assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0], 'http://test').searchParams.get('context'), contextValue === 'nba-skins' ? 'nba-skins' : null);
    ph.unmount(); h.unmount();
  }
  browser('/live-scores', 'sport=nfl&view=standings'); const calls = [];
  global.fetch = async url => { calls.push(url); return Response.json({ teamIds: [] }); };
  const h = host(NflLive); await settle(h, { viewerId: 'viewer' });
  assert.ok(calls.every(url => url.includes('/favorites'))); h.unmount();
});

test('NCAA standings deep links do not fetch Scores/favorites or mount its modal; Games restores the remembered week', async () => {
  const b = browser('/ncaa-pickem/scores', 'season=2025&week=10&view=standings&conference=5'); const calls = [];
  global.fetch = async url => { calls.push(url); return Response.json({ season: 2025, week: 10, games: [], teamIds: [] }); };
  const h = host(NcaaScores); let tree = await settle(h);
  assert.equal(calls.length, 0); assert.equal(nodes(tree).find(n => n.type === Panel).props.selection, 'conference:5');
  nodes(tree).find(n => n.type === Selector).props.onChange('games'); tree = await settle(h);
  assert.equal(b.navigation.at(-1).method, 'push'); assert.ok(calls.includes('/api/ncaa-pickem/scores?season=2025&week=10'));
  assert.ok(!nodes(tree).some(n => n.type === Panel));
  window.history.back(); tree = await settle(h); assert.ok(nodes(tree).some(n => n.type === Panel)); h.unmount();
});

test('NCAA Games week controls update history and survive reload without repeated requests', async () => {
  const b = browser('/ncaa-pickem/scores', 'season=2026&week=5'); const calls = [];
  global.fetch = async url => { calls.push(url); return Response.json({ season: 2026, week: 5, games: [], teamIds: [] }); };
  const h = host(NcaaScores); let tree = await settle(h);
  const week = nodes(tree).find(n => n.type === 'select' && typeof n.props.value === 'number');
  week.props.onChange({ target: { value: '7' }, currentTarget: { blur() {} } }); tree = await settle(h, {}, 20);
  assert.match(context.search, /season=2026&week=7/); assert.equal(b.navigation.at(-1).method, 'push');
  assert.equal(calls.filter(u => u.includes('/scores')).length, 2);
  b.reload(); h.remount({}); tree = await settle(h); assert.equal(nodes(tree).find(n => n.type === 'select' && typeof n.props.value === 'number').props.value, 7);
  window.history.back(); tree = await settle(h); assert.equal(nodes(tree).find(n => n.type === 'select' && typeof n.props.value === 'number').props.value, 5);
  h.unmount();
  browser('/ncaa-pickem/scores', 'view=standings'); calls.length = 0;
  const direct = host(NcaaScores); tree = await settle(direct);
  nodes(tree).find(n => n.type === Selector).props.onChange('games'); await settle(direct);
  assert.equal(calls.filter(u => u === '/api/ncaa-pickem/scores').length, 1); direct.unmount();
});

test('NCAA standings with a resolved disabled Group show a terminal access state and never request provider data', async () => {
  browser('/ncaa-pickem/scores', 'view=standings'); context.enabled = [];
  let calls = 0; global.fetch = async () => { calls++; return Response.json({}); };
  const h = host(NcaaScores); const tree = await settle(h), panel = nodes(tree).find(n => n.type === Panel);
  assert.equal(panel.props.scope, null); assert.equal(panel.props.waitingForScope, false);
  const ph = host(Panel); assert.match(render(await settle(ph, panel.props)), /Select a Group/);
  assert.equal(calls, 0); ph.unmount(); h.unmount();
});

function handlerFixture(sport, enabled = true, user = { id: 'viewer' }) {
  const calls = []; const mocks = {
    '@/lib/auth': { getCurrentUser: async () => user },
    '@/lib/groups/context': { getActiveLeagueForSport: async (u, key) => { calls.push(key); return enabled ? { context: { group: { id: 'a' } }, league: { id: 'league' } } : null; } },
    '@/lib/providers/proStandings': { fetchProStandings: async key => { calls.push(`provider:${key}`); return key === 'nba' ? nba() : nfl(); } },
    '@/lib/providers/ncaaStandings': { fetchNcaaStandings: async () => { calls.push('provider:ncaa'); return ncaa(); } },
    './nbaContext': require('../lib/live-scores/nbaContext.ts'),
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers }) } },
  };
  const source = ts.transpileModule(fs.readFileSync('lib/live-scores/standingsRoute.server.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; new Function('require', 'exports', source)(name => { assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`); return mocks[name]; }, exports);
  return { calls, handler: exports.createStandingsHandler(sport) };
}

test('standings routes authorize the active sport, support Skins-only Groups, reject scope mismatches before provider fetch and cache no user responses', async () => {
  for (const [sport, query, accessKey] of [['nba', '', 'nba'], ['nba', 'context=nba-skins', 'nba_skins'], ['nfl', '', 'nfl'], ['ncaa', '', 'ncaa_pickem']]) {
    const request = query => ({ nextUrl: new URL(`http://test/api?${query}`) });
    const f = handlerFixture(sport); const result = await f.handler(request(query));
    assert.equal(result.status, 200); assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(f.calls, [accessKey, `provider:${sport}`]); assert.doesNotMatch(JSON.stringify(result.body), /ownership|fantasyTeam|slateId/);
    for (const key of ['viewerId', 'groupId', 'leagueId']) {
      const wrong = handlerFixture(sport); assert.equal((await wrong.handler(request(`${query}&${key}=wrong`))).status, 409);
      assert.equal(wrong.calls.length, 1);
    }
    const anon = handlerFixture(sport, false, null); assert.equal((await anon.handler(request(query))).status, 401); assert.equal(anon.calls.length, 0);
    const denied = handlerFixture(sport, false); assert.equal((await denied.handler(request(query))).status, 403); assert.equal(denied.calls.length, 1);
  }
});
