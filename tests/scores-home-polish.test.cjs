const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const { renderToStaticMarkup } = require('react-dom/server');
const { formatFantasySlateLabel, formatSlateDateLabel } = require('../lib/formatSlateLabel.ts');
const Home = require('../components/home/SportHomePage.tsx').default;
const Standings = require('../components/home/FantasyHomeStandings.tsx').default;
const Profile = require('../components/TeamProfileModal.tsx').default;
const Controls = require('../components/lineups/LineupControls.tsx').default;
const read = p => fs.readFileSync(p, 'utf8');
const slate = { id: 1, sport: 'nfl', date: '2026-09-09', start_date: '2026-09-09', end_date: '2026-09-14', display_name: '2026 Week 1', is_locked: true };
test('persisted NFL identity formats Week N without mutating provider windows or other sports', () => {
  const before = JSON.stringify(slate);
  assert.equal(formatFantasySlateLabel(slate), 'Week 1');
  assert.equal(JSON.stringify(slate), before);
  assert.equal(formatFantasySlateLabel({ ...slate, display_name: '2026 Week 12' }), 'Week 12');
  assert.equal(formatFantasySlateLabel({ ...slate, sport: 'nba' }), formatSlateDateLabel(slate));
  assert.equal(formatFantasySlateLabel({ ...slate, sport: 'golf', display_name: 'The Masters' }), 'The Masters');
  assert.equal(formatFantasySlateLabel({ ...slate, display_name: null }), formatSlateDateLabel(slate));
});
test('Scores heading/settings and Draft selectors consume normalized page labels', () => {
  const label = formatFantasySlateLabel(slate);
  for (const pathname of ['/lineups/scores', '/lineups/draft']) {
    context.pathname = pathname;
    const tree = host(Controls).render({ selectedSlateId: '1', selectedSlateIdNumber: 1, selectedSlate: slate,
      selectedSlateDisplay: label, slates: [{ ...slate, label }], seasons: ['2026'], selectedSeason: '2026' });
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Week 1/); assert.doesNotMatch(html, /2026 Week|September 9/);
    assert.ok(nodes(tree).some(n => n.type === 'option' && n.props.value === '2026'));
    assert.ok(nodes(tree).some(n => n.type === 'option' && n.props.value === 1));
  }
  context.pathname = '/lineups/scores';
  for (const page of ['scores', 'draft']) {
    const source = read(`app/lineups/${page}/page.tsx`);
    assert.match(source, /label: formatFantasySlateLabel\(\{ \.\.\.slate, sport, start_date: startDate, end_date: endDate \}\)/);
    assert.match(source, /start_date: startDate,\s*end_date: endDate/);
  }
  assert.match(read('app/api/home-summary/route.ts'), /display_name: latestSlate.display_name/);
});
test('NBA/NFL Home uses static current ranks/scores/counts, Scores navigation and existing refresh', async () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  global.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  try {
    for (const sport of ['nba', 'nfl']) {
      context.sport = sport;
      const rows = [{ team_id: 2, teamName: 'Mark', fantasy_points: 42.5, games_completed: 2, games_in_progress: 1, games_remaining: 3 }];
      global.fetch = async () => ({ ok: true, json: async () => ({ latestSlate: { ...slate, sport }, latestSlateRows: rows, funFacts: [], seasonSnapshot: [] }) });
      const h = host(Home().props.children.type);
      h.render({}, true);
      await new Promise(resolve => setImmediate(resolve));
      const tree = h.render({});
      const summary = nodes(tree).find(n => n.type === Standings);
      assert.ok(summary);
      const html = renderToStaticMarkup(Standings(summary.props));
      assert.match(html, /Mark/); assert.match(html, /42.5/); assert.match(html, /Rank 1/);
      assert.match(html, /2 final · 1 live · 3 left/);
      assert.doesNotMatch(html, /projection|Win|dialog/i);
      const standingTree = Standings(summary.props);
      const buttons = nodes(standingTree).filter(n => n.type === 'button');
      assert.equal(buttons.length, 2);
      for (const button of buttons) {
        assert.equal(button.props.type, 'button');
        assert.equal(button.props['aria-label'], 'View Mark profile');
        button.props.onClick();
        assert.deepEqual(nodes(h.render({})).find(n => n.type === Profile).props.team, { id: 2, name: 'Mark' });
      }
      for (const n of nodes(standingTree).filter(n => /fantasy-home-(row|rank|games|score)\b/.test(n.props?.className ?? ''))) {
        assert.equal(n.props.onClick, undefined);
        assert.notEqual(n.type, 'button');
        assert.equal(nodes(n).slice(1).some(child => child.type === 'button'), n.type === 'li');
      }
      nodes(h.render({})).find(n => n.type === Profile).props.setTeam(null);
      assert.equal(nodes(h.render({})).find(n => n.type === Profile).props.team, null);
      for (const changed of ['group', 'sport', 'switching']) {
        buttons[0].props.onClick();
        if (changed === 'group') context.group = 'group-b';
        if (changed === 'sport') context.sport = sport === 'nba' ? 'nfl' : 'nba';
        if (changed === 'switching') context.switching = true;
        assert.equal(nodes(h.render({}, true)).find(n => n.type === Profile).props.team, null);
        context.group = 'group-a'; context.sport = sport; context.switching = false;
        assert.equal(nodes(h.render({}, true)).find(n => n.type === Profile).props.team, null);
      }
      assert.ok(nodes(tree).some(n => n.props?.href === `/lineups/scores?sport=${sport}`));
      const slateText = nodes(tree).find(n => typeof n.props?.children === 'string' && n.props.children === (sport === 'nfl' ? 'Week 1' : formatSlateDateLabel(slate)));
      assert.ok(slateText);
      assert.ok(nodes(tree).some(n => n.props?.label === 'Refresh'));
      assert.ok(!nodes(tree).some(n => n.props?.onClick && /box score|lineup/i.test(n.props['aria-label'] ?? '')));
      h.unmount();
    }
  } finally { global.fetch = originalFetch; global.window = originalWindow; context.sport = 'nba'; }
});
test('Golf retains its separate modal and roster route; Home pull is limited to NBA/NFL', () => {
  const source = read('components/home/SportHomePage.tsx');
  assert.match(source, /slateRosterModal && isGolf/);
  assert.doesNotMatch(source, /slateRosterModal && !isGolf|home-projection-delta|Win %/);
  assert.match(source, /if \(!isGolf \|\| !slateRosterModal\)/);
  assert.match(source, /api\/team-slate-roster/);
  assert.match(source, /isGolf && <ReadOnlyPlayerModal/);
});

test('Home row has four explicit grid regions with shrinkable details and a separate right-aligned score', () => {
  const tree = Standings({ rows: [{ team_id: 1, teamName: 'A very long participant name', fantasy_points: 168.3,
    games_completed: 1, games_in_progress: 2, games_remaining: 3 }] });
  const row = nodes(tree).find(n => n.type === 'li');
  assert.match(row.props.className, /\bgrid grid-cols-\[1\.25rem_2rem_minmax\(0,1fr\)_auto\]/);
  const regions = row.props.children;
  assert.equal(regions.length, 4);
  for (const [index, name] of ['rank', 'avatar', 'details', 'score'].entries()) {
    assert.match(regions[index].props.className, new RegExp(`fantasy-home-${name}`));
  }
  assert.match(regions[1].props.className, /h-8 w-8/);
  assert.match(regions[2].props.className, /min-w-0/);
  const [name, games] = regions[2].props.children;
  assert.match(name.props.className, /block .*truncate/);
  assert.equal(name.props.title, 'A very long participant name');
  assert.match(games.props.className, /block/);
  assert.match(regions[3].props.className, /justify-self-end gap-1 whitespace-nowrap/);
  assert.equal(regions[3].props.children[1].type, 'small');
});

test('participant modal uses the supplied Group team ID and selected sport; API checks active Group ownership', async () => {
  const previousFetch = global.fetch, previousWindow = global.window, previousDocument = global.document;
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = { body: { style: { overflow: '' } } };
  try {
    for (const sport of ['nba', 'nfl']) {
      context.sport = sport;
      let request;
      global.fetch = async url => { request = url; return { ok: false, json: async () => ({ error: 'fixture' }) }; };
      const h = host(Profile);
      h.render({ team: { id: 82, name: 'Mark' }, setTeam() {} }, true);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(request, `/api/team-profile?teamId=82&season=all&sport=${sport}`);
      h.unmount();
    }
    const route = read('app/api/team-profile/route.ts');
    assert.match(route, /teamBelongsToGroup\(\s*teamId,\s*activeLeague.context.group.id/);
    assert.match(route, /groupId:\s*activeLeague.context.group.id/);
    assert.match(route, /leagueId:\s*activeLeague.league.id/);
  } finally { global.fetch = previousFetch; global.window = previousWindow; global.document = previousDocument; context.sport = 'nba'; }
});
