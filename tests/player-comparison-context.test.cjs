/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic observed games, fixture HTTP and local callbacks only. No production reads/writes.
const assert = require('node:assert/strict'), test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const Pool = require('../components/lineups/PlayerPool.tsx').default;
const Center = require('../components/player-center/DraftPlayerCenter.tsx').default;
const Browser = require('../components/player-center/ResearchBrowser.tsx').default;
const Rows = require('../components/player-center/ObservedComparisonRows.tsx').default;
const { comparisonHeading } = require('../components/player-center/ObservedComparisonRows.tsx');
const { WindowControl } = require('../components/player-center/PlayerCenter.tsx');
const { compareHistories } = require('../lib/player-center/comparison.ts');
const capture = require('../data/player-center-preview/captured.json');
const asOf = '2026-11-03T18:00:00Z', tick = () => new Promise(resolve => setImmediate(resolve));
const find = (t, type) => nodes(t).find(n => n.type === type);
const text = t => Array.isArray(t) ? t.map(text).join(' ') : t && typeof t === 'object' ? text(t.props?.children) : typeof t === 'string' || typeof t === 'number' ? String(t) : '';
const button = (t, label) => nodes(t).find(n => n.type === 'button' && text(n).replace(/\s+/g, ' ').trim() === label);
const previous = { fetch: global.fetch, flag: process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED, node: process.env.NODE_ENV };
test.after(() => { global.fetch = previous.fetch; for (const [k, v] of [['NODE_ENV', previous.node], ['NEXT_PUBLIC_PLAYER_CENTER_ENABLED', previous.flag]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

function fixture(sport = 'nba', options = {}) {
  const players = ['Luka Doncic', 'Nikola Jokic', 'Third player'].map((name, i) => ({ id: 901 + i, name: sport === 'nba' ? name : ['QB fixture', 'WR fixture', 'RB fixture'][i], position_group: sport === 'nba' ? 'F/C' : ['QB', 'WR', 'RB'][i] }));
  const current = sport === 'nba' ? 2027 : 2026, scoring = { sport, basis: 'slate_snapshot', settings: { sport, scoring: options.scoring ?? {} } };
  const histories = [];
  for (const year of [current, current - 1]) for (const [i, player] of players.entries()) {
    const h = structuredClone(capture.histories.find(h => h.player.sport === sport && h.player.position === (sport === 'nba' ? 'F/C' : 'QB')));
    const original = h.games.find(g => g.status === 'final' && g.participation === 'played');
    h.player = { ...h.player, playerId: player.id, providerPlayerId: String(1001 + i), name: player.name, position: player.position_group };
    h.season = year; h.games = Array.from({ length: 6 }, (_, j) => {
      const stats = sport === 'nba' ? { ...original.stats, points: j ? 10 * (j + i) : 100 * (i + 1), rebounds: j ? i ? 6 - j : j : 10,
        assists: j ? i ? j : 2 * j : 8, steals: j ? i ? 2 : 1 : 0, blocks: j ? i ? 1 : 2 : 0, turnovers: j ? i ? 2 : j : 6 }
        : { ...original.stats, passing_yards: i ? 0 : 100 + 10 * j, passing_tds: i ? 0 : 1, passing_ints: i ? 0 : 1,
          rushing_yards: 10 + j, rushing_tds: 0, receiving_yards: i ? 50 + j * 10 : 0, receiving_tds: 0, receptions: i ? 3 : 0, receiving_targets: i ? 5 : 0, fumbles_lost: 0 };
      if (year !== current) stats[sport === 'nba' ? 'points' : 'passing_yards'] = 9000 + i;
      return { ...structuredClone(original), providerPlayerId: h.player.providerPlayerId, eventId: String(10000 + j), season: year,
        gameAt: `${year === current ? '2026-10' : '2025-10'}-${String(25 + j).padStart(2, '0')}T20:00:00Z`, stats, issues: [] };
    });
    h.coverage = { kind: 'stored_appearances', expectedGames: 6, fetchedAt: asOf, freshness: 'fresh', comparisonEligible: false, issues: ['stored_appearance_coverage_unverified'] };
    histories.push(h);
  }
  return { players, current, histories, scoring };
}
function response(f, input, groupId = 'a') {
  return { groupId, ...compareHistories({ ...input, scoring: f.scoring }, f.histories.filter(h => h.season === input.season), asOf, asOf) };
}
function metric(tree, key) { return nodes(tree).find(n => n.props?.['data-comparison-metric'] === key); }
function cells(tree, key) { return nodes(metric(tree, key)).filter(n => n.props?.['data-comparison-player']); }
const value = cell => text(find(cell, 'span')).replace(/\s+/g, ' ').trim();
async function loadRows(props) { const h = host(Rows); h.render(props, true); await tick(); h.render(props, true); await tick(); return { h, tree: h.render(props) }; }

async function workspace(sport = 'nba', options = {}) {
  context.sport = sport; context.group = 'a'; process.env.NODE_ENV = 'production'; process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = 'true';
  const f = fixture(sport, options), requests = [], writes = [];
  global.fetch = async (url, init) => {
    assert.ok(!init?.method || init.method === 'GET', 'comparison never writes');
    const u = new URL(url, 'http://fixture'); requests.push(u);
    const body = u.pathname === '/api/player-history' ? { sport, scope: { groupId: 'a' }, playerHistory: [] }
      : u.pathname === '/api/player-center/comparisons' ? response(f, { sport, season: Number(u.searchParams.get('season')), window: u.searchParams.get('window'), metric: u.searchParams.get('metric'), ascending: false })
      : { available: true, professionalSeason: f.current - 1, playerStats: f.players.map(p => ({ player_id: p.id, fantasy_points: 99999, points: 99999, passing_yards_per_game: 99999 })) };
    return { ok: true, json: async () => body };
  };
  const props = { sport, players: f.players, filteredPlayers: f.players, searchTerm: '', setSearchTerm() {}, positionFilter: 'All', setPositionFilter() {}, onSlateOnly: false, setOnSlateOnly() {},
    availablePlayerIdsForSlate: f.players.map(p => p.id), availablePlayerIdSet: new Set(f.players.map(p => p.id)), playerAverageMap: new Map(), playerProjections: {}, getOwnerTeamForPlayer: () => null,
    setDraftingPlayer: p => writes.push(p.id), isAssigningPlayer: false, selectedSeason: '2026', nflSeason: '2026', centerSeason: f.current, slateId: 12,
    rosterSlots: [{ position: sport === 'nba' ? 'G' : 'QB', slot_count: 1 }], pillBase: '', activePill: '', inactivePill: '' };
  const outer = host(Pool), h = host(outer.render(props).type); h.render(props, true); await tick(); h.render(props, true); await tick();
  return { f, requests, writes, props, h, render: () => h.render(props), close: () => { h.unmount(); outer.unmount(); } };
}
function changeWindow(s, window) {
  const c = host(Center), b = host(Browser), browser = find(c.render(find(s.render(), Center).props), Browser);
  const control = find(b.render(browser.props), WindowControl); control.props.onChange(window);
  b.unmount(); c.unmount();
  assert.equal(find(s.render(), Center).props.researchWindow, window);
}
function openComparison(s, ids = [901, 902]) {
  nodes(s.render()).find(n => n.props?.['data-floating-compare']).props.onClick();
  for (const id of ids) find(s.render(), Center).props.comparison.onToggle(id);
  button(s.render(), `Compare ( ${ids.length} )`).props.onClick();
  return nodes(s.render()).find(n => n.props?.role === 'dialog');
}

test('NBA current Last 5 comparison inherits the browser context and uses one canonical all-metric response', async () => {
  const s = await workspace(); changeWindow(s, 'last5'); const dialog = openComparison(s);
  assert.match(text(dialog), /2026–27 NBA · Last 5 averages/);
  const props = find(dialog, Rows).props; assert.equal(props.season, 2027); assert.equal(props.window, 'last5'); assert.equal(props.slateId, 12);
  const { h, tree } = await loadRows(props);
  for (const [key, expected] of Object.entries({ fantasy_points: ['45.6', '52.1 ✓'], points: ['30.0', '40.0 ✓'], rebounds: ['3.0 ✓', '3.0 ✓'], assists: ['6.0 ✓', '3.0'], steals: ['1.0', '2.0 ✓'], blocks: ['2.0 ✓', '1.0'], turnovers: ['3.0', '2.0 ✓'] })) {
    const actual = cells(tree, key).map(value);
    assert.deepEqual(actual, expected, key);
  }
  const reads = s.requests.filter(u => u.pathname === '/api/player-center/comparisons'); assert.equal(reads.length, 1);
  assert.equal(reads[0].searchParams.get('season'), '2027'); assert.equal(reads[0].searchParams.get('window'), 'last5'); assert.equal(reads[0].searchParams.get('position'), null);
  assert.doesNotMatch(text(tree), /99999|9000/); assert.deepEqual(s.writes, []); h.unmount(); s.close();
});

test('a newly opened NBA comparison follows Season, Last game, Last 3 and explicit historical professional seasons', async () => {
  const s = await workspace(); changeWindow(s, 'season'); let dialog = openComparison(s);
  let loaded = await loadRows(find(dialog, Rows).props); assert.deepEqual(cells(loaded.tree, 'points').map(value), ['41.7', '66.7 ✓']); loaded.h.unmount();
  for (const [window, expected] of [['last1', ['50.0', '60.0 ✓']], ['last3', ['40.0', '50.0 ✓']]]) {
    button(dialog, '×').props.onClick(); changeWindow(s, window); button(s.render(), 'Compare ( 2 )').props.onClick();
    dialog = nodes(s.render()).find(n => n.props?.role === 'dialog'); assert.equal(find(dialog, Rows).props.window, window);
    loaded = await loadRows(find(dialog, Rows).props); assert.deepEqual(cells(loaded.tree, 'points').map(value), expected); loaded.h.unmount();
  }
  button(dialog, '×').props.onClick(); s.props.centerSeason = 2026; changeWindow(s, 'season'); button(s.render(), 'Compare ( 2 )').props.onClick();
  dialog = nodes(s.render()).find(n => n.props?.role === 'dialog'); assert.match(text(dialog), /2025–26 NBA · Season averages/);
  loaded = await loadRows(find(dialog, Rows).props); assert.deepEqual(cells(loaded.tree, 'points').map(value), ['9000.0', '9001.0 ✓']);
  assert.deepEqual(s.writes, []); loaded.h.unmount(); s.close();
});

test('explicit stored historical season selection requests that professional season rather than current/legacy cached averages', async () => {
  const s = await workspace();
  nodes(s.render()).find(n => n.props?.['aria-label'] === 'Game Stats source').props.onChange({ target: { value: 'averages' } });
  nodes(s.render()).find(n => n.props?.['data-floating-compare']).props.onClick();
  for (const id of [901, 902]) nodes(s.render()).find(n => n.props?.['aria-label'] === `Compare ${s.f.players.find(p => p.id === id).name}`).props.onClick();
  button(s.render(), 'Compare ( 2 )').props.onClick(); const dialog = nodes(s.render()).find(n => n.props?.role === 'dialog');
  assert.match(text(dialog), /2025–26 NBA · Season averages/); const loaded = await loadRows(find(dialog, Rows).props);
  assert.equal(s.requests.at(-1).searchParams.get('season'), '2026'); assert.equal(s.requests.at(-1).searchParams.get('window'), 'season');
  assert.doesNotMatch(text(loaded.tree), /99999/); loaded.h.unmount(); s.close();
});

test('missing current data never falls back to a previous season or zero', async () => {
  const s = await workspace(); s.f.histories = s.f.histories.filter(h => h.season !== 2027 || h.player.playerId !== 901);
  const dialog = openComparison(s), loaded = await loadRows(find(dialog, Rows).props);
  for (const key of ['fantasy_points', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers']) {
    const cell = cells(loaded.tree, key)[0]; assert.equal(value(cell), '—'); assert.equal(cell.props['data-best'], false); assert.match(text(cell), /Unavailable/);
  }
  assert.doesNotMatch(text(loaded.tree), /9000|99999/); loaded.h.unmount(); s.close();
});

test('short/incomplete current samples retain per-metric sample counts and unknown fantasy inputs', async () => {
  const s = await workspace(), h = s.f.histories.find(h => h.season === 2027 && h.player.playerId === 901); h.games = h.games.slice(-2);
  for (const g of h.games) g.stats.blocks = null;
  const dialog = openComparison(s), loaded = await loadRows(find(dialog, Rows).props);
  assert.equal(value(cells(loaded.tree, 'points')[0]), '45.0 ✓'); assert.match(text(cells(loaded.tree, 'points')[0]), /n=2.*Partial/);
  assert.equal(value(cells(loaded.tree, 'blocks')[0]), '—'); assert.equal(value(cells(loaded.tree, 'fantasy_points')[0]), '—');
  loaded.h.unmount(); s.close();
});

test('NFL current-season Last 3 works across three positions without inheriting the browser position filter', async () => {
  const s = await workspace('nfl'); s.props.positionFilter = 'QB'; changeWindow(s, 'last3'); const dialog = openComparison(s, [901, 902, 903]);
  assert.match(text(dialog), /2026 NFL · Last 3 averages/); const loaded = await loadRows(find(dialog, Rows).props);
  assert.equal(cells(loaded.tree, 'passing_yards').length, 3); assert.equal(value(cells(loaded.tree, 'passing_yards')[0]), '140.0 ✓');
  assert.equal(s.requests.at(-1).searchParams.get('position'), null); assert.equal(s.requests.at(-1).searchParams.get('season'), '2026');
  assert.deepEqual(s.writes, []); loaded.h.unmount(); s.close();
});

test('FP uses the same canonical frozen rules as the requested slate; metric directions preserve zero values', async () => {
  const s = await workspace('nba', { scoring: { points: 2 } });
  s.f.histories.find(h => h.season === 2027 && h.player.playerId === 901).games.forEach(g => { g.stats.turnovers = 0; });
  const dialog = openComparison(s), loaded = await loadRows(find(dialog, Rows).props);
  assert.equal(value(cells(loaded.tree, 'fantasy_points')[0]), '78.6'); assert.equal(value(cells(loaded.tree, 'turnovers')[0]), '0.0 ✓');
  assert.match(text(loaded.tree), /Frozen slate scoring/); loaded.h.unmount(); s.close();
});

test('late/wrong-context responses cannot flash another window, season or Group into comparison', async () => {
  context.group = 'a'; const f = fixture(), reads = [];
  const loader = { comparisons: (input, signal) => new Promise(resolve => reads.push({ input, signal, resolve })) };
  let props = { sport: 'nba', season: 2027, window: 'last5', slateId: 12, players: f.players.slice(0, 2), loader };
  const h = host(Rows); h.render(props, true); props = { ...props, window: 'season' }; h.render(props, true);
  assert.equal(reads[0].signal.aborted, true); reads[0].resolve(response(f, reads[0].input)); await tick();
  assert.equal(value(cells(h.render(props), 'points')[0]), '—'); reads[1].resolve(response(f, reads[1].input)); await tick();
  assert.equal(value(cells(h.render(props), 'points')[0]), '41.7');
  props = { ...props, season: 2026 }; h.render(props, true); reads[2].resolve(response(f, { ...reads[2].input, season: 2027 })); await tick();
  assert.match(text(h.render(props)), /Comparison context changed/); assert.equal(value(cells(h.render(props), 'points')[0]), '—');
  context.group = 'b'; h.render(props, true); reads[3].resolve(response(f, reads[3].input, 'a')); await tick();
  assert.match(text(h.render(props)), /Comparison context changed/); context.group = 'a'; h.render(props, true);
  const wrongSample = response(f, reads[4].input); wrongSample.players[0].summary.window = 'last1'; reads[4].resolve(wrongSample); await tick();
  assert.match(text(h.render(props)), /samples do not match/); assert.equal(value(cells(h.render(props), 'points')[0]), '—'); h.unmount();
  assert.equal(comparisonHeading('nba', 2027, 'last5'), '2026–27 NBA · Last 5 averages');
});
