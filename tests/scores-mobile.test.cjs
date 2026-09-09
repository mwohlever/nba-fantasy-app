const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const { renderToStaticMarkup } = require('react-dom/server');
const ScoresDashboard = require('../components/lineups/ScoresDashboard.tsx').default;
const LineupControls = require('../components/lineups/LineupControls.tsx').default;
const RefreshButton = require('../components/ui/ScoresRefreshButton.tsx').default;
const Builder = require('../components/lineups/LineupBuilder.tsx').default;
const players = [{ id: 1, name: 'Player One', position_group: 'G', is_active: true }, { id: 2, name: 'Player Two', position_group: 'G', is_active: true }];
const teams = [{ id: 1, name: 'Alpha Team', is_participating: true }, { id: 2, name: 'Beta Team', is_participating: true }];
let totals = [25, 20];
const teamStats = id => ({ total: totals[id - 1], totalPlayers: 1, guards: 1, fcPlayers: 0,
  points: 10, rebounds: 3, assists: 2, steals: 1, blocks: 0, turnovers: 1,
  statTotals: { points: 10 }, games_completed: 0, games_in_progress: 1, games_remaining: 0, finish_position: null });
function dashboardProps(extra = {}) { return {
  players, teams, selectedSlate: { id: 1, sport: 'nba', is_locked: false }, rosterSlots: [{ position: 'G', slot_count: 1 }],
  getPlayersForTeam: id => [players[id - 1]], getTeamStats: teamStats,
  getPlayerStat: () => ({ points: 10, fantasy_points: 25 }), getRawPlayerStat: () => ({ game_status: 2 }),
  getLiveProjectedTeamTotal: () => 30, getPregameProjectedTeamTotal: () => 22,
  liveWinPctMap: new Map([[1, 60], [2, 40]]), playerProjections: {}, setProfilePlayer() {}, ...extra,
}; }
function dashboardHost(props) { return host(ScoresDashboard(props).type); }
const byClass = (tree, className) => nodes(tree).filter(n => n.props?.className?.split(' ').includes(className));
test('vertical scoreboard replaces horizontal leaderboard, pills and detached cards', () => {
  const props = dashboardProps(); const tree = dashboardHost(props).render(props);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /<h1 class="sr-only">Scores<\/h1>/);
  for (const removed of ['Fantasy scoreboard', 'Swipe →', 'Current leader', 'scores-selected-team-header',
    'scores-team-selector', 'scores-leaderboard-strip', 'scores-player-card', 'More Stats']) assert.ok(!html.includes(removed), removed);
  assert.equal(byClass(tree, 'scores-standing-toggle').length, 2);
  assert.equal(byClass(tree, 'scores-roster-player').length, 0);
  const rows = byClass(tree, 'scores-standing-toggle');
  assert.deepEqual(rows.map(row => row.props['aria-expanded']), [false, false]);
  assert.ok(rows.every(row => row.type === 'button' && row.props['aria-controls']));
  assert.match(renderToStaticMarkup(rows[0]), /Alpha Team/);
  assert.match(renderToStaticMarkup(rows[1]), /Beta Team/);
  assert.doesNotMatch(renderToStaticMarkup(rows[0]), /Proj/);
  assert.doesNotMatch(renderToStaticMarkup(rows[0]), /% win/);
  assert.match(renderToStaticMarkup(rows[0]), /0 final · 1 live · 0 left/);
});
test('collapsed defaults, one-team accordion, collapse and refresh persistence', () => {
  const props = dashboardProps({ currentTeamId: 2 }), h = dashboardHost(props);
  let tree = h.render(props, true);
  const rows = () => byClass(tree, 'scores-standing-toggle');
  assert.deepEqual(rows().map(row => row.props['aria-expanded']), [false, false]);
  rows()[1].props.onClick(); tree = h.render(props, true);
  assert.match(renderToStaticMarkup(tree), /Player Two/);
  rows()[1].props.onClick(); tree = h.render(props, true);
  assert.deepEqual(rows().map(row => row.props['aria-expanded']), [false, false]);
  tree = h.render({ ...props }, true); assert.equal(byClass(tree, 'scores-roster-player').length, 0);
  rows()[0].props.onClick(); tree = h.render(props, true);
  assert.deepEqual(rows().map(row => row.props['aria-expanded']), [true, false]);
  rows()[1].props.onClick(); tree = h.render(props, true);
  totals = [100, 21]; tree = h.render({ ...props }, true);
  assert.deepEqual(rows().map(row => row.props['aria-expanded']), [false, true]);
  assert.equal(byClass(tree, 'scores-roster-row')[0].key, '2');
});
test('scope/slate/sport and missing team reset collapsed', () => {
  const props = dashboardProps({ currentTeamId: 2, scopeKey: 'group-a' }), h = dashboardHost(props);
  let tree = h.render(props, true);
  byClass(tree, 'scores-standing-toggle')[0].props.onClick(); tree = h.render(props, true);
  assert.equal(byClass(tree, 'scores-standing-toggle')[0].props['aria-expanded'], true);
  for (const changed of [
    { ...props, selectedSlate: { ...props.selectedSlate, id: 2 } },
    { ...props, scopeKey: 'group-b' },
    { ...props, selectedSlate: { ...props.selectedSlate, sport: 'nfl' } },
  ]) {
    tree = h.render(props, true);
    const first = byClass(tree, 'scores-standing-toggle')[0];
    if (!first.props['aria-expanded']) first.props.onClick();
    tree = h.render(props, true);
    assert.equal(byClass(tree, 'scores-standing-toggle')[0].props['aria-expanded'], true);
    tree = h.render(changed, true);
    assert.deepEqual(byClass(tree, 'scores-standing-toggle').map(row => row.props['aria-expanded']), [false, false]);
  }
  tree = h.render({ ...props, teams: [teams[0]] }, true);
  assert.equal(byClass(tree, 'scores-standing-toggle')[0].props['aria-expanded'], false);
  const fallback = dashboardProps({ currentTeamId: 999 });
  assert.equal(byClass(dashboardHost(fallback).render(fallback), 'scores-standing-toggle')[0].props['aria-expanded'], false);
});
test('late owner identity never opens a roster or overrides explicit choice', () => {
  const props = dashboardProps(), h = dashboardHost(props);
  h.render(props, true);
  let tree = h.render({ ...props, currentTeamId: 2 }, true);
  assert.equal(byClass(tree, 'scores-standing-toggle')[1].props['aria-expanded'], false);
  byClass(tree, 'scores-standing-toggle')[0].props.onClick();
  tree = h.render({ ...props, currentTeamId: 2 }, true);
  assert.equal(byClass(tree, 'scores-standing-toggle')[0].props['aria-expanded'], true);
});
test('saved-pregame comparison and missing snapshot remain in expanded roster totals', () => {
  const props = dashboardProps({ selectedSlate: { id: 1, sport: 'nba', is_locked: true } });
  const h = dashboardHost(props);
  byClass(h.render(props), 'scores-standing-toggle')[0].props.onClick();
  const tree = h.render(props);
  const details = byClass(tree, 'scores-roster-totals')[0];
  assert.match(renderToStaticMarkup(details), /Pregame projection: 22.0 FP/);
  assert.match(renderToStaticMarkup(details), /vs projection/);
  assert.match(renderToStaticMarkup(h.render({ ...props, getPregameProjectedTeamTotal: () => null })), /No saved pregame projection/);
});
test('controls retain settings and use a real keyboard refresh button with shared disabled state', () => {
  const h = host(LineupControls);
  const props = { selectedSlateId: '1', selectedSlateIdNumber: 1, selectedSlateDisplay: 'May 25–26', selectedSlate: { is_locked: false },
    slates: [{ id: 1, label: 'May 25–26' }], seasons: ['2026'], selectedSeason: '2026', scoresStatus: 'Upcoming',
    refreshStatsForSelectedSlate: async () => ({ status: 'success' }), lastUpdatedAt: null };
  const tree = h.render(props), html = renderToStaticMarkup(tree);
  assert.match(html, /scores-compact-controls/); assert.match(html, /Upcoming/);
  assert.match(html, /Season/); assert.match(html, /Auto-refresh every 30 seconds/); assert.match(html, /View standings/);
  assert.ok(!html.includes('Change Slate &amp; Settings'));
  const fallback = nodes(tree).find(n => n.type === RefreshButton);
  let invoked = 0; const button = RefreshButton({ ...fallback.props, onRefresh: () => invoked++ });
  assert.equal(button.type, 'button'); assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-label'], 'Refresh scores'); button.props.onClick(); assert.equal(invoked, 1);
  const locked = h.render({ ...props, selectedSlate: { is_locked: true } });
  assert.equal(nodes(locked).find(n => n.type === RefreshButton).props.disabled, true);
});
function builderProps(sport = 'nba', locked = false) { return {
  players, teams, slates: [{ id: 1, date: '2026-09-08', sport, is_locked: locked }], slateTeamConfigs: [], playerAverages: [],
  initialSelectedSlateId: 1, savedLineupsForInitialSlate: [], playerStats: [], teamResults: [], defaultViewMode: 'scoring', sport,
}; }
function inspect(tree) {
  const dashboard = nodes(tree).find(n => n.type === ScoresDashboard);
  return { dashboard, refresh: dashboard.props.controls.props.refreshStatsForSelectedSlate,
    mappingKey: tree.props.refreshKey, feedback: dashboard.props.controls.props.refreshFeedback?.props.feedback };
}
const reply = (data, ok = true) => ({ ok, json: async () => data });
test('NBA/NFL handler outcomes: success reloads stats and NFL mapping key; error never advances timestamp; concurrency skips', async () => {
  for (const sport of ['nba', 'nfl']) {
    context.sport = sport; context.group = 'group-a'; const props = builderProps(sport), h = host(Builder);
    let tree = h.render(props), refresh = inspect(tree).refresh, requests = [];
    let resolveProvider;
    global.fetch = async (url) => {
      requests.push(url);
      if (url.startsWith('/api/refresh-stats')) return new Promise(resolve => { resolveProvider = resolve; });
      if (url.startsWith('/api/player-stats')) return reply({ playerStats: [{ player_id: 1, fantasy_points: 42 }] });
      if (url.startsWith('/api/team-results')) return reply({ teamResults: [] });
      return reply({ availablePlayerIds: [] });
    };
    const pending = refresh(false); assert.deepEqual(await refresh(false), { status: 'skipped' });
    resolveProvider(reply({})); assert.deepEqual(await pending, { status: 'success' });
    tree = h.render(props); assert.ok(inspect(tree).mappingKey);
    assert.equal(inspect(tree).dashboard.props.getPlayerStat(1).fantasy_points, 42);
    assert.ok(requests.includes(sport === 'nfl' ? '/api/refresh-stats-nfl' : '/api/refresh-stats'));
    const timestamp = inspect(tree).mappingKey;
    const oldError = console.error; console.error = () => {};
    global.fetch = async () => reply({ error: 'Provider unavailable' }, false);
    try { assert.equal((await inspect(tree).refresh(false)).status, 'error'); } finally { console.error = oldError; }
    tree = h.render(props); assert.equal(inspect(tree).mappingKey, timestamp);
    assert.match(inspect(tree).feedback, /Unable to refresh/);
  }
});
test('in-flight completion after Group/sport/slate change and A-B-A cannot apply old results', async () => {
  for (const change of ['group', 'sport', 'slate', 'roundtrip']) {
    context.group = 'group-a'; context.sport = 'nba'; const props = builderProps();
    props.slates.push({ ...props.slates[0], id: 2 });
    const h = host(Builder); let resolveStats;
    global.fetch = async url => url.startsWith('/api/player-stats')
      ? new Promise(resolve => { resolveStats = resolve; }) : reply({ teamResults: [] });
    const first = inspect(h.render(props)); const pending = first.refresh(false);
    await new Promise(resolve => setImmediate(resolve));
    if (change === 'group' || change === 'roundtrip') context.group = 'group-b';
    if (change === 'sport') context.sport = 'nfl';
    if (change === 'slate') first.dashboard.props.controls.props.setSelectedSlateId('2');
    h.render(props);
    if (change === 'roundtrip') { context.group = 'group-a'; h.render(props); }
    resolveStats(reply({ playerStats: [{ player_id: 1, fantasy_points: 999 }] }));
    assert.deepEqual(await pending, { status: 'skipped' });
    const state = inspect(h.render(props)); assert.equal(state.mappingKey, null);
    assert.equal(state.dashboard.props.getPlayerStat(1).fantasy_points, 0);
    assert.notEqual(state.feedback, 'Updated just now');
    assert.deepEqual(await first.refresh(false), { status: 'skipped' });
  }
});
test('locked manual action skips without network and silent polling produces no announcement', async () => {
  context.group = 'group-a'; context.sport = 'nba'; let calls = 0;
  global.fetch = async () => { calls++; return reply({ playerStats: [], teamResults: [] }); };
  let h = host(Builder), props = builderProps('nba', true);
  assert.deepEqual(await inspect(h.render(props)).refresh(false), { status: 'skipped' }); assert.equal(calls, 0);
  h = host(Builder); props = builderProps(); await inspect(h.render(props)).refresh(true);
  assert.equal(inspect(h.render(props)).feedback, '');
});
test('upcoming/live refresh; completed NBA/NFL including silent calls and invalid contexts skip', async () => {
  context.group = 'group-a'; let calls = 0;
  global.fetch = async () => { calls++; return reply({ playerStats: [], teamResults: [] }); };
  for (const sport of ['nba', 'nfl']) {
    context.sport = sport;
    for (const [completed, live, remaining, allowed] of [[0,0,1,true], [0,1,0,true], [1,0,1,true], [1,0,0,false]]) {
      const props = builderProps(sport); props.teamResults = [{ games_completed: completed, games_in_progress: live, games_remaining: remaining }];
      for (const silent of [false, true]) {
        const h = host(Builder); const before = calls;
        assert.equal((await inspect(h.render(props)).refresh(silent)).status, allowed ? 'success' : 'skipped');
        if (!allowed) assert.equal(calls, before);
      }
    }
  }
  context.sport = 'nba'; const props = builderProps(); props.slates = [];
  assert.equal((await inspect(host(Builder).render(props)).refresh()).status, 'skipped');
});
test('Golf uses existing browser helper and only accepted player/team snapshots; newer revisions win', async () => {
  context.sport = 'golf'; context.group = 'group-a'; const props = builderProps('golf');
  // These game counts must never classify Golf as completed.
  props.teamResults = [{ games_completed: 4, games_in_progress: 0, games_remaining: 0 }];
  const h = host(Builder); let revision = 8, requestedRevision = 7, requests = [];
  global.fetch = async url => {
    requests.push(url);
    if (url.startsWith('/api/golf/refresh-config')) return reply({ eventId: 'golf-event', year: '2026' });
    if (url.startsWith('https://site.api.espn.com/')) return reply({ events: [{ id: 'golf-event', competitions: [] }] });
    if (url === '/api/refresh-stats-golf') return reply({ acceptedRevision: requestedRevision });
    if (url.startsWith('/api/player-stats')) return reply({ sport: 'golf', acceptedRevision: revision,
      playerStats: [{ player_id: 1, fantasy_points: revision }], teamResults: [{ team_id: 1, fantasy_points: revision }] });
    return reply({ availablePlayerIds: [] });
  };
  const golfRefresh = tree => nodes(inspect(tree).dashboard.props.controls).find(n => n.type === RefreshButton).props.onRefresh;
  assert.equal((await golfRefresh(h.render(props))()).status, 'success');
  let tree = h.render(props);
  assert.equal(inspect(tree).dashboard.props.getPlayerStat(1).fantasy_points, 8);
  assert.equal(inspect(tree).dashboard.props.getTeamStats(1).total, 8);
  revision = 7; // Valid snapshot for the just-completed refresh, older than already accepted UI state.
  assert.equal((await golfRefresh(tree)()).status, 'success'); tree = h.render(props);
  assert.equal(inspect(tree).dashboard.props.getPlayerStat(1).fantasy_points, 8);
  revision = 9; assert.equal((await golfRefresh(tree)()).status, 'success'); tree = h.render(props);
  assert.equal(inspect(tree).dashboard.props.getPlayerStat(1).fantasy_points, 9);
  const timestamp = inspect(tree).mappingKey; revision = 6;
  const oldError = console.error; console.error = () => {};
  try { assert.equal((await golfRefresh(tree)()).status, 'error'); } finally { console.error = oldError; }
  assert.equal(inspect(h.render(props)).mappingKey, timestamp);
  assert.ok(requests.includes('/api/refresh-stats-golf'));
  assert.ok(requests.some(url => url.startsWith('https://site.api.espn.com/')));
  assert.ok(!requests.some(url => url.startsWith('/api/team-results')));
  props.slates[0].is_locked = true;
  assert.equal((await golfRefresh(h.render(props))()).status, 'skipped');
});
test('unmount rejects pending provider completion and old callbacks without further requests', async () => {
  context.group = 'group-a'; context.sport = 'nba';
  global.window = { innerWidth: 390, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout };
  global.document = { visibilityState: 'hidden' };
  global.fetch = async () => reply({ lineups: [], playerStats: [], teamResults: [] });
  const props = builderProps(), h = host(Builder);
  h.render(props, true); await new Promise(resolve => setImmediate(resolve));
  let resolveProvider, calls = 0;
  global.fetch = async () => { calls++; return new Promise(resolve => { resolveProvider = resolve; }); };
  const refresh = inspect(h.render(props)).refresh;
  const pending = refresh(false); h.unmount(); resolveProvider(reply({}));
  assert.equal((await pending).status, 'skipped'); assert.equal(calls, 1);
  assert.equal((await refresh()).status, 'skipped'); assert.equal(calls, 1);
  delete global.window; delete global.document;
});
test('canonical slots, compact empty positions, player modal and NFL Game Center survive', () => {
  const { NflFantasyGameAction, NflFantasyGamesContext } = require('../components/lineups/NflFantasyGameCenter.tsx');
  const { React } = require('./helpers/scores-harness.cjs');
  const nflPlayers = [{ id: 3, name: 'Receiver', position_group: 'WR', nfl_player_id: 303 },
    { id: 1, name: 'Quarterback', position_group: 'QB', nfl_player_id: 101, team_abbreviation: 'BUF' },
    { id: 2, name: 'Runner', position_group: 'RB', nfl_player_id: 202 }];
  let opened;
  const props = dashboardProps({ selectedSlate: { id: 1, sport: 'nfl' }, currentTeamId: 1,
    rosterSlots: [{ sport: 'nfl', position: 'QB', slot_count: 1 }, { sport: 'nfl', position: 'RB', slot_count: 2 },
      { sport: 'nfl', position: 'WR', slot_count: 1 }],
    getPlayersForTeam: () => nflPlayers, setProfilePlayer: player => { opened = player; } });
  const h = dashboardHost(props);
  byClass(h.render(props), 'scores-standing-toggle')[0].props.onClick();
  const tree = h.render(props);
  const playerRows = byClass(tree, 'scores-roster-player');
  assert.deepEqual(playerRows.map(row => row.props['aria-label'].split(',')[0]), ['Quarterback', 'Runner', 'Receiver']);
  assert.equal(byClass(tree, 'scores-roster-empty').length, 1);
  assert.match(renderToStaticMarkup(byClass(tree, 'scores-roster-empty')[0]), /RB.*No player drafted/);
  playerRows[0].props.onClick(); assert.equal(opened.id, 1);
  assert.equal(nodes(tree).filter(row => row.type === NflFantasyGameAction).length, 3);
  const withGames = React.createElement(NflFantasyGamesContext.Provider, { value: {
    gamesByTeam: { BUF: { status: 'in', espnEventId: '123' } }, openGameCenter() {},
  } }, tree);
  assert.match(renderToStaticMarkup(withGames), /View Live Game: Quarterback/);
});
test('nonparticipants are excluded and manual expansion persists when rankings change', () => {
  totals = [25, 20];
  const props = dashboardProps({ teams: [...teams, { id: 99, name: 'Inactive', is_participating: false }] });
  const h = dashboardHost(props);
  byClass(h.render(props, true), 'scores-standing-toggle')[0].props.onClick();
  h.render(props, true);
  totals = [20, 25]; const tree = h.render({ ...props }, true);
  const rows = byClass(tree, 'scores-standing-toggle');
  assert.match(renderToStaticMarkup(rows[0]), /Beta Team/);
  assert.deepEqual(rows.map(row => row.props['aria-expanded']), [false, true]);
  assert.equal(rows.length, 2);
});
test('a successful page refresh updates inline scores without changing the expanded opponent', async () => {
  context.group = 'group-a'; context.sport = 'nba';
  const props = builderProps();
  props.savedLineupsForInitialSlate = [{ team_id: 1, player_ids: [1], pregame_projected_points: 20 },
    { team_id: 2, player_ids: [2], pregame_projected_points: 20 }];
  const builder = host(Builder);
  let page = inspect(builder.render(props));
  const dashboardProps = { ...page.dashboard.props, currentTeamId: 2 };
  const dashboard = dashboardHost(dashboardProps);
  let tree = dashboard.render(dashboardProps, true);
  const opponent = byClass(tree, 'scores-standing-toggle').find(row => renderToStaticMarkup(row).includes('Alpha Team'));
  opponent.props.onClick(); dashboard.render(dashboardProps, true);
  global.fetch = async url => url.startsWith('/api/player-stats')
    ? reply({ playerStats: [{ player_id: 1, fantasy_points: 42 }] })
    : reply({ teamResults: [{ team_id: 1, fantasy_points: 42, games_in_progress: 1 }, { team_id: 2, fantasy_points: 50, games_in_progress: 1 }] });
  assert.equal((await page.refresh(false)).status, 'success');
  page = inspect(builder.render(props));
  tree = dashboard.render({ ...page.dashboard.props, currentTeamId: 2 }, true);
  const expanded = byClass(tree, 'scores-standing-toggle').filter(row => row.props['aria-expanded']);
  assert.equal(expanded.length, 1); assert.match(renderToStaticMarkup(expanded[0]), /Alpha Team/);
  assert.match(byClass(tree, 'scores-roster-player')[0].props['aria-label'], /42.0 fantasy points/);
});
test('four participating teams stay in score order with all rosters initially collapsed', () => {
  const fourTeams = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }, { id: 3, name: 'Three' }, { id: 4, name: 'Four' }];
  const props = dashboardProps({ teams: fourTeams, currentTeamId: 3,
    getPlayersForTeam: () => [players[0]],
    getTeamStats: id => ({ ...teamStats(1), total: ({ 1: 10, 2: 40, 3: 20, 4: 30 })[id] }) });
  const tree = dashboardHost(props).render(props);
  const rows = byClass(tree, 'scores-standing-toggle');
  assert.deepEqual(rows.map(row => row.props['aria-controls']), ['scores-roster-nba-1-2', 'scores-roster-nba-1-4', 'scores-roster-nba-1-3', 'scores-roster-nba-1-1']);
  assert.deepEqual(rows.map(row => row.props['aria-expanded']), [false, false, false, false]);
});
test('builder passes active Group team ownership and scope to the shared scoreboard', () => {
  context.sport = 'nba'; context.group = 'group-a'; context.team = 2;
  try {
    const h = host(Builder), props = builderProps();
    const first = inspect(h.render(props)).dashboard.props;
    assert.equal(first.currentTeamId, 2);
    context.group = 'group-b'; context.team = 1;
    const second = inspect(h.render(props)).dashboard.props;
    assert.equal(second.currentTeamId, 1); assert.notEqual(second.scopeKey, first.scopeKey);
  } finally { delete context.team; context.group = 'group-a'; }
});

test('NFL has no projection analysis even when expanded; NBA analysis stays in secondary totals', () => {
  for (const sport of ['nba', 'nfl']) {
    const props = dashboardProps({ selectedSlate: { id: 1, sport } });
    const h = dashboardHost(props);
    let tree = h.render(props);
    assert.doesNotMatch(renderToStaticMarkup(tree), /Proj|% win/);
    byClass(tree, 'scores-standing-toggle')[0].props.onClick();
    tree = h.render(props);
    if (sport === 'nfl') assert.doesNotMatch(renderToStaticMarkup(tree), /projection|pregame|% win/i);
    else assert.match(renderToStaticMarkup(byClass(tree, 'scores-roster-totals')[0]), /Projected final.*win probability.*Pregame projection/);
  }
});
