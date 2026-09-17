const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const React = require('react');
React.useCallback = (fn, deps) => React.useMemo(() => fn, deps);
context.capturePull = true;
const Builder = require('../components/lineups/GolfSalaryCapBuilder.tsx').default;
const { GolfFantasyRows, BestBallRoster, StandardRoster } = require('../components/lineups/GolfScoresDashboard.tsx');
const { golfHolePar } = require('../lib/golf/scorePresentation.ts');
const SalarySetup = require('../components/golf/GolfSalarySetup.tsx').default;
const { golfCompareWinners } = require('../components/lineups/GolfCompareModal.tsx');
const flush = () => new Promise(resolve => setImmediate(resolve));
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree?.props ? text(tree.props.children) : '';
test('Golf comparison winner selection preserves directions, ties, missing values, and zero', () => {
  assert.deepEqual([...golfCompareWinners([70.1, 69.5], true)], [1]);
  assert.deepEqual([...golfCompareWinners([75, 75, 60], false)], [0, 1]);
  assert.deepEqual([...golfCompareWinners([null, 0, null], false)], [1]);
  assert.deepEqual([...golfCompareWinners([null, null], false)], []);
  const source = require('node:fs').readFileSync('components/lineups/GolfCompareModal.tsx', 'utf8');
  assert.match(source, /showSalary \? <div/);
  assert.match(source, /golfCompareMetrics\.map/);
});
test('Golf Home and Scores omit the removed tabs and duplicate real-world leaderboard', () => {
  const fs = require('node:fs');
  const scores = fs.readFileSync('components/lineups/GolfScoresDashboard.tsx', 'utf8');
  const home = fs.readFileSync('components/home/SportHomePage.tsx', 'utf8');
  assert.doesNotMatch(scores, /role="tab"|Current Leader|Tournament Leaderboard/);
  assert.doesNotMatch(home, /golfHomeTab|GolfLiveLeaderboard|Full leaderboard →/);
  assert.match(home, /View Scores/);
  assert.match(scores, /previous\?\.scope === scope \? previous : null/);
});

test('Golf scorecard par presentation uses authoritative course metadata with the modal fallback', () => {
  assert.equal(golfHolePar({ par: 5, strokes: 3, relative_to_par: -2 }), 5);
  assert.equal(golfHolePar({ par: null, strokes: 3, relative_to_par: -1 }), 4);
  assert.equal(golfHolePar({ par: null, strokes: null, relative_to_par: null }), null);
  const modal = require('node:fs').readFileSync('components/lineups/GolfPlayerModal.tsx', 'utf8');
  const fantasy = require('node:fs').readFileSync('lib/golf/fantasy.server.ts', 'utf8');
  assert.match(modal, /golfHolePar\(/);
  assert.match(fantasy, /from\('golf_course_holes'\)/);
  assert.match(fantasy, /courseHoles: \[\.\.\.courseHoleByNumber\.values\(\)\]/);
});

test('independent team expansion survives score updates; collapse affects only one team', () => {
  const h = host(GolfFantasyRows);
  const board = { rules: { gameType: 'standard' }, events: [], teams: [1, 2].map(team_id => ({ team_id, name: `Team ${team_id}`, fantasy_points: -team_id, contributions: [{ playerId: team_id, period: 'opening', score: -1 }] })) };
  const props = { scope: 'group-a:1', board, onPlayer() {} };
  const rows = tree => nodes(tree).filter(n => n.props?.className?.includes('scores-standing-toggle'));
  let tree = h.render(props); rows(tree)[0].props.onClick(); tree = h.render(props);
  rows(tree)[1].props.onClick(); tree = h.render({ ...props, board: { ...board } });
  assert.deepEqual(rows(tree).map(n => n.props['aria-expanded']), [true, true]);
  assert.doesNotMatch(text(tree), /Fantasy/);
  rows(tree)[0].props.onClick(); tree = h.render(props);
  assert.deepEqual(rows(tree).map(n => n.props['aria-expanded']), [false, true]);
  assert.deepEqual(rows(h.render({ ...props, scope: 'group-b:2' })).map(n => n.props['aria-expanded']), [false, false]);
});

test('Golf Scores shows a compact hidden-period state without roster identities', () => {
  const h = host(GolfFantasyRows);
  const board = { rules: { gameType: 'standard', rosterPeriods: { type: 'split_after_round_2' } }, events: [], teams: [{ team_id: 2, name: 'Other Team', fantasy_points: null, contributions: [], hiddenRosterPeriods: ['weekend'] }] };
  const props = { scope: 'group-a:1', board, onPlayer() {} };
  let tree = h.render(props);
  nodes(tree).find(n => n.props?.className?.includes('golf-scores-standing-toggle')).props.onClick();
  tree = h.render(props);
  assert.doesNotMatch(text(tree), /Lineup hidden until lock/);
  assert.doesNotMatch(text(tree), /Golfer \d+/);
  assert.match(require('node:fs').readFileSync('components/lineups/GolfScoresDashboard.tsx', 'utf8'), /Weekend lineup hidden until lock/);
  h.unmount();
});

function bestBallBoard({ future = false } = {}) {
  const players = Array.from({ length: 16 }, (_, index) => {
    const id = index + 1;
    const opening = id <= 4 || (id >= 9 && id <= 12);
    return { player_id: id, golf_players: { display_name: `${opening ? 'Opening' : 'Weekend'} Golfer ${id}`, espn_player_id: id === 2 ? null : String(1000 + id),
      headshot_url: id === 1 ? 'https://example.test/opening-headshot.png' : null }, golf_rounds: [1, 2, 3, 4].map(round_number => ({
      round_number, score_to_par: round_number - 3, golf_holes: [{ hole_number: 1, relative_to_par: round_number - 3 }],
    })) };
  });
  const team = (team_id, opening, weekend) => ({ team_id, name: `Team ${team_id}`, fantasy_points: -6, finish_position: team_id, contributions: [
    ...opening.map(playerId => ({ playerId, period: 'opening', score: -1 })),
    ...weekend.map(playerId => ({ playerId, period: 'weekend', score: -1 })),
  ], bestBallRounds: [1, 2, 3, 4].map(roundNumber => ({ roundNumber, period: roundNumber <= 2 ? 'opening' : 'weekend', holes: [{
    holeNumber: 1, relativeToPar: roundNumber - 3, contributorPlayerIds: [roundNumber <= 2 ? opening[0] : weekend[0]],
    status: future && roundNumber >= 3 ? 'unscored' : 'final',
  }] })) });
  return { rules: { gameType: 'best_ball', rosterPeriods: { type: 'split_after_round_2' } }, events: players,
    teams: [team(1, [1, 2, 3, 4], [5, 6, 7, 8]), team(2, [9, 10, 11, 12], [13, 14, 15, 16])] };
}

test('Best Ball Scores selects one shared round, keeps overall standings, and resolves opening/weekend rosters by round', () => {
  const h = host(GolfFantasyRows), board = bestBallBoard(), selected = [];
  const props = { scope: 'group-a:best-ball', board, onPlayer: player => selected.push(player) };
  const standingRows = tree => nodes(tree).filter(node => node.props?.className?.includes('golf-scores-standing-toggle'));
  let tree = h.render(props);
  assert.match(text(tree), /Team 1.*-6/); // standings remain the overall tournament total
  standingRows(tree)[0].props.onClick(); tree = h.render(props);
  standingRows(tree)[1].props.onClick(); tree = h.render(props);
  let markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.equal((markup.match(/aria-label="Round 4 Best Ball scorecard"/g) ?? []).length, 2);
  nodes(tree).find(node => node.props?.['aria-label'] === 'Select round 1').props.onClick(); tree = h.render(props);
  markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.match(markup, /Opening Golfer 1/); assert.doesNotMatch(markup, /Weekend Golfer 5/);
  assert.match(markup, /opening-headshot\.png/); assert.match(markup, />OG</); // shared initials fallback, never a broken image
  nodes(tree).find(node => node.props?.['aria-label'] === 'Select round 3').props.onClick(); tree = h.render(props);
  markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.equal((markup.match(/aria-label="Round 3 Best Ball scorecard"/g) ?? []).length, 2);
  assert.match(markup, /Weekend Golfer 5/); assert.doesNotMatch(markup, /Opening Golfer 1/);
  assert.match(markup, /BEST BALL/); assert.match(markup, /R3/);
  const detail = host(BestBallRoster); tree = detail.render({ board, team: board.teams[0], selectedRound: 3, onPlayer: player => selected.push(player) });
  nodes(tree).find(node => node.props?.['aria-label'] === 'View Weekend Golfer 5 details').props.onClick();
  assert.equal(selected[0].id, 5);
  detail.unmount();
  h.unmount();
});

test('Best Ball future rounds render one selected not-started scorecard', () => {
  const h = host(GolfFantasyRows), board = bestBallBoard({ future: true });
  const props = { scope: 'group-a:future-best-ball', board, onPlayer() {} };
  let tree = h.render(props);
  nodes(tree).filter(node => node.props?.className?.includes('golf-scores-standing-toggle'))[0].props.onClick(); tree = h.render(props);
  nodes(tree).filter(node => node.props?.className?.includes('golf-scores-standing-toggle'))[1].props.onClick();
  tree = h.render(props);
  nodes(tree).find(node => node.props?.['aria-label'] === 'Select round 4').props.onClick(); tree = h.render(props);
  const markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.equal((markup.match(/aria-label="Round 4 Best Ball scorecard"/g) ?? []).length, 2);
  assert.match(markup, /Round 4 has not started/);
  assert.doesNotMatch(markup, /Round 1 Best Ball scorecard|Round 2 Best Ball scorecard|Round 3 Best Ball scorecard/);
  h.unmount();
});

test('Best Ball team avatars and hole replay links reuse existing identity and focus state', () => {
  const h = host(GolfFantasyRows), board = bestBallBoard();
  board.courseHoles = [{ holeNumber: 10, par: 4 }, { holeNumber: 11, par: 3 }, { holeNumber: 12, par: 5 }];
  board.events[0].golf_rounds.find(round => round.round_number === 1).golf_holes = [
    { hole_number: 10, relative_to_par: -1 },
    { hole_number: 11, relative_to_par: 1 },
    { hole_number: 12, relative_to_par: 0 },
  ];
  board.teams.forEach(team => {
    const round = team.bestBallRounds.find(candidate => candidate.roundNumber === 1);
    round.holes = Array.from({ length: 18 }, (_, index) => {
      const holeNumber = index + 1;
      const relativeToPar = holeNumber === 10 ? -1 : holeNumber === 11 ? 1 : holeNumber === 12 ? 0 : null;
      return { holeNumber, relativeToPar,
        contributorPlayerIds: holeNumber === 10 ? [team.contributions[0].playerId] : [],
        status: [10, 11, 12].includes(holeNumber) ? 'final' : holeNumber === 14 ? 'provisional' : 'unscored' };
    });
  });
  const opened = [];
  const props = { scope: 'group-a:avatar-and-hole', board, onPlayer() {}, onHole: (player, focus) => opened.push({ player, focus }),
    teamAvatarById: new Map([[1, 'https://example.test/team-one.png']]) };
  let tree = h.render(props);
  let markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.match(markup, /team-one\.png/); assert.match(markup, />T</); // Team 2 uses TeamAvatar's initials fallback.
  const detail = host(BestBallRoster); tree = detail.render({ board, team: board.teams[0], selectedRound: 1, onPlayer() {}, onHole: props.onHole });
  markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.match(markup, /<div>10<\/div><div class="text-\[9px\] font-bold text-slate-500">4<\/div>/);
  assert.match(markup, /<div>17<\/div><div class="text-\[9px\] font-bold text-slate-500">—<\/div>/);
  const holeButtons = nodes(tree).filter(node => String(node.props?.['aria-label'] ?? '').startsWith('View Opening Golfer 1, Round 1, Hole '));
  assert.equal(holeButtons.length, 18);
  const holeButton = holeNumber => holeButtons.find(node => node.props?.['aria-label'].startsWith(`View Opening Golfer 1, Round 1, Hole ${holeNumber} —`));
  assert.match(holeButton(10).props['aria-label'], /1 under par/);
  assert.match(holeButton(14).props['aria-label'], /score pending/);
  assert.match(holeButton(17).props['aria-label'], /not started/);
  assert.match(holeButton(17).props.className, /cursor-pointer/);
  assert.match(holeButton(10).props.className, /min-w-\[38px\].*sm:min-w-0/);
  assert.match(holeButton(10).props.className, /bg-emerald-100 text-emerald-900/);
  assert.match(holeButton(11).props.className, /bg-red-100 text-red-900/);
  assert.match(holeButton(12).props.className, /bg-white text-slate-700/);
  assert.match(holeButton(17).props.className, /bg-slate-50 text-slate-400/);
  assert.match(holeButton(10).props['aria-label'], /Best Ball contributor/);
  assert.doesNotMatch(holeButton(10).props.className, /outline-sky|outline-offset-\[-2px\]|ring-inset|sky|cyan/);
  assert.doesNotMatch(holeButton(10).props.className, /bg-emerald-500\/20/);
  holeButton(10).props.onClick(); holeButton(14).props.onClick(); holeButton(17).props.onClick();
  assert.deepEqual(opened[0], { player: { id: 1, name: 'Opening Golfer 1', position_group: 'GOLFER', is_active: true,
    espn_player_id: '1001', headshot_url: 'https://example.test/opening-headshot.png', country: undefined, owgr_rank: undefined }, focus: { roundNumber: 1, holeNumber: 10 } });
  assert.deepEqual(opened.slice(1).map(entry => entry.focus), [{ roundNumber: 1, holeNumber: 14 }, { roundNumber: 1, holeNumber: 17 }]);
  const modal = require('node:fs').readFileSync('components/lineups/GolfPlayerModal.tsx', 'utf8');
  assert.match(modal, /focus \? \[focus\.roundNumber\]/); assert.match(modal, /initialHoleNumber=\{focus\?\.roundNumber === round\.round_number \? focus\.holeNumber : null\}/);
  assert.match(modal, /<GolfHoleReplayPanel/);
  detail.unmount();
  h.unmount();
});

test('Golf Scores uses Tournaments while non-Golf Scores retains Slates', () => {
  const builder = require('node:fs').readFileSync('components/lineups/LineupBuilder.tsx', 'utf8');
  assert.match(builder, /\? "Tournaments" : "Slates"/);
  assert.match(builder, /setIsGolfSlateMenuOpen\(true\)/);
});

test('Golf Scores team rows omit implementation-status and roster-count detail', () => {
  const h = host(GolfFantasyRows);
  const board = bestBallBoard();
  board.teams[0].provisional = true;
  const tree = h.render({ scope: 'group-a:live-scoring', board, onPlayer() {} });
  assert.doesNotMatch(text(tree), /Live scoring|golfer selections|Provisional/);
  const styles = require('node:fs').readFileSync('app/globals.css', 'utf8');
  assert.match(styles, /\.golf-scores-standing-toggle \.scores-standing-chevron \{ grid-column: 4; grid-row: 1; \}/);
  h.unmount();
});

test('Standard Golf uses the selected round scorecard and all-hole modal navigation without Best Ball rows', () => {
  const h = host(GolfFantasyRows), opened = [];
  const board = { rules: { gameType: 'standard', rosterPeriods: { type: 'full_tournament' } }, courseHoles: [{ holeNumber: 14, par: 4 }, { holeNumber: 17, par: 5 }], teams: [{ team_id: 1, name: 'Standard Team', fantasy_points: -6, finish_position: 1, contributions: [{ playerId: 1, period: 'full_tournament', score: -6 }] }], events: [{ player_id: 1, golf_players: { display_name: 'Scottie', espn_player_id: '1' }, golf_rounds: [{ round_number: 1, holes_completed: 18, strokes: 70, score_to_par: -2, golf_holes: [{ hole_number: 14, relative_to_par: -1 }] }, { round_number: 4, holes_completed: 18, strokes: 68, score_to_par: -4, golf_holes: [{ hole_number: 14, relative_to_par: 1 }] }] }] };
  const props = { scope: 'group-a:standard', board, onPlayer() {}, onHole: (player, focus) => opened.push({ player, focus }) };
  let tree = h.render(props); nodes(tree).find(node => node.props?.className?.includes('golf-scores-standing-toggle')).props.onClick(); tree = h.render(props);
  const detail = host(StandardRoster); tree = detail.render({ board, team: board.teams[0], selectedRound: 4, onPlayer() {}, onHole: props.onHole });
  let markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.match(markup, /Round 4 Golf scorecard/); assert.doesNotMatch(text(tree), /BEST BALL/);
  assert.match(markup, /bg-red-100 text-red-900/);
  assert.match(markup, /<div>14<\/div><div class="text-\[9px\] font-bold text-slate-500">4<\/div>/);
  assert.match(markup, /<div>17<\/div><div class="text-\[9px\] font-bold text-slate-500">5<\/div>/);
  const r4Future = nodes(tree).find(node => node.props?.['aria-label'] === 'View Scottie, Round 4, Hole 17 — not started');
  assert.match(r4Future.props.className, /min-w-\[38px\].*sm:min-w-0/);
  assert.ok(r4Future); r4Future.props.onClick(); assert.deepEqual(opened[0].focus, { roundNumber: 4, holeNumber: 17 });
  tree = detail.render({ board, team: board.teams[0], selectedRound: 1, onPlayer() {}, onHole: props.onHole });
  markup = require('react-dom/server').renderToStaticMarkup(tree);
  assert.match(markup, /bg-emerald-100 text-emerald-900/);
  const r1Completed = nodes(tree).find(node => node.props?.['aria-label'] === 'View Scottie, Round 1, Hole 14 — 1 under par');
  assert.ok(r1Completed); r1Completed.props.onClick(); assert.deepEqual(opened[1].focus, { roundNumber: 1, holeNumber: 14 });
  assert.equal(nodes(tree).filter(node => String(node.props?.['aria-label'] ?? '').startsWith('View Scottie, Round 1, Hole ')).length, 18);
  detail.unmount(); h.unmount();
});

test('Golf modal progress uses the accepted round count and preserves the course-hole position', () => {
  const modal = require('node:fs').readFileSync('components/lineups/GolfPlayerModal.tsx', 'utf8');
  assert.match(modal, /Math\.max\(round\.holes_completed, acceptedHoles\)/);
  assert.match(modal, /Last hole \$\{stat\?\.last_hole\}/);
  assert.match(modal, /Round \$\{round\.round_number\} · Thru \$\{holesCompleted\}/);
});

test('Golf refresh requests fresh completed ShotCast evidence and Scores reloads accepted revisions', () => {
  const refresh = require('node:fs').readFileSync('app/api/refresh-stats-golf/route.ts', 'utf8');
  const scores = require('node:fs').readFileSync('components/lineups/GolfScoresDashboard.tsx', 'utf8');
  const provider = require('node:fs').readFileSync('lib/providers/pgaTourShots.ts', 'utf8');
  assert.match(refresh, /cacheBust: observedAt/);
  assert.match(provider, /roundNumber: number; cacheBust\?: string \| null/);
  assert.match(scores, /window\.addEventListener\("golf-accepted-change", reloadAcceptedBoard\)/);
});

test('pull refresh preserves unsaved period selections, flags invalidity and retains revision conflict', async () => {
  const oldFetch = global.fetch;
  let revision = 1, eligible = true, requests = 0;
  global.fetch = async () => { requests++; return { ok: true, json: async () => ({ slate: { id: 1 },
    period: { key: 'weekend', state: 'open' }, periods: [{ key: 'weekend', state: 'open' }], priceSet: { status: 'frozen' },
    budget: 75, rosterSize: 3, lineup: { playerIds: [1], revision },
    golfers: [1, 2, 3].map(playerId => ({ playerId, name: `Golfer ${playerId}`, eligible: playerId !== 2 || eligible, priced: true, effectiveSalary: 25 })) }) }; };
  try {
    const h = host(Builder), props = { initialSlateId: 1, slates: [{ id: 1, label: 'Test' }] };
    h.render(props, true); await flush(); let tree = h.render(props);
    nodes(tree).find(n => n.props?.['aria-label'] === 'Add Golfer 2').props.onClick(); tree = h.render(props);
    const refresh = context.pullOptions.onRefresh;
    const first = refresh(), second = refresh();
    assert.equal((await second).status, 'skipped'); await first;
    tree = h.render(props);
    assert.equal(requests, 2);
    assert.match(text(tree), /Unsaved/);
    assert.match(context.pullOptions.scopeKey, /weekend/);
    eligible = false; revision = 2;
    await context.pullOptions.onRefresh(); tree = h.render(props);
    assert.match(text(tree), /Your selections have been retained/);
    assert.match(text(tree), /saved lineup changed elsewhere/);
    await context.pullOptions.onRefresh(); tree = h.render(props);
    assert.match(text(tree), /saved lineup changed elsewhere/);
    assert.equal(nodes(tree).find(n => n.props?.children === 'Save Lineup').props.disabled, true);
    h.unmount();
  } finally { global.fetch = oldFetch; }
});

test('Salary Cap golfer search filters names without changing selections or feasibility state', async () => {
  const oldFetch = global.fetch;
  const golfers = [
    { playerId: 1, name: 'Jackson Koivun', eligible: true, priced: true, effectiveSalary: '39.00', isAmateur: false },
    { playerId: 2, name: 'Michael Thompson', eligible: true, priced: true, effectiveSalary: '15.00', isAmateur: false },
    { playerId: 3, name: 'Blocked Golfer', eligible: false, priced: true, effectiveSalary: '15.00', isAmateur: false },
  ];
  global.fetch = async () => ({ ok: true, json: async () => ({ slate: { id: 1 }, period: { key: 'full_tournament', state: 'open' },
    periods: [{ key: 'full_tournament', state: 'open' }], priceSet: { status: 'frozen' }, budget: '100.00', rosterSize: 2,
    golfers, lineup: null }) });
  try {
    const h = host(Builder), props = { initialSlateId: 1, slates: [{ id: 1, label: 'Test' }] };
    h.render(props, true); await flush(); let tree = h.render(props);
    const golferButton = id => nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === `Add ${golfers.find(golfer => golfer.playerId === id)?.name}`);
    golferButton(1).props.onClick(); tree = h.render(props);
    const search = nodes(tree).find(node => node.props?.['aria-label'] === 'Search golfers');
    assert.equal(search.props.placeholder, 'Search golfers...');
    search.props.onChange({ target: { value: 'THOMP' } }); tree = h.render(props);
    assert.match(text(tree), /Michael Thompson/);
    assert.match(text(tree), /Jackson Koivun/); // Selected card remains visible outside the filtered list.
    assert.equal(golferButton(1), undefined);
    const blocked = golferButton(3);
    assert.equal(blocked, undefined);
    search.props.onChange({ target: { value: '' } }); tree = h.render(props);
    assert.match(text(tree), /Blocked Golfer/);
    assert.equal(golferButton(3).props.disabled, true);
    h.unmount();
  } finally { global.fetch = oldFetch; }
});

test('Salary Cap uses the shared Golf detail modal without selecting a golfer', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ slate: { id: 1, name: 'Test' }, period: { key: 'full_tournament', state: 'open' },
    periods: [{ key: 'full_tournament', state: 'open' }], priceSet: { status: 'frozen' }, budget: '100.00', rosterSize: 1, lineup: null,
    golfers: [
      { playerId: 1, name: 'Headshot Golfer', espnPlayerId: '123', headshotUrl: 'https://example.test/headshot.png', eligible: true, priced: true, effectiveSalary: '20.00', suggestedSalary: '18.00', valueBasis: 'blended' },
      { playerId: 2, name: 'Fallback Golfer', espnPlayerId: null, headshotUrl: null, eligible: false, priced: false, effectiveSalary: null, suggestedSalary: null, valueBasis: 'unsupported' },
    ],
  }) });
  try {
    const h = host(Builder), props = { initialSlateId: 1, slates: [{ id: 1, label: 'Test' }] };
    h.render(props, true); await flush(); let tree = h.render(props);
    const markup = require('react-dom/server').renderToStaticMarkup(tree);
    assert.match(markup, /headshot\.png/);
    assert.match(markup, />FG</); // PlayerHeadshot initials are the no-image fallback.
    nodes(tree).find(node => node.type === 'button' && node.props.className?.includes('min-w-0 text-left')).props.onClick(); tree = h.render(props);
    let detailMarkup = require('react-dom/server').renderToStaticMarkup(tree);
    assert.match(detailMarkup, /role="dialog"/);
    assert.match(detailMarkup, /Player Profile/);
    assert.match(detailMarkup, /Season Stats/);
    assert.doesNotMatch(detailMarkup, /Tournament scorecard/);
    assert.match(detailMarkup, /Salary \$20\.00/);
    const profileSource = require('node:fs').readFileSync('components/lineups/PlayerResearchModal.tsx', 'utf8');
    assert.doesNotMatch(profileSource, /Salary Cap Value|onCompareGolfers/);
    nodes(tree).find(node => node.props?.['aria-label'] === 'View Headshot Golfer').props.onClick(); tree = h.render(props);
    assert.match(require('react-dom/server').renderToStaticMarkup(tree), /Headshot Golfer profile/);
    nodes(tree).find(node => node.props?.['aria-label'] === 'Add Headshot Golfer').props.onClick(); tree = h.render(props);
    assert.match(text(tree), /Remaining:\s+\$80\.00/);
    nodes(tree).find(node => node.props?.['aria-label'] === 'View Fallback Golfer').props.onClick(); tree = h.render(props);
    detailMarkup = require('react-dom/server').renderToStaticMarkup(tree);
    assert.doesNotMatch(detailMarkup, /Salary Cap Value/);
    assert.doesNotMatch(detailMarkup, /\$null|\$undefined/);
    h.unmount();
  } finally { global.fetch = oldFetch; }
});

test('salary setup reviews editable fallback salaries and requires acknowledgement before freeze', async () => {
  const oldFetch = global.fetch;
  let priceSet = null;
  const actions = [];
  const prices = [{ player_id: 1, suggested_salary: 42, override_salary: null, effective_salary: null, value_basis: 'owgr', golf_players: { display_name: 'Supported' } },
    { player_id: 2, suggested_salary: '15.00', override_salary: null, effective_salary: '15.00', value_basis: 'fallback', golf_players: { display_name: 'Fallback' } },
    { player_id: 3, suggested_salary: '15.00', override_salary: null, effective_salary: null, value_basis: 'v1_only', golf_players: { display_name: 'Model Fifteen' } }];
  global.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body); actions.push(body);
      if (body.action === 'generate') priceSet = { status: 'generated', revision: 0 };
      if (body.action === 'override') { prices[0].override_salary = body.overrides[0].salary; priceSet.revision++; }
      if (body.action === 'freeze') { priceSet.status = 'frozen'; prices[0].effective_salary = prices[0].override_salary; }
    }
    return { ok: true, json: async () => ({ priceSet, prices }) };
  };
  try {
    const h = host(SalarySetup), props = { slateId: 1 };
    h.render(props, true); await flush(); let tree = h.render(props);
    const button = label => nodes(tree).find(n => n.type === 'button' && n.props.children === label);
    await button('Generate Salaries').props.onClick(); tree = h.render(props);
    assert.match(text(tree), /REVIEW NEEDED/);
    nodes(tree).find(n => n.type === 'input' && n.props.type === 'number').props.onChange({ target: { value: '40' } }); tree = h.render(props);
    assert.equal(button('Freeze Salaries').props.disabled, true);
    await button('Save Overrides').props.onClick(); tree = h.render(props);
    assert.equal(prices[0].suggested_salary, 42);
    assert.match(text(tree), /received the \$15\.00 fallback salary/);
    assert.match(text(tree), /I reviewed the fallback salaries/);
    assert.match(text(tree), /Fallback — review/);
    const rows = nodes(tree).filter(n => n.type === 'tr');
    assert.match(rows.find(row => text(row).includes('Fallback')).props.className, /bg-amber-950\/20/);
    assert.doesNotMatch(rows.find(row => text(row).includes('Model Fifteen')).props.className, /amber/);
    const salaryInputs = nodes(tree).filter(n => n.type === 'input' && n.props.type === 'number');
    assert.equal(salaryInputs.length, 3);
    nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); tree = h.render(props);
    assert.equal(button('Freeze Salaries').props.disabled, false);
    await button('Freeze Salaries').props.onClick(); tree = h.render(props);
    assert.match(text(tree), /FROZEN/); assert.match(text(tree), /Go to Lineup/);
    assert.equal(nodes(tree).filter(n => n.type === 'input').length, 0);
    assert.deepEqual(actions.map(a => a.action), ['generate', 'override', 'freeze']);
    h.unmount();
  } finally { global.fetch = oldFetch; }
});

test('salary setup exposes regeneration only for a generated board', async () => {
  const oldFetch = global.fetch;
  let priceSet = { status: 'generated', revision: 3 };
  const actions = [];
  global.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body);
      actions.push(body.action);
      if (body.action === 'regenerate') priceSet = { status: 'generated', revision: 0 };
    }
    return { ok: true, json: async () => ({ priceSet, prices: [] }) };
  };
  const oldWindow = global.window;
  global.window = { ...(oldWindow ?? {}), confirm: () => true };
  try {
    const h = host(SalarySetup);
    h.render({ slateId: 1 }, true); await flush(); let tree = h.render({ slateId: 1 });
    const button = nodes(tree).find(n => n.type === 'button' && n.props.children === 'Regenerate Salaries');
    await button.props.onClick(); tree = h.render({ slateId: 1 });
    assert.deepEqual(actions, ['regenerate']);
    assert.match(text(tree), /GENERATED/);
    h.unmount();
  } finally {
    global.fetch = oldFetch;
    global.window = oldWindow;
  }
});
