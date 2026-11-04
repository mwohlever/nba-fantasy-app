/* eslint-disable @typescript-eslint/no-require-imports */
// Fixtures and component callbacks only. Never opens a browser or writes user data.
const assert = require('node:assert/strict'), test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
require('react').useId = () => 'summary-cleanup';
const Profile = require('../components/player-center/PlayerCenter.tsx').default;
const { WindowControl } = require('../components/player-center/PlayerCenter.tsx');
const Adapter = require('../components/player-center/PlayerModalAdapter.tsx').default;
const Browser = require('../components/player-center/ResearchBrowser.tsx').default;
const Coverage = require('../components/player-center/CoverageNotice.tsx').default;
const { presentProfile } = require('../lib/player-center/presentation.ts');
const { compareHistories } = require('../lib/player-center/comparison.ts');
const { lastFiveFantasySummary, fantasyTrend } = require('../lib/player-center/fantasyTrend.ts');
const capture = require('../data/player-center-preview/captured.json');
const text = t => Array.isArray(t) ? t.map(text).join(' ') : t && typeof t === 'object' ? t.props?.['aria-hidden'] ? '' : text(t.props?.children) : typeof t === 'string' || typeof t === 'number' ? String(t) : '';
const find = (t, type) => nodes(t).find(n => n.type === type);
const tick = () => new Promise(resolve => setImmediate(resolve));
const scoring = sport => ({ sport, settings: null, basis: 'legacy_defaults' });
function profile(sport, scores) {
  const h = structuredClone(capture.histories.find(h => h.player.sport === sport && h.player.position === (sport === 'nba' ? 'F/C' : 'QB')));
  const game = h.games.find(g => g.status === 'final' && g.participation === 'played');
  h.games = scores.map((_, i) => ({ ...structuredClone(game), eventId: String(1000 + i), gameAt: new Date(Date.parse(capture.capturedAt) - (scores.length - i) * 86400000).toISOString(), issues: [] }));
  h.coverage = { kind: 'appearance_log', expectedGames: scores.length, fetchedAt: capture.capturedAt, freshness: 'fresh', issues: [] };
  const p = presentProfile(h, scoring(sport), capture.capturedAt);
  p.gameFantasyPoints = Object.fromEntries(p.games.map((g, i) => [g.eventId, scores[i]]));
  return p;
}

for (const sport of ['nba', 'nfl']) {
  test(`${sport}: Last 5 actual-score summary handles short, zero, negative, incomplete and nonfinite samples`, () => {
    for (const [scores, average, count, unavailable] of [
      [[], null, 0, 0], [[0], 0, 1, 0], [[-4, 0, 10], 2, 3, 0],
      [[1, 2, 3, 4, 5], 3, 5, 0], [[100, 1, 2, 3, 4, 5], 3, 5, 0],
      [[100, 1, null, 3, 4, 5], 22.6, 5, 1], [[null, null], null, 0, 2],
      [[1, NaN, Infinity, null], 1, 1, 3],
    ]) {
      const p = profile(sport, scores), before = structuredClone(p);
      const summary = lastFiveFantasySummary(p);
      assert.equal(summary.average, average); assert.equal(summary.scoredGames, count); assert.equal(summary.unavailable, unavailable);
      if (count < 5 || unavailable) assert.equal(summary.incomplete, true);
      assert.deepEqual(p, before, 'summary never changes facts, scoring or certification');
    }
    const p = profile(sport, [100, 1, null, 3, 4, 5]);
    assert.equal(lastFiveFantasySummary(p).average, 22.6);
    assert.equal(fantasyTrend(p, 'last5').average, 3.25, 'existing chart keeps its five chronological appearances and gap');
    p.coverage.freshness = 'stale'; p.windows.season.metricComparable.fantasy_points = false;
    assert.equal(lastFiveFantasySummary(p).incomplete, true);
  });

  test(`${sport}: Last 5 excludes other identities/seasons, DNP, live, scheduled and future games`, () => {
    const p = profile(sport, [1, 2, 3]);
    for (const [i, change] of [
      { providerPlayerId: 'other' }, { season: 2001 }, { phase: 'postseason' },
      { participation: 'dnp' }, { status: 'live' }, { status: 'scheduled' },
      { gameAt: '2099-01-01T00:00:00Z' },
    ].entries()) {
      const g = { ...structuredClone(p.games[0]), eventId: String(2000 + i), ...change };
      p.games.push(g); p.gameFantasyPoints[g.eventId] = 9999;
    }
    assert.equal(lastFiveFantasySummary(p).average, 2); assert.equal(lastFiveFantasySummary(p).scoredGames, 3);
    p.player.identity = 'unresolved'; assert.equal(lastFiveFantasySummary(p).average, null);
    p.player.identity = 'resolved'; p.fantasyScoringAvailable = false; assert.equal(lastFiveFantasySummary(p).average, null);
  });

  test(`${sport}: three stable KPIs replace games observed, with partial score and source metadata retained`, async () => {
    context.group = 'a'; const p = profile(sport, [100, 1, null, 3, 4, 5]);
    p.windows.season.averages.fantasy_points = 11; p.windows.season.metricComparable.fantasy_points = true;
    p.windows.last1.averages.fantasy_points = 99; p.windows.last1.metricComparable.fantasy_points = true;
    const props = { sport, season: p.season, identity: { id: p.player.playerId, name: p.player.name }, loader: { profile: async () => ({ ...p, groupId: 'a' }) } };
    const h = host(Profile(props).type); h.render(props, true); await tick(); let tree = h.render(props, true);
    const summary = t => nodes(t).find(n => n.props?.['aria-label'] === 'Actual performance summary');
    const cells = summary(tree).props.children;
    assert.deepEqual(cells.map(c => text(find(c, 'span'))), ['Last game FP', 'Season FP/game', 'Last 5 FP/game']);
    assert.equal(text(find(cells[0], 'strong')), '5'); assert.equal(text(find(cells[1], 'strong')), '11'); assert.equal(text(find(cells[2], 'strong')), '22.6');
    assert.match(text(cells[2]), /5 scored games.*1 unavailable/);
    assert.doesNotMatch(text(summary(tree)), /Games observed/);
    assert.match(text(tree), /6\s*\/\s*6\s+games observed/); assert.match(text(tree), /Independent provider GP/);
    find(tree, WindowControl).props.onChange('last1'); tree = h.render(props);
    assert.equal(text(find(summary(tree).props.children[1], 'span')), 'Season FP/game');
    assert.equal(text(find(summary(tree).props.children[1], 'strong')), '11'); h.unmount();
  });

  test(`${sport}: owned/unowned collapsed heading is only Roster actions; context stays inside`, () => {
    const calls = [], base = { sport, mode: 'draft', player: { id: 4, name: 'Player' }, slateId: 12, onClose() {}, orderedTeamsForSlate: [{ id: 1, name: 'Josh' }],
      getTeamAssignmentStatus: () => ({ canAssign: false, reason: 'Not authorized' }), getTeamStats: () => ({ totalPlayers: 4 }), getOwnerTeamIdForPlayer: () => 1,
      handleAssignPlayerToTeam: () => calls.push('assign'), handleRemovePlayerFromTeam: () => calls.push('remove') };
    for (const ownerTeam of [null, { id: 1, name: 'Josh' }]) {
      const tree = Adapter({ ...base, ownerTeam }), details = find(tree, 'details');
      assert.equal(text(find(details, 'summary')).trim(), 'Roster actions'); assert.notEqual(details.props.open, true);
      assert.match(text(nodes(details).find(n => n.props?.className === 'pc-section-title')), ownerTeam ? /Currently on Josh/ : /Choose a lineup/);
      assert.equal(nodes(details).find(n => n.type === 'button' && /Current lineup/.test(text(n))).props.disabled, true);
    }
    assert.deepEqual(calls, []);
  });

  for (const certified of [true, false]) test(`${sport}: compact four-column browser retains internal sample/certification data (${certified})`, async () => {
    context.group = 'a'; const p = profile(sport, [1, 2, 3, 4, 5]);
    p.coverage.comparisonEligible = certified;
    const result = { groupId: 'a', ...compareHistories({ sport, season: p.season, window: 'last5', metric: 'fantasy_points', ascending: false, scoring: scoring(sport) }, [p], capture.capturedAt, capture.capturedAt) };
    assert.equal(result.coverage.canSort, certified); const before = structuredClone(result);
    const props = { sport, season: p.season, loader: { comparisons: async () => result }, onInspect() {} }, h = host(Browser);
    h.render(props, true); await tick(); let tree = h.render(props, true);
    const table = nodes(tree).find(n => n.type === 'table' && n.props.className.includes('pc-pool-table'));
    const headings = nodes(find(table, 'thead')).filter(n => n.type === 'th'); assert.equal(headings.length, 4);
    assert.deepEqual([text(headings[0]), text(headings[1]), text(headings[3])], ['Player', 'Position', 'Status']);
    assert.ok(!headings.some(n => ['Sample', 'Profile'].includes(text(n))));
    const bodyRow = find(find(table, 'tbody'), 'tr'); assert.equal(bodyRow.props.children.length, 4);
    const coverage = find(tree, Coverage); assert.ok(coverage);
    const samples = nodes(coverage.props.children).find(n => n.props?.['aria-label'] === 'Player sample sizes'); assert.equal(samples, undefined);
    assert.match(text(coverage), /Unavailable statistics stay blank, not zero/);
    assert.equal(result.players[0].summary.metricSamples.fantasy_points, 5);
    nodes(tree).find(n => n.props?.['aria-label'] === 'Stat sort').props.onChange({ target: { value: 'name' } }); tree = h.render(props);
    assert.ok(find(tree, Coverage), 'coverage remains accessible when sorting names');
    assert.deepEqual(result, before); h.unmount();
  });
}
