/* eslint-disable @typescript-eslint/no-require-imports */
// Component callbacks and recorded public box scores only; no live draft/provider/database calls.
const assert = require('node:assert/strict'), test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const React = require('react'), ReactDOM = require('react-dom');
React.useId = () => 'chrome-profile';
const Browser = require('../components/player-center/ResearchBrowser.tsx').default;
const Profile = require('../components/player-center/PlayerCenter.tsx').default;
const { WindowControl } = require('../components/player-center/PlayerCenter.tsx');
const DraftCenter = require('../components/player-center/DraftPlayerCenter.tsx').default;
const Adapter = require('../components/player-center/PlayerModalAdapter.tsx').default;
const Modal = require('../components/player-center/PlayerCenterModal.tsx').default;
const { compareHistories, summarizeHistory } = require('../lib/player-center/comparison.ts');
const { modalSeasons } = require('../lib/player-center/modalContext.ts');
const { professionalSeason } = require('../lib/player-center/types.ts');
const { decodeSeasonCache } = require('../lib/player-center/durableCache.ts');
const { presentProfile } = require('../lib/player-center/presentation.ts');
const capture = require('../data/player-center-preview/captured.json');
const curryCache = require('./fixtures/player-center/nba-curry-2027-canary.json');
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = t => Array.isArray(t) ? t.map(text).join(' ') : t && typeof t === 'object' ? text(t.props?.children) : typeof t === 'string' || typeof t === 'number' ? String(t) : '';
const find = (t, type) => nodes(t).find(n => n.type === type);
const button = (t, label) => nodes(t).find(n => n.type === 'button' && text(n).trim() === label);
const scoring = sport => ({ sport, settings: null, basis: 'legacy_defaults' });
const requests = [], actions = [];
const prior = { flag: process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED, document: global.document, portal: ReactDOM.createPortal };
test.after(() => { if (prior.flag === undefined) delete process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED; else process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = prior.flag; global.document = prior.document; ReactDOM.createPortal = prior.portal; });

function histories(sport) {
  const original = capture.histories.find(h => h.player.sport === sport && h.player.position === (sport === 'nba' ? 'F/C' : 'QB'));
  return ['Alpha', 'Beta', 'Gamma', 'Missing'].map((name, i) => {
    const h = structuredClone(original), value = [0, 20, 20, null][i];
    h.player = { ...h.player, playerId: i + 1, providerPlayerId: String(100 + i), name };
    h.coverage = { ...h.coverage, expectedGames: 50, comparisonEligible: false, freshness: 'stale' };
    delete h.coverage.cache;
    const game = h.games.find(g => g.status === 'final' && g.participation === 'played');
    h.games = [0, 1].map(j => ({ ...structuredClone(game), providerPlayerId: h.player.providerPlayerId, eventId: String(1000 + j), issues: [],
      stats: { ...game.stats, [sport === 'nba' ? 'points' : 'passing_yards']: value } }));
    return h;
  });
}

for (const sport of ['nba', 'nfl']) {
  test(`${sport}: observed short-window means retain real zero, null and strict certification`, () => {
    const pool = histories(sport), metric = sport === 'nba' ? 'points' : 'passing_yards';
    const summary = summarizeHistory(pool[0], 'last5', scoring(sport), capture.capturedAt);
    assert.equal(summary.averages[metric], null); assert.equal(summary.observedAverages[metric], 0);
    assert.equal(summary.metricComparable[metric], false); assert.equal(summary.sampleSize, 2);
    const h = pool[1]; h.games[0].stats[metric] = null;
    const partial = summarizeHistory(h, 'last5', scoring(sport), capture.capturedAt);
    assert.equal(partial.observedAverages[metric], 20); assert.equal(partial.metricSamples[metric], 1);
    assert.equal(partial.averages[metric], null); assert.equal(partial.observedAverages.fantasy_points, summarizeHistory({ ...h, games: [h.games[1]] }, 'season', scoring(sport), capture.capturedAt).observedAverages.fantasy_points);
    const data = compareHistories({ sport, season: h.season, window: 'last5', metric, ascending: false, scoring: scoring(sport) }, pool, capture.capturedAt, capture.capturedAt);
    assert.equal(data.coverage.canSort, false); assert.equal(data.coverage.rankablePlayers, 0);
    assert.equal(data.players.find(p => p.player.name === 'Missing').observedAverage, null);
    assert.ok(data.players.every(p => p.rankableAverage === null));
  });

  test(`${sport}: numerical observed sorting, both directions/windows, position and slate subsets never draft`, async () => {
    context.group = 'a'; const pool = histories(sport), season = pool[0].season, metric = sport === 'nba' ? 'points' : 'passing_yards';
    requests.length = 0; actions.length = 0;
    const loader = { comparisons: async input => { requests.push(input); return { groupId: 'a', ...compareHistories({ ...input, scoring: scoring(sport) }, pool, capture.capturedAt, capture.capturedAt) }; } };
    const entries = pool.map(h => ({ identity: { id: h.player.playerId, name: h.player.name, positionGroup: h.player.position } }));
    let props = { sport, season, slateId: 123, loader, entries, onInspect: p => actions.push(['inspect', p.id]), onSelect: p => actions.push(['draft', p.id]) };
    const h = host(Browser);
    async function render() { h.render(props, true); await tick(); h.render(props, true); await tick(); return h.render(props); }
    const order = t => nodes(t).filter(n => n.type === 'tr' && n.props['data-selected'] !== undefined).map(n => text(find(n, 'button')).trim().split(' ')[0]);
    let tree = await render();
    assert.equal(nodes(tree).find(n => n.type === 'option' && n.props.value === 'fantasy_points').props.children, 'Fantasy Points');
    for (const selected of ['fantasy_points', metric]) {
      nodes(tree).find(n => n.props?.['aria-label'] === 'Stat sort').props.onChange({ target: { value: selected } }); tree = await render();
      for (const window of ['last1', 'last3', 'last5', 'season']) {
        find(tree, WindowControl).props.onChange(window); tree = await render();
        assert.deepEqual(order(tree), ['Beta', 'Gamma', 'Alpha', 'Missing']);
        assert.match(text(tree), /Observed-data sorting/); assert.match(text(tree), /0\s*\/\s*4\s+source players have a certified complete sample/);
        nodes(tree).find(n => n.props?.['aria-label'] === 'Change stat sort direction').props.onClick(); tree = await render();
        assert.deepEqual(order(tree), ['Alpha', 'Beta', 'Gamma', 'Missing']);
        nodes(tree).find(n => n.props?.['aria-label'] === 'Change stat sort direction').props.onClick(); tree = await render();
      }
    }
    props = { ...props, entries: [entries[0], entries[3]], position: pool[0].player.position }; tree = await render();
    assert.deepEqual(order(tree), ['Alpha', 'Missing']); assert.equal(requests.at(-1).position, pool[0].player.position);
    props = { ...props, entries, search: 'Gamma' }; tree = await render(); assert.deepEqual(order(tree), ['Gamma']);
    assert.deepEqual(actions, []);
    props = { ...props, search: '', comparison: { selectedIds: [2], onToggle: p => actions.push(['compare', p.id]) } }; tree = await render();
    nodes(tree).find(n => n.props?.['aria-label'] === 'Compare Alpha player profile').props.onClick();
    assert.deepEqual(actions, [['compare', 1]]); h.unmount();
  });
}

test('current professional defaults remain independent from history/slate years and roll forward for NBA/NFL', () => {
  for (const [at, nba, nfl] of [['2026-11-02', 2027, 2026], ['2027-01-12', 2027, 2026], ['2027-03-10', 2027, 2027], ['2027-10-20', 2028, 2027]]) {
    for (const [sport, expected] of [['nba', nba], ['nfl', nfl]]) {
      const result = modalSeasons({ sport, season: 2024, defaultMode: 'season' }, new Date(at));
      assert.equal(result.professionalSeason, expected); assert.equal(result.leagueSeason, 2024);
      assert.equal(modalSeasons({ sport, centerSeason: 2025, season: 2024 }, new Date(at)).professionalSeason, 2025);
    }
  }
  for (const sport of ['nba', 'nfl']) {
    const t = host(DraftCenter).render({ sport, nflSeason: '2024', selectedSeason: '2024', players: [], filteredPlayers: [], availablePlayerIdSet: new Set(), setOnSlateOnly() {} });
    assert.equal(find(t, Browser).props.season, professionalSeason(sport));
  }
  const source = require('node:fs').readFileSync('components/lineups/LineupBuilder.tsx', 'utf8');
  assert.match(source, /modalCenterSeason = modalSport === "golf" \? undefined : professionalSeason\(modalSport\)/);
});

test('certified pool exclusions never sort a displayed short-sample number after lower observed numbers', async () => {
  context.group = 'a'; const pool = histories('nba');
  for (const [i, h] of pool.entries()) {
    const game = h.games[0], count = [5, 2, 5, 0][i];
    h.games = Array.from({ length: count }, (_, n) => ({ ...structuredClone(game), eventId: String(2000 + n), gameAt: new Date(Date.parse(game.gameAt) - n * 86400000).toISOString() }));
    h.coverage = { ...h.coverage, expectedGames: count, comparisonEligible: true, freshness: 'fresh', cache: { complete: true, asOf: capture.capturedAt } };
  }
  const input = { sport: 'nba', season: 2027, window: 'last5', metric: 'points', ascending: false, scoring: scoring('nba') };
  assert.equal(compareHistories(input, pool, capture.capturedAt, capture.capturedAt).coverage.canSort, true);
  const h = host(Browser), props = { sport: 'nba', season: 2027, onInspect() {}, loader: { comparisons: async query => ({ groupId: 'a', ...compareHistories({ ...query, scoring: scoring('nba') }, pool, capture.capturedAt, capture.capturedAt) }) } };
  h.render(props, true); await tick(); let tree = h.render(props);
  nodes(tree).find(n => n.props?.['aria-label'] === 'Stat sort').props.onChange({ target: { value: 'points' } }); h.render(props, true); await tick(); tree = h.render(props);
  assert.match(text(tree), /Observed-data sorting/);
  const names = nodes(tree).filter(n => n.props?.['aria-label']?.startsWith('View ')).map(n => n.props['aria-label']);
  assert.deepEqual(names, ['View Beta player profile', 'View Gamma player profile', 'View Alpha player profile', 'View Missing player profile']); h.unmount();
});

test('recorded Curry NBA 2027 canary opens Game Log Season with five scores/41.16; manual season survives tabs', async () => {
  context.group = 'a'; const player = { sport: 'nba', playerId: 4, name: 'Stephen Curry', position: 'G', active: true, nativePlayerId: '201939', providerPlayerId: '3975', identity: 'resolved' };
  const history = decodeSeasonCache(curryCache, player, 2027, Date.parse(curryCache.checked_at));
  const data = presentProfile(history, scoring('nba'), curryCache.as_of); assert.equal(data.games.length, 5);
  assert.ok(Math.abs(data.windows.season.averages.fantasy_points - 41.16) < 1e-9);
  const calls = [], props = { identity: { id: 4, name: player.name }, sport: 'nba', season: 2027, loader: { profile: async input => { calls.push(input); return { ...data, groupId: 'a', season: input.season }; } } };
  const h = host(Profile(props).type);
  h.render(props, true); await tick(); let tree = h.render(props, true);
  assert.equal(calls[0].season, 2027); assert.match(text(tree), /41\.2/);
  assert.equal(button(tree, 'Game log').props['aria-selected'], true);
  assert.equal(find(tree, WindowControl).props.value, 'season');
  find(tree, WindowControl).props.onChange('season');
  nodes(tree).find(n => n.props?.['aria-label'] === 'Profile season').props.onChange({ target: { value: 2026 } });
  tree = h.render(props, true); await tick(); tree = h.render(props);
  for (const tab of ['Season stats', 'Fantasy', 'Game log']) { button(tree, tab).props.onClick(); tree = h.render(props); assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Profile season').props.value, 2026); }
  assert.equal(calls.at(-1).season, 2026); h.unmount();
});

test('NFL manual professional season persists across all profile tabs', async () => {
  context.group = 'a'; const history = structuredClone(capture.histories.find(h => h.player.sport === 'nfl' && h.player.position === 'QB'));
  const calls = [], props = { identity: { id: history.player.playerId, name: history.player.name }, sport: 'nfl', season: 2026,
    loader: { profile: async input => { calls.push(input); return { ...presentProfile(history, scoring('nfl'), capture.capturedAt), groupId: 'a', season: input.season }; } } };
  const h = host(Profile(props).type); h.render(props, true); await tick(); let tree = h.render(props, true);
  nodes(tree).find(n => n.props?.['aria-label'] === 'Profile season').props.onChange({ target: { value: 2025 } });
  tree = h.render(props, true); await tick(); tree = h.render(props);
  for (const tab of ['Fantasy', 'Season stats', 'Game log']) { button(tree, tab).props.onClick(); tree = h.render(props); assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Profile season').props.value, 2025); }
  assert.equal(calls.at(-1).season, 2025); h.unmount();
});

for (const sport of ['nba', 'nfl']) test(`${sport}: Roster actions is collapsed, with all assignment/fixed-slot permissions preserved`, () => {
  const calls = [], player = { id: 4, name: 'Test player' }, props = { sport, mode: 'draft', player, slateId: 12, onClose() {}, orderedTeamsForSlate: [{ id: 1, name: 'Allowed' }, { id: 2, name: 'Full' }, { id: 3, name: 'Not participating', is_participating: false }],
    getTeamAssignmentStatus: id => ({ canAssign: id === 1, reason: 'Full / not eligible' }), getTeamStats: () => ({ totalPlayers: 4 }), getOwnerTeamIdForPlayer: () => null,
    handleAssignPlayerToTeam: (_, id) => calls.push(id), targetDraftSlot: { teamId: 1, positionGroup: sport === 'nba' ? 'G' : 'QB' }, handleDraftToTargetSlot: () => calls.push('slot') };
  let tree = Adapter(props), details = find(tree, 'details'); assert.ok(details); assert.notEqual(details.props.open, true);
  assert.match(text(find(details, 'summary')), /Roster actions/); assert.doesNotMatch(text(find(details, 'summary')), /Choose a lineup|On /); assert.deepEqual(calls, []);
  const teams = nodes(details).filter(n => n.type === 'button' && /rostered/.test(text(n)));
  assert.equal(teams.length, 3); assert.equal(teams[0].props.disabled, false); assert.equal(teams[1].props.disabled, true); assert.equal(teams[2].props.disabled, true);
  for (const busy of ['isAssigningPlayer', 'isSaving', 'isExternalLoading']) assert.ok(nodes(Adapter({ ...props, [busy]: true })).filter(n => n.type === 'button').every(n => n.props.disabled));
  assert.notEqual(find(Adapter({ ...props, player: { ...player, id: 5 } }), 'details').key, details.key);
  assert.equal(Adapter({ ...props, mode: 'view' }).props.children, null);
  tree = Adapter({ ...props, getTeamAssignmentStatus: () => ({ canAssign: false, reason: 'Not authorized' }) }); assert.ok(nodes(tree).filter(n => n.type === 'button').every(n => n.props.disabled));
});

test('modal scroll resets on mount, different player and reopen, without resetting same-player tab scroll', () => {
  ReactDOM.createPortal = child => child;
  global.document = { body: { style: { overflow: 'auto' } }, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const body = { scrollTop: 100 }, footer = { scrollTop: 50 }, panel = { scrollTop: 12, querySelectorAll: selector => selector.includes('.pc-modal-body') ? [body, footer] : [] };
  const props = { sport: 'nba', identity: { id: 4, name: 'Curry' }, onClose() {} };
  function mount() { const h = host(Modal), tree = h.render(props); nodes(tree).find(n => n.props?.className === 'pc-modal-shell').props.ref.current = panel; h.render(props, true); return h; }
  const h = mount(); assert.equal(body.scrollTop, 0); assert.equal(footer.scrollTop, 0);
  body.scrollTop = 100; h.render(props, true); assert.equal(body.scrollTop, 100);
  h.render({ ...props, identity: { id: 5, name: 'Other' } }, true); assert.equal(body.scrollTop, 0);
  h.unmount(); body.scrollTop = 80; footer.scrollTop = 50;
  const reopened = mount(); assert.equal(body.scrollTop, 0); assert.equal(footer.scrollTop, 0); reopened.unmount();
  ReactDOM.createPortal = prior.portal; global.document = prior.document;
});
