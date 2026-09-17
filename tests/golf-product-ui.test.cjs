/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const { host, nodes } = require('./helpers/scores-harness.cjs');
const React = require('react');
React.useCallback = (fn, deps) => React.useMemo(() => fn, deps);
const { renderToStaticMarkup } = require('react-dom/server');
const Setup = require('../components/golf/GolfGameSetup.tsx').default;
const Builder = require('../components/lineups/GolfSalaryCapBuilder.tsx').default;
const Leaderboard = require('../components/golf/GolfLiveLeaderboard.tsx').default;
const { getGroupSwitchDestination } = require('../lib/groups/navigation.ts');

test('Golf derives the canonical mobile nav for both Golf and shared profile routes', () => {
  const source = fs.readFileSync('components/AppNav.tsx', 'utf8');
  const ast = ts.createSourceFile('AppNav.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const visit = node => { if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(ast), node.initializer); ts.forEachChild(node, visit); };
  visit(ast);
  const main = Function(`return (${declarations.get('mainLinks').getText(ast)})`)();
  const getLinks = Function('isNbaSkins', 'isNcaaPickEm', 'activeSport', 'mainLinks', `return (${declarations.get('displayedMainLinks').getText(ast)})`);
  const getSharedRouteSport = Function('sportParam', `return (${declarations.get('sharedRouteSport').getText(ast)})`);
  const getRouteSport = Function('pathname', 'sharedRouteSport', `return (${declarations.get('routeSport').getText(ast)})`);
  const getActiveSport = Function('routeSport', 'selectedSport', `return (${declarations.get('activeSport').getText(ast)})`);
  const getMoreLinks = Function('activeSport', `return (${declarations.get('mobileMoreLinks').getText(ast)})`);
  const getMoreIsActive = Function('pathname', `return (${declarations.get('moreIsActive').getText(ast)})`);
  const golf = getLinks(false, false, 'golf', main);
  const profileRouteSport = getRouteSport('/profile', getSharedRouteSport('golf'));
  const profileActiveSport = getActiveSport(profileRouteSport, 'nba');
  assert.equal(profileActiveSport, 'golf');
  assert.deepEqual(golf.map(x => x.label), ['Home', 'Lineup', 'Scores', 'Live']);
  assert.deepEqual(getLinks(false, false, profileActiveSport, main).map(x => x.label), ['Home', 'Lineup', 'Scores', 'Live']);
  assert.equal(golf[2].href, '/lineups/scores');
  assert.equal(golf[3].href, '/golf/live');
  assert.deepEqual(getMoreLinks('golf').map(x => x.label), ['Standings', 'Player History']);
  assert.equal(getMoreIsActive('/standings'), true);
  assert.equal(getMoreIsActive('/player-history'), true);
  assert.equal(getMoreIsActive('/profile'), false);
  assert.deepEqual(getLinks(false, false, 'nba', main).map(x => x.label), ['Home', 'Draft', 'Scores']);
  assert.deepEqual(getLinks(false, false, 'nfl', main).map(x => x.label), ['Home', 'Draft', 'Scores', 'Live']);
  assert.deepEqual(getLinks(false, true, 'ncaa', main).map(x => x.href), ['/ncaa-pickem', '/ncaa-pickem/scores', '/ncaa-pickem/standings']);
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

test('Scores uses compact Standard context and authoritative Best Ball hole contributors', () => {
  const scores = fs.readFileSync('components/lineups/GolfScoresDashboard.tsx', 'utf8');
  assert.match(scores, /Total \{golfFantasyScore\(event\?\.official_score_to_par\)\}/);
  assert.match(scores, /contributorPlayerIds\.includes/);
  assert.match(scores, /bestBallRounds/);
  assert.doesNotMatch(scores, /Tour<br/);
  assert.doesNotMatch(scores, /Fantasy<\/small/);
  assert.match(scores, /golf-scores-standing-toggle/);
  assert.match(fs.readFileSync('app/globals.css', 'utf8'), /\.golf-scores-standing-toggle \{ grid-template-columns: 1\.4rem 1\.5rem minmax\(0, 1fr\) auto; \}/);
  assert.match(scores, /grid-cols-\[3\.7rem_2\.6rem_4\.5rem\]/);
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
