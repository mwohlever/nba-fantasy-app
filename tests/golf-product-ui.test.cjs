/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const React = require('react');
React.useCallback = (fn, deps) => React.useMemo(() => fn, deps);
const { renderToStaticMarkup } = require('react-dom/server');
const Setup = require('../components/golf/GolfGameSetup.tsx').default;
const Builder = require('../components/lineups/GolfSalaryCapBuilder.tsx').default;
const Leaderboard = require('../components/golf/GolfLiveLeaderboard.tsx').default;
const GolfLivePage = require('../components/golf/GolfLivePage.tsx').default;
const ReadOnlyPlayerModal = require('../components/lineups/ReadOnlyPlayerModal.tsx').default;
const PlayerHeadshot = require('../components/ui/PlayerHeadshot.tsx').default;
const { calculateGolfCutLine } = require('../lib/golf/cutLine.ts');
const {
  getGolfProviderHeadshotUrl,
  isOptimizedGolfHeadshotUrl,
} = require('../lib/golf/headshots.ts');
const {
  getNbaProviderHeadshotUrl,
  getNflProviderHeadshotUrl,
  isOptimizedSportsHeadshotUrl,
} = require('../lib/sports/headshots.ts');
const { getGroupSwitchDestination } = require('../lib/groups/navigation.ts');

test('Golf derives the canonical mobile nav for both Golf and shared profile routes', () => {
  const source = fs.readFileSync('components/AppNav.tsx', 'utf8');
  const ast = ts.createSourceFile('AppNav.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const visit = node => { if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer); ts.forEachChild(node, visit); };
  visit(ast);
  const main = Function(`return (${declarations.get('mainLinks').getText(ast)})`)();
  const getLinks = Function('isNbaSkins', 'isNcaaPickEm', 'isBracketChallenge', 'bracketContestId', 'activeSport', 'mainLinks', `return (${declarations.get('displayedMainLinks').getText(ast)})`);
  const getSharedRouteSport = Function('sportParam', `return (${declarations.get('sharedRouteSport').getText(ast)})`);
  const getRouteSport = Function('pathname', 'sharedRouteSport', `return (${declarations.get('routeSport').getText(ast)})`);
  const getActiveSport = Function('routeSport', 'selectedSport', `return (${declarations.get('activeSport').getText(ast)})`);
  const getMoreLinks = Function('isBracketChallenge', 'activeSport', `return (${declarations.get('mobileMoreLinks').getText(ast)})`);
  const getMoreIsActive = Function('pathname', `return (${declarations.get('moreIsActive').getText(ast)})`);
  const golf = getLinks(false, false, false, null, 'golf', main);
  const profileRouteSport = getRouteSport('/profile', getSharedRouteSport('golf'));
  const profileActiveSport = getActiveSport(profileRouteSport, 'nba');
  assert.equal(profileActiveSport, 'golf');
  assert.deepEqual(golf.map(x => x.label), ['Home', 'Lineup', 'Scores', 'Live']);
  assert.deepEqual(getLinks(false, false, false, null, profileActiveSport, main).map(x => x.label), ['Home', 'Lineup', 'Scores', 'Live']);
  assert.equal(golf[2].href, '/lineups/scores');
  assert.equal(golf[3].href, '/golf/live');
  assert.deepEqual(getMoreLinks(false, 'golf').map(x => x.label), ['Standings', 'Player History']);
  assert.equal(getMoreIsActive('/standings'), true);
  assert.equal(getMoreIsActive('/player-history'), true);
  assert.equal(getMoreIsActive('/profile'), false);
  assert.deepEqual(getLinks(false, false, false, null, 'nba', main).map(x => x.label), ['Home', 'Draft', 'Scores']);
  assert.deepEqual(getLinks(false, false, false, null, 'nfl', main).map(x => x.label), ['Home', 'Draft', 'Scores', 'Live']);
  assert.deepEqual(getLinks(false, true, false, null, 'ncaa', main).map(x => x.href), ['/ncaa-pickem', '/ncaa-pickem/scores', '/ncaa-pickem/standings']);
  assert.match(source, /!isNcaaPickEm && !isNbaSkins \? \(/);
  assert.doesNotMatch(fs.readFileSync('components/MobileAccountMenu.tsx', 'utf8'), /player-history|Player History/);
  assert.match(fs.readFileSync('app/lineups/scores/page.tsx', 'utf8'), /defaultViewMode="scoring"/);
  assert.match(fs.readFileSync('components/lineups/ScoresDashboard.tsx', 'utf8'), /<GolfScoresDashboard/);
  assert.match(fs.readFileSync('app/golf/live/page.tsx', 'utf8'), /GolfLivePage/);
});

test('Golf Live preserves Group switching only when Golf is enabled', () => {
  const input = { pathname: '/golf/live', targetGroupSlug: 'test', enabledSports: ['golf'], canAdministerGroup: false };
  assert.equal(getGroupSwitchDestination(input), '/golf/live');
  assert.equal(getGroupSwitchDestination({ ...input, enabledSports: ['nba'] }), '/groups/test');
  assert.equal(getGroupSwitchDestination({ ...input, search: '?slateId=123' }), '/groups/test');
});

test('Golf Live renders its leaderboard before lazy scorecard stats and reuses loaded stats', async () => {
  const previousFetch = global.fetch;
  const previousCapturePull = context.capturePull;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const calls = [];
  context.capturePull = true;
  context.pathname = '/golf/live';
  context.sport = 'golf';
  context.group = 'golf-group';
  context.loading = false;
  context.switching = false;
  global.fetch = async url => {
    calls.push(String(url));
    if (String(url).startsWith('/api/home-summary')) {
      return {
        ok: true,
        json: async () => ({
          latestSlate: { id: 187, label: 'Tournament', start_date: '2026-09-17', end_date: '2026-09-20', is_locked: false },
          tournamentLeaderboard: [{ playerId: 1, name: 'First Golfer', score: -2, scoreDisplay: '-2', position: 1, positionDisplay: '1', statusState: 'playing' }],
        }),
      };
    }
    if (String(url).startsWith('/api/player-stats')) {
      return { ok: true, json: async () => ({ playerStats: [{ player_id: 1, rounds: [] }] }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const h = host(GolfLivePage);
    h.render({}, true);
    await flush();
    let tree = h.render({});
    let leaderboard = nodes(tree).find(node => node.type === Leaderboard);
    assert.ok(leaderboard, 'home summary alone renders the leaderboard');
    assert.equal(calls.filter(url => url.startsWith('/api/player-stats')).length, 0);

    leaderboard.props.onSelect(leaderboard.props.rows[0]);
    tree = h.render({});
    assert.ok(nodes(tree).find(node => node.type === Leaderboard), 'the leaderboard remains mounted while scorecard stats load');
    assert.equal(nodes(tree).find(node => node.type === ReadOnlyPlayerModal).props.golfStatsLoading, true);
    assert.equal(calls.filter(url => url.startsWith('/api/player-stats')).length, 1);

    await flush();
    tree = h.render({});
    leaderboard = nodes(tree).find(node => node.type === Leaderboard);
    leaderboard.props.onSelect({ ...leaderboard.props.rows[0], playerId: 2, name: 'Second Golfer' });
    assert.equal(calls.filter(url => url.startsWith('/api/player-stats')).length, 1, 'the mounted slate reuses its scorecard payload');
    h.unmount();
  } finally {
    global.fetch = previousFetch;
    context.capturePull = previousCapturePull;
  }
});

test('shared Scores owns one initial availability request and mobile account UI reuses AppNav user state', () => {
  const builder = fs.readFileSync('components/lineups/LineupBuilder.tsx', 'utf8');
  const nav = fs.readFileSync('components/AppNav.tsx', 'utf8');
  const mobileMenu = fs.readFileSync('components/MobileAccountMenu.tsx', 'utf8');

  assert.equal(
    (builder.match(/\/api\/slate-availability\?slateId=\$\{nextSlateId\}/g) || []).length,
    1,
    'non-draft Scores loads availability once with its primary slate payload',
  );
  assert.match(builder, /const availabilityRequest = fetch\(/);
  assert.match(builder, /const \[lineupsResponse, statsResponse, resultsResponse\] = await Promise\.all/);
  assert.doesNotMatch(mobileMenu, /fetch\("\/api\/me"/);
  assert.match(nav, /<MobileAccountMenu\s+currentUser=\{currentUser\}\s+isLoading=\{isUserLoading\}/);
});

test('Golf mobile tabs skip only expensive Draft and Scores prefetches', () => {
  const nav = fs.readFileSync('components/AppNav.tsx', 'utf8');
  assert.match(nav, /function shouldPrefetchMobileLink\(href: string\)/);
  assert.match(nav, /activeSport === "golf"/);
  assert.match(nav, /href === "\/lineups\/draft" \|\| href === "\/lineups\/scores"/);
  assert.match(nav, /prefetch=\{shouldPrefetchMobileLink\(link\.href\)\}/);
  assert.doesNotMatch(nav, /prefetch=\{false\}[^\n]*className=\{desktopLinkClass/);
});

test('Golf Live requests the lightweight accepted-summary variant before Home-only fantasy work', () => {
  const route = fs.readFileSync('app/api/home-summary/route.ts', 'utf8');
  const live = fs.readFileSync('components/golf/GolfLivePage.tsx', 'utf8');
  const summary = fs.readFileSync('lib/home/golfHomeSummary.ts', 'utf8');
  const liveReturn = summary.indexOf('if (liveOnly) {');
  const fantasyBoard = summary.indexOf('const canonicalFantasy = latestSlate ? await loadGolfFantasy');

  assert.match(live, /\/api\/home-summary\?sport=golf&view=live/);
  assert.match(route, /liveOnly: searchParams\.get\("view"\) === "live"/);
  assert.ok(liveReturn >= 0 && liveReturn < fantasyBoard, 'Live returns before building the canonical fantasy board');
  assert.match(summary, /const avatarByTeamId = liveOnly/);
  assert.match(summary, /const latestRows = !liveOnly && latestSlate/);
  assert.match(summary, /const seasonSnapshot = liveOnly \? \[\]/);
  assert.match(summary, /latestGolfTournamentIsFinal,\s+tournamentLeaderboard,\s+projectedCut,\s+liveTournamentRound/s);
  assert.match(live, /playerStatsCacheRef\.current = null/);
});

test('Golf headshots prefer cached assets, then ESPN, then initials', () => {
  const optimizedUrl = 'https://example.supabase.co/storage/v1/object/public/golf-headshots/espn/123.webp?v=abcdef';
  const h = host(PlayerHeadshot);
  const props = { espnGolfPlayerId: '123', imageUrl: optimizedUrl, playerName: 'Golf Player' };
  let tree = h.render(props, true);
  let image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, optimizedUrl);
  assert.equal(image.props.width, 32);
  assert.equal(image.props.height, 32);
  assert.equal(image.props.loading, 'lazy');

  image.props.onError();
  tree = h.render(props);
  image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, 'https://a.espncdn.com/i/headshots/golf/players/full/123.png');
  image.props.onError();
  tree = h.render(props);
  assert.equal(nodes(tree).filter(node => node.type === 'img').length, 0);
  assert.ok(nodes(tree).some(node => node.props?.children === 'GP'));
  assert.equal(getGolfProviderHeadshotUrl('pga:123'), null);
  assert.equal(isOptimizedGolfHeadshotUrl(optimizedUrl), true);
  assert.equal(isOptimizedGolfHeadshotUrl('https://a.espncdn.com/i/headshots/golf/players/full/123.png'), false);
});

test('NBA and NFL headshots prefer cached assets, then their provider originals, then initials', () => {
  const optimizedNba = 'https://example.supabase.co/storage/v1/object/public/sports-headshots/nba/203999.webp?v=abcdef';
  const optimizedNfl = 'https://example.supabase.co/storage/v1/object/public/sports-headshots/nfl/3139477.webp?v=abcdef';
  const nba = host(PlayerHeadshot);

  let tree = nba.render({ nbaPlayerId: 203999, imageUrl: optimizedNba, playerName: 'NBA Player' }, true);
  let image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, optimizedNba);
  image.props.onError();
  tree = nba.render({ nbaPlayerId: 203999, imageUrl: optimizedNba, playerName: 'NBA Player' });
  image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, getNbaProviderHeadshotUrl(203999));
  image.props.onError();
  assert.equal(nodes(nba.render({ nbaPlayerId: 203999, imageUrl: optimizedNba, playerName: 'NBA Player' })).filter(node => node.type === 'img').length, 0);

  const nfl = host(PlayerHeadshot);
  tree = nfl.render({ nflPlayerId: 3139477, imageUrl: optimizedNfl, playerName: 'NFL Player' }, true);
  image = nodes(tree).find(node => node.type === 'img');
  assert.equal(image.props.src, optimizedNfl);
  image.props.onError();
  tree = nfl.render({ nflPlayerId: 3139477, imageUrl: optimizedNfl, playerName: 'NFL Player' });
  assert.equal(nodes(tree).find(node => node.type === 'img').props.src, getNflProviderHeadshotUrl(3139477));
  assert.equal(isOptimizedSportsHeadshotUrl(optimizedNba), true);
  assert.equal(isOptimizedSportsHeadshotUrl('https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png'), false);
});

test('NBA/NFL caching is shared, post-sync maintenance and backfills only successful optimized assets', () => {
  const script = fs.readFileSync('scripts/cache-sports-headshots.mjs', 'utf8');
  const cache = fs.readFileSync('scripts/lib/sportsHeadshotCache.js', 'utf8');
  const nbaSync = fs.readFileSync('app/api/sync-players/route.ts', 'utf8');
  const nflSync = fs.readFileSync('app/api/sync-players-nfl/route.ts', 'utf8');
  const migration = fs.readFileSync('supabase/migrations/20260928000300_nba_nfl_optimized_headshots.sql', 'utf8');
  assert.match(script, /cacheSportsHeadshots/);
  assert.match(script, /--sport nba or --sport nfl is required/);
  assert.match(cache, /SPORTS_HEADSHOT_CONCURRENCY = 3/);
  assert.match(cache, /cacheControl: "31536000"/);
  assert.match(cache, /withoutEnlargement: true/);
  assert.match(cache, /isCachedSportsHeadshot/);
  assert.match(cache, /\.update\(\{ headshot_url:/);
  for (const sync of [nbaSync, nflSync]) {
    assert.match(sync, /after\(async \(\) =>/);
    assert.match(sync, /cacheSportsHeadshots\(/);
    assert.doesNotMatch(sync, /\.update\(\{[^}]*headshot_url/);
  }
  assert.match(migration, /add column if not exists headshot_url text/);
  assert.match(migration, /'sports-headshots'/);
});

test('Golf headshot caching is a separate non-critical backfill, never a Live render action', () => {
  const live = fs.readFileSync('components/golf/GolfLivePage.tsx', 'utf8');
  const script = fs.readFileSync('scripts/cache-golf-headshots.mjs', 'utf8');
  assert.doesNotMatch(live, /cache-golf-headshots|sharp|storage\.from/);
  assert.match(script, /const CONCURRENCY = 3/);
  assert.match(script, /cacheControl: "31536000"/);
  assert.match(script, /withoutEnlargement: true/);
  assert.match(script, /if \(!options\.force && isCachedHeadshot/);
  assert.match(script, /const storagePath = `espn\/\$\{golfer\.espn_player_id\}\.webp`/);
});

test('compact setup renders six choices, selected states and derived cap', () => {
  for (const count of [3, 4, 5, 6]) {
    const markup = renderToStaticMarkup(React.createElement(Setup, { gameType: 'standard', draftType: 'salary_cap', rosterPeriodType: 'full_tournament', rosterSize: count, onGameType() {}, onDraftType() {}, onRosterPeriodType() {} }));
    assert.equal((markup.match(/<button/g) || []).length, 6);
    assert.equal((markup.match(/aria-pressed="true"/g) || []).length, 3);
    assert.match(markup, new RegExp('\\$' + count * 25));
    assert.match(markup, /Split After R2/);
    assert.doesNotMatch(markup, /Build four|Fixed for the current/);
  }
});

test('builder uses frozen board limits, saves and reloads independent period rosters', async () => {
  const previousFetch = global.fetch;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    for (const count of [3, 4, 5, 6]) {
      const saved = new Map();
      const requests = [];
      global.fetch = async (url, options) => {
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body); requests.push(body);
          saved.set(body.period, { playerIds: body.playerIds, revision: 1, totalSalary: count * 25 });
          return { ok: true, json: async () => ({ success: true }) };
        }
        const period = new URL(url, 'http://test').searchParams.get('period') || 'opening';
        return { ok: true, json: async () => ({
          slate: { id: 1, name: 'Test' }, period: { key: period, state: 'open' },
          periods: ['opening', 'weekend'].map(key => ({ key, state: 'open' })),
          priceSet: { status: 'frozen' }, budget: count * 25, rosterSize: count,
          golfers: Array.from({ length: count + 2 }, (_, i) => ({ playerId: i + 1, name: `Player ${i + 1}`, effectiveSalary: 25, priced: true, eligible: true })),
          lineup: saved.get(period) || null,
        }) };
      };
      const props = { slates: [{ id: 1, label: 'Test' }], initialSlateId: 1 };
      let h = host(Builder); h.render(props, true); await flush();
      let tree = h.render(props);
      const rosterSlots = () => nodes(tree).filter(n => n.type === 'button' && n.props.className?.includes('min-h-16'));
      const golferAction = id => nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === `Add Player ${id}`);
      assert.equal(rosterSlots().length, count);
      for (let i = 0; i < count; i++) {
        const golfer = golferAction(i + 1);
        assert.equal(Boolean(golfer.props.disabled), false); golfer.props.onClick(); tree = h.render(props);
      }
      assert.match(renderToStaticMarkup(tree), /Remaining: <strong>\$0\.00<\/strong>/);
      rosterSlots()[0].props.onClick(); tree = h.render(props);
      assert.match(renderToStaticMarkup(tree), /Remaining: <strong>\$25\.00<\/strong>/);
      golferAction(1).props.onClick();
      tree = h.render(props);
      let save = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Save Lineup');
      assert.equal(Boolean(save.props.disabled), false); await save.props.onClick(); tree = h.render(props);
      assert.deepEqual(Object.keys(requests[0]).sort(), ['expectedRevision', 'period', 'playerIds', 'slateId']);
      assert.equal(requests[0].playerIds.length, count);
      h.unmount(); h = host(Builder); h.render(props, true); await flush(); tree = h.render(props);
      assert.match(renderToStaticMarkup(tree), /Player 1/);
      assert.equal(rosterSlots().filter(n => !n.props.disabled).length, count);
      const weekend = nodes(tree).find(n => n.props?.role === 'tab' && n.key === 'weekend');
      weekend.props.onClick(); await flush(); tree = h.render(props);
      assert.equal(rosterSlots().length, count);
      assert.equal(rosterSlots().filter(n => !n.props.disabled).length, 0);
      assert.match(renderToStaticMarkup(tree), new RegExp('Remaining: <strong>\\$' + count * 25 + '\\.00'));
      assert.equal(saved.get('opening').playerIds.length, count);
      const openingIds = [...saved.get('opening').playerIds];
      for (let i = 1; i <= count; i++) {
        golferAction(i + 1).props.onClick();
        tree = h.render(props);
      }
      await nodes(tree).find(n => n.type === 'button' && n.props.children === 'Save Lineup').props.onClick();
      tree = h.render(props);
      assert.deepEqual(saved.get('opening').playerIds, openingIds);
      assert.notDeepEqual(saved.get('weekend').playerIds, openingIds);
      assert.equal(saved.get('weekend').totalSalary, count * 25);
      h.unmount();
    }
  } finally { global.fetch = previousFetch; }
});

test('Live renders neutral, other-owner and current-user rows without reordering', () => {
  const rows = [
    { playerId: 1, name: 'Neutral', isDrafted: false, draftedBy: [] },
    { playerId: 2, name: 'Other', isDrafted: true, draftedBy: ['Team B'] },
    { playerId: 3, name: 'Mine', isDrafted: true, isCurrentUser: true, draftedBy: ['Team A'] },
  ].map((row, i) => ({ ...row, position: i + 1, statusState: 'playing', progressHoles: 7, currentRoundScoreDisplay: '-2', score: -5 }));
  const markup = renderToStaticMarkup(React.createElement(Leaderboard, { rows }));
  assert.match(markup, /Your golfer/); assert.match(markup, /Team B/); assert.match(markup, /thru 7/);
  assert.ok(markup.indexOf('Neutral') < markup.indexOf('Other') && markup.indexOf('Other') < markup.indexOf('Mine'));
});

test('Live renders the presentation tie rank supplied by the accepted-score ordering', () => {
  const rows = [
    { playerId: 1, name: 'Leader', position: 1, positionDisplay: '1' },
    { playerId: 2, name: 'Tied golfer', position: 2, positionDisplay: 'T2' },
  ].map((row) => ({
    ...row, shortName: row.name, espnGolfPlayerId: null, headshotUrl: null, country: null,
    owgrRank: null, score: -2, scoreDisplay: '-2', status: 'active', statusLabel: 'active',
    statusState: 'playing', teeTime: null, currentRound: 2, progressHoles: 7, lastHole: 7,
    holesCompleted: 25, currentRoundScore: -1, currentRoundScoreDisplay: '-1', isDrafted: false,
    draftedBy: [],
  }));
  const markup = renderToStaticMarkup(React.createElement(Leaderboard, { rows }));
  assert.match(markup, />T2<\/span>/);
});

test('Live inserts the canonical projected cut divider after every tied eligible golfer only while projected', () => {
  const cut = calculateGolfCutLine([
    { playerId: '1', score: -3, position: 1, holesCompleted: 18, status: 'round_complete' },
    { playerId: '2', score: -2, position: 2, holesCompleted: 18, status: 'round_complete' },
    { playerId: '3', score: -2, position: 3, holesCompleted: 18, status: 'round_complete' },
    { playerId: '4', score: -1, position: 4, holesCompleted: 18, status: 'round_complete' },
  ], 2);
  assert.deepEqual(cut.insidePlayerIds, [1, 2, 3]);
  const rows = [1, 2, 3, 4].map((playerId, index) => ({
    playerId, name: `Player ${playerId}`, shortName: `P${playerId}`, espnGolfPlayerId: null,
    headshotUrl: null, country: null, owgrRank: null, position: index + 1, score: -4 + index,
    scoreDisplay: null, status: 'round_complete', statusLabel: 'complete', statusState: 'round_complete',
    teeTime: null, currentRound: 2, progressHoles: 18, lastHole: 18, holesCompleted: 36,
    currentRoundScore: 0, currentRoundScoreDisplay: 'E', isDrafted: false, draftedBy: [],
    isProjectedCutEligible: cut.insidePlayerIds.includes(playerId),
  }));
  const projectedMarkup = renderToStaticMarkup(React.createElement(Leaderboard, { rows, projectedCut: cut }));
  assert.equal((projectedMarkup.match(/PROJECTED CUT: -2/g) || []).length, 1);
  assert.ok(projectedMarkup.indexOf('Player 3') < projectedMarkup.indexOf('PROJECTED CUT: -2'));
  assert.ok(projectedMarkup.indexOf('PROJECTED CUT: -2') < projectedMarkup.indexOf('Player 4'));
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Leaderboard, { rows, projectedCut: null })), /PROJECTED CUT/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Leaderboard, { rows, projectedCut: { ...cut, official: true } })), /PROJECTED CUT/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Leaderboard, { rows, projectedCut: cut, currentTournamentRound: 3 })), /PROJECTED CUT/);
  assert.match(fs.readFileSync('components/golf/GolfLivePage.tsx', 'utf8'), /projectedCut\.official \? "Cut line" : "Projected cut"/);
});

test('Live renders one divider from a serialized Round 2 home-summary response', () => {
  const summary = JSON.parse(JSON.stringify({
    liveTournamentRound: 2,
    projectedCut: {
      score: -2, display: '-2', inside: 78, tiedAtCut: 14, outside: 54,
      official: false, cutSize: 65, ruleLabel: 'Top 65 + ties', insidePlayerIds: [101, 102, 103],
    },
    tournamentLeaderboard: [
      { playerId: 101, name: 'Neal Shipley', position: 76, score: -2, isProjectedCutEligible: true },
      { playerId: 102, name: 'Tied Golfer', position: 77, score: -2, isProjectedCutEligible: true },
      { playerId: 103, name: 'Austin Duncan', position: 78, score: -2, isProjectedCutEligible: true },
      { playerId: 104, name: 'Christiaan Bezuidenhout', position: 79, score: -1, isProjectedCutEligible: false },
    ].map(row => ({
      ...row, shortName: row.name, espnGolfPlayerId: null, headshotUrl: null, country: null,
      owgrRank: null, scoreDisplay: null, status: 'round_complete', statusLabel: 'complete',
      statusState: 'round_complete', teeTime: null, currentRound: 2, progressHoles: 18,
      lastHole: 18, holesCompleted: 36, currentRoundScore: 0, currentRoundScoreDisplay: 'E',
      isDrafted: false, draftedBy: [],
    })),
  }));
  const markup = renderToStaticMarkup(React.createElement(Leaderboard, {
    rows: summary.tournamentLeaderboard,
    projectedCut: summary.projectedCut,
    currentTournamentRound: summary.liveTournamentRound,
  }));
  assert.equal((markup.match(/PROJECTED CUT: -2/g) || []).length, 1);
  assert.ok(markup.indexOf('Austin Duncan') < markup.indexOf('PROJECTED CUT: -2'));
  assert.ok(markup.indexOf('PROJECTED CUT: -2') < markup.indexOf('Christiaan Bezuidenhout'));
});

test('Scores uses compact Standard context and authoritative Best Ball hole contributors', () => {
  const scores = fs.readFileSync('components/lineups/GolfScoresDashboard.tsx', 'utf8');
  assert.match(scores, /StandardRoster/);
  assert.doesNotMatch(scores, /Total \{golfFantasyScore\(event\?\.official_score_to_par\)\}/);
  assert.match(scores, /contributorPlayerIds\.includes/);
  assert.match(scores, /bestBallRounds/);
  assert.doesNotMatch(scores, /Tour<br/);
  assert.doesNotMatch(scores, /Fantasy<\/small/);
  assert.match(scores, /golf-scores-standing-toggle/);
  assert.match(fs.readFileSync('app/globals.css', 'utf8'), /\.golf-scores-standing-toggle \{ grid-template-columns: 1\.4rem 1\.5rem minmax\(0, 1fr\) auto auto; \}/);
  assert.match(scores, /w-full min-w-\[840px\] border-collapse text-xs tabular-nums sm:min-w-\[620px\]/);
  assert.match(scores, /min-w-\[38px\].*sm:min-w-0/);
});

test('Golf Scores scope canonical participants to the active Group', () => {
  const fantasy = fs.readFileSync('lib/golf/fantasy.server.ts', 'utf8');
  const route = fs.readFileSync('app/api/golf/fantasy/route.ts', 'utf8');
  assert.match(fantasy, /teams!inner\(name, group_id, user_id\)/);
  assert.match(fantasy, /row\.teams\?\.group_id === scope\.groupId/);
  assert.match(fantasy, /activeUsers\.has\(String\(row\.teams\?\.user_id\)\)/);
  assert.match(route, /loadGolfFantasy\(slateId, \{ groupId: access\.context\.group\.id, viewerTeamId: access\.context\.team\?\.id \?\? null \}\)/);
});

test('Golf Lineup selects an upcoming slate and does not block roster loading on score reads', () => {
  const draftPage = fs.readFileSync('app/lineups/draft/page.tsx', 'utf8');
  const builder = fs.readFileSync('components/lineups/LineupBuilder.tsx', 'utf8');
  assert.match(draftPage, /const golfUpcomingSlate/);
  assert.match(draftPage, /golfUpcomingSlate\?\.id/);
  assert.match(builder, /const isGolfDraft/);
  assert.match(builder, /isGolfDraft \? \[\] : \[/);
  assert.match(builder, /optional Golf score state/);
});
