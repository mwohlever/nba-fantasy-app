/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const Pool = require('../components/lineups/PlayerPool.tsx').default;
const Center = require('../components/player-center/DraftPlayerCenter.tsx').default;
const Browser = require('../components/player-center/ResearchBrowser.tsx').default;
const Research = require('../components/lineups/PlayerResearchModal.tsx').default;
const ObservedComparison = require('../components/player-center/ObservedComparisonRows.tsx').default;
const Headshot = require('../components/ui/PlayerHeadshot.tsx').default;
const tick = () => new Promise(resolve => setImmediate(resolve));
const content = tree => Array.isArray(tree) ? tree.map(content).join(' ') : tree && typeof tree === 'object' ? content(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const label = tree => content(tree).replace(/\s+/g, ' ').trim();
const find = (tree, type) => nodes(tree).find(n => n.type === type);
const button = (tree, text) => nodes(tree).find(n => n.type === 'button' && label(n) === text);
const cards = tree => nodes(tree).filter(n => n.type === 'button' && n.props['aria-label']?.startsWith('Select '));
const league = [
  { player_id: 1, times_drafted: 10, avg_score: 5, high_score: 10, winning_lineups: 0, runner_up_lineups: 2, avg_finish: 3 },
  { player_id: 2, times_drafted: 3, avg_score: 40, high_score: 50, winning_lineups: 1, runner_up_lineups: 0, avg_finish: 1 },
  { player_id: 3, times_drafted: 1, avg_score: 10, high_score: 80, winning_lineups: 4, runner_up_lineups: 3, avg_finish: 2 },
];
async function setup(sport, enabled) {
  context.sport = sport; context.group = 'a';
  process.env.NODE_ENV = 'production';
  if (enabled === undefined) delete process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED;
  else process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = String(enabled);
  const players = ['Alpha', 'Beta', 'Gamma', 'Missing'].map((name, i) => ({ id: i + 1, name,
    position_group: sport === 'nba' ? 'G' : 'QB', is_active: true, nba_player_id: i + 10, nfl_player_id: i + 100 }));
  const actions = [], requests = [];
  const season = players.slice(0, 3).map((p, i) => ({ player_id: p.id, points: [1, 3, 2][i], rebounds: [8, 2, 5][i], assists: i,
    steals: i, blocks: i, turnovers: i, fantasy_points: i + 5, fantasy_points_per_game: i + 5,
    passing_yards: [100, 300, 200][i], passing_tds: i, passing_ints: i, rushing_yards: i,
    passing_yards_per_game: [999, 1, 2][i], receiving_targets_per_game: i, receptions_per_game: i,
    receiving_yards_per_game: i, receiving_tds_per_game: i }));
  global.fetch = async (url, options) => {
    requests.push([url, options]);
    assert.ok(!options?.method || options.method === 'GET', 'browsing never writes');
    assert.ok(!url.includes('projections'), 'browsing never requests forecasts');
    return { ok: true, json: async () => url.startsWith('/api/player-history?')
      ? { sport, scope: { groupId: 'a' }, playerHistory: league }
      : { available: true, professionalSeason: 2025, playerStats: season } };
  };
  let props = { players, filteredPlayers: players, searchTerm: '', positionFilter: 'All', onSlateOnly: false,
    setSearchTerm: value => { props.searchTerm = value; filter(); },
    setPositionFilter: value => { props.positionFilter = value; filter(); },
    setOnSlateOnly: value => { props.onSlateOnly = value; filter(); },
    isAvailabilityLoading: false, availablePlayerIdsForSlate: [1, 2], availablePlayerIdSet: new Set([1, 2]),
    playerAverageMap: new Map([[1, -2], [2, 0], [3, 20]]), playerProjections: { 1: { projection: 99999, badges: ['hot'] } },
    getOwnerTeamForPlayer: id => id === 2 ? { id: 22, name: 'Owner team' } : null,
    setDraftingPlayer: player => actions.push(['draft', player.id]), isAssigningPlayer: false,
    selectedSeason: '2026', nflSeason: '2026', centerSeason: sport === 'nba' ? 2027 : 2026, slateId: 193,
    rosterSlots: [{ position: sport === 'nba' ? 'G' : 'QB', slot_count: 1 }], pillBase: '', activePill: '', inactivePill: '' };
  function filter() { props.filteredPlayers = players.filter(p => p.name.toLowerCase().includes(props.searchTerm.toLowerCase()) &&
    (props.positionFilter === 'All' || props.positionFilter === p.position_group) && (!props.onSlateOnly || props.availablePlayerIdSet.has(p.id))); }
  const outer = host(Pool), shell = outer.render(props), h = host(shell.type);
  h.render(props, true); await tick(); h.render(props, true); await tick();
  return { render: () => h.render(props), props, players, actions, requests, h, outer };
}
const prior = { node: process.env.NODE_ENV, flag: process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED, fetch: global.fetch };
test.after(() => {
  for (const [key, value] of [['NODE_ENV', prior.node], ['NEXT_PUBLIC_PLAYER_CENTER_ENABLED', prior.flag]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  global.fetch = prior.fetch;
});
for (const sport of ['nba', 'nfl']) for (const enabled of [true, false, undefined]) {
  const name = `${sport}, Player Center ${enabled === undefined ? 'unset' : enabled}`;
  test(`${name}: league research, all factual sorts, missing values, cards and selection`, async () => {
    const s = await setup(sport, enabled);
    button(s.render(), 'League History').props.onClick();
    const select = nodes(s.render()).find(n => n.type === 'select');
    assert.deepEqual(nodes(select).filter(n => n.type === 'option').map(n => n.props.value),
      ['average', 'times_drafted', 'avg_score', 'high_score', 'winning_lineups', 'runner_up_lineups', 'avg_finish', 'name']);
    for (const [sort, first] of [['times_drafted', 'Alpha'], ['avg_score', 'Beta'], ['high_score', 'Gamma'],
      ['winning_lineups', 'Gamma'], ['runner_up_lineups', 'Gamma'], ['avg_finish', 'Beta'], ['average', 'Gamma'], ['name', 'Alpha']]) {
      select.props.onChange({ target: { value: sort } });
      assert.equal(cards(s.render())[0].props['aria-label'], `Select ${first}`, sort);
      if (sort === 'average') assert.deepEqual(cards(s.render()).map(n => n.props['aria-label']), ['Select Gamma', 'Select Beta', 'Select Alpha', 'Select Missing']);
    }
    assert.equal(nodes(s.render()).filter(n => n.type === Headshot).length, 4);
    assert.match(content(s.render()), /AVG.*BEST.*WINS/s);
    assert.doesNotMatch(content(s.render()), /projection|99999|Trending up/i);
    assert.deepEqual(s.actions, []);
    cards(s.render())[0].props.onClick(); assert.deepEqual(s.actions, [['draft', 1]]);
    s.props.isAssigningPlayer = true; assert.ok(cards(s.render()).every(n => n.props.disabled));
    s.h.unmount(); s.outer.unmount();
  });
  test(`${name}: Compare two/three, limit, deselect, close/reopen and cancel without drafting`, async () => {
    const s = await setup(sport, enabled);
    nodes(s.render()).find(n => n.props?.['data-floating-compare']).props.onClick();
    const toggle = id => {
      const center = find(s.render(), Center);
      if (center) center.props.comparison.onToggle(id);
      else nodes(s.render()).find(n => n.props?.['aria-label'] === `Compare ${s.players[id - 1].name}`).props.onClick();
    };
    toggle(1); assert.ok(button(s.render(), 'Compare ( 1 )').props.disabled);
    toggle(2);
    for (const size of [2, 3]) {
      if (size === 3) toggle(3);
      button(s.render(), `Compare ( ${size} )`).props.onClick();
      const dialog = nodes(s.render()).find(n => n.props?.role === 'dialog');
      assert.ok(dialog); assert.equal(nodes(dialog).filter(n => n.type === Headshot).length, size);
      const observed = find(dialog, ObservedComparison), observedHost = observed ? host(ObservedComparison) : null;
      const stats = observedHost ? observedHost.render(observed.props) : dialog;
      assert.match(content(stats), sport === 'nba' ? /PTS.*REB/s : /Pass Yds\/G.*Rush Yds\/G/s);
      observedHost?.unmount();
      assert.doesNotMatch(content(dialog), /projection|99999/i);
      button(dialog, '×').props.onClick();
      assert.ok(button(s.render(), `Compare ( ${size} )`), 'closing retains selection for reopening');
    }
    toggle(4); assert.ok(button(s.render(), 'Compare ( 3 )'), 'fourth player rejected');
    toggle(1); assert.ok(button(s.render(), 'Compare ( 2 )'), 'selection toggles off');
    button(s.render(), 'Cancel').props.onClick();
    assert.ok(nodes(s.render()).some(n => n.props?.['data-floating-compare']));
    assert.deepEqual(s.actions, []); s.h.unmount(); s.outer.unmount();
  });
  test(`${name}: search/position/availability retain parent eligibility and never draft`, async () => {
    const s = await setup(sport, enabled);
    const center = find(s.render(), Center);
    if (center) {
      const c = host(Center), browser = find(c.render(center.props), Browser);
      browser.props.onSearch('Beta'); browser.props.onPosition(sport === 'nba' ? 'G' : 'QB');
      button(browser.props.extras, 'On slate').props.onClick();
      assert.deepEqual(find(c.render({ ...center.props, ...s.props }), Browser).props.entries.map(e => e.identity.id), [2]);
      assert.equal(browser.props.hidePositionFilter, undefined);
      c.unmount();
    } else {
      assert.equal(nodes(s.render()).some(n => n.props?.['aria-label']?.includes('player catalog')), false);
      nodes(s.render()).find(n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: 'Beta' } });
      const positions = nodes(s.render()).find(n => n.props?.['aria-label'] === 'Position filter');
      button(positions, sport === 'nba' ? 'G' : 'QB').props.onClick();
      button(s.render(), 'On Slate').props.onClick();
      assert.deepEqual(cards(s.render()).map(n => n.props['aria-label']), ['Select Beta']);
    }
    assert.deepEqual(s.actions, []); s.h.unmount(); s.outer.unmount();
  });
  test(`${name}: Game Stats retains factual categories and unique NFL season totals`, async () => {
    const s = await setup(sport, enabled);
    assert.equal(button(s.render(), 'Season Stats'), undefined);
    button(s.render(), 'Game Stats').props.onClick(); s.h.render(s.props, true);
    if (enabled !== false && sport === 'nba') {
      const center = find(s.render(), Center), h = host(Center), browser = find(h.render(center.props), Browser), b = host(Browser);
      const tree = b.render(browser.props), select = nodes(tree).find(n => n.props?.['aria-label'] === 'Stat sort');
      const keys = nodes(select).filter(n => n.type === 'option').map(n => n.props.value);
      for (const metric of ['fantasy_points', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers']) assert.ok(keys.includes(metric));
      assert.equal(browser.props.season, 2027); assert.deepEqual(s.actions, []);
      b.unmount(); h.unmount();
      nodes(s.render()).find(n => n.props?.['aria-label'] === 'Game Stats source').props.onChange({ target: { value: 'averages' } }); s.h.render(s.props, true);
    }
    if (enabled !== false && sport === 'nfl') {
      nodes(s.render()).find(n => n.props?.['aria-label'] === 'Game Stats source').props.onChange({ target: { value: 'totals' } }); s.h.render(s.props, true);
      assert.equal(button(s.render(), 'Game Stats').props['aria-pressed'], true);
    }
    const select = nodes(s.render()).find(n => n.props?.['aria-label'] === 'Draft player sort');
    const keys = nodes(select).filter(n => n.type === 'option').map(n => n.props.value);
    assert.ok(!keys.includes('projection'));
    if (sport === 'nfl') {
      select.props.onChange({ target: { value: 'nfl_pass_yd' } });
      assert.equal(cards(s.render())[0].props['aria-label'], 'Select Beta', 'sort uses 300 total, not 999 per game');
      assert.match(content(s.render()), /2025 regular-season stats · Totals/);
      const first = cards(s.render())[0]; assert.match(content(first), /300/); assert.doesNotMatch(content(first), /999/);
    } else {
      for (const metric of ['season_fp', 'season_pts', 'season_reb', 'season_ast', 'season_stl', 'season_blk', 'season_to']) assert.ok(keys.includes(metric));
      select.props.onChange({ target: { value: 'season_pts' } }); assert.equal(cards(s.render())[0].props['aria-label'], 'Select Beta');
    }
    nodes(s.render()).find(n => n.props?.['aria-label'] === 'Info about Alpha').props.onClick();
    assert.equal(find(s.render(), Research).props.centerSeason, s.props.centerSeason, 'new profile uses current professional season, independent of league-history/source-table year');
    assert.deepEqual(s.actions, []); s.h.unmount(); s.outer.unmount();
  });
}
test('restored browser remounts league data and compare state on Group/slate/sport changes', () => {
  const p = { slateId: 1, selectedSeason: '2026' }, h = host(Pool);
  context.group = 'a'; context.sport = 'nba'; const a = h.render(p);
  context.group = 'b'; assert.notEqual(h.render(p).key, a.key);
  context.group = 'a'; assert.notEqual(h.render({ ...p, slateId: 2 }).key, a.key);
  context.sport = 'nfl'; assert.notEqual(h.render(p).key, a.key); h.unmount();
});
test('mismatched Group history is rejected instead of displayed as factual league results', async () => {
  const s = await setup('nba', false);
  context.group = 'b'; s.h.render(s.props, true); await tick();
  assert.match(content(s.render()), /does not match the active Group/);
  assert.doesNotMatch(content(s.render()), /Drafted 10x/); s.h.unmount(); s.outer.unmount();
});
test('shared factual research comparison intercepts selection while retaining window/sort controls', async () => {
  const s = await setup('nba', true), toggled = [];
  const center = find(s.render(), Center), h = host(Center);
  const b = find(h.render({ ...center.props, comparison: { selectedIds: [2], onToggle: id => toggled.push(id) } }), Browser);
  const browserHost = host(Browser), tree = browserHost.render(b.props);
  const compare = nodes(tree).find(n => n.props?.['aria-label'] === 'Compare Alpha player profile');
  compare.props.onClick();
  assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Compare Beta player profile').props['aria-pressed'], true);
  assert.ok(nodes(tree).some(n => n.props?.['aria-label'] === 'Stat sort'));
  assert.match(content(tree), /Alphabetical · statistical ranking unavailable/);
  assert.deepEqual(toggled, [1]); assert.deepEqual(s.actions, []);
  browserHost.unmount(); h.unmount(); s.h.unmount(); s.outer.unmount();
});

for (const sport of ['nba', 'nfl']) test(`${sport}: legacy cards retain fixed-target selection and explicit slot research actions`, async () => {
  for (const enabled of [true, false]) {
    const s = await setup(sport, enabled);
    button(s.render(), 'League History').props.onClick();
    s.props.speedEntry = { onSelect: async p => { s.actions.push(['pick', p.id]); return true; }, onResearch: p => s.actions.push(['research', p.id]) };
    cards(s.render())[0].props.onClick();
    nodes(s.render()).find(n => n.props?.['aria-label'] === 'Info about Alpha').props.onClick();
    assert.deepEqual(s.actions, [['pick', 1], ['research', 1]]);
    assert.equal(find(s.render(), Research).props.player, null, 'speed-entry research stays in its parent workflow');
    delete s.props.speedEntry; s.actions.length = 0;
    s.props.slotDraftContext = { targetDraftSlot: { positionGroup: sport === 'nba' ? 'G' : 'QB' }, onDraftPlayer: async p => { s.actions.push(['slot', p.id]); } };
    nodes(s.render()).find(n => n.props?.['aria-label'] === 'Info about Alpha').props.onClick();
    const info = find(s.render(), Research); assert.equal(info.props.player.id, 1); assert.deepEqual(s.actions, []);
    await info.props.onAction(); assert.deepEqual(s.actions, [['slot', 1]]);
    assert.equal(find(s.render(), Research).props.player, null);
    s.h.unmount(); s.outer.unmount();
  }
});
