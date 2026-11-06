/* eslint-disable @typescript-eslint/no-require-imports */
// Local component callbacks and fixture responses only; no browser or user-data mutations.
const assert = require('node:assert/strict'), test = require('node:test');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
require('react').useId = () => 'draft-browser-final';
const Pool = require('../components/lineups/PlayerPool.tsx').default;
const Center = require('../components/player-center/DraftPlayerCenter.tsx').default;
const Browser = require('../components/player-center/ResearchBrowser.tsx').default;
const DraftModal = require('../components/lineups/DraftPlayerModal.tsx').default;
const Adapter = require('../components/player-center/PlayerModalAdapter.tsx').default;
const Modal = require('../components/player-center/PlayerCenterModal.tsx').default;
const Profile = require('../components/player-center/PlayerCenter.tsx').default;
const SeasonStats = require('../components/player-center/SeasonStats.tsx').default;
const Headshot = require('../components/ui/PlayerHeadshot.tsx').default;
const { WindowControl } = require('../components/player-center/PlayerCenter.tsx');
const { presentProfile } = require('../lib/player-center/presentation.ts');
const capture = require('../data/player-center-preview/captured.json');
const text = t => Array.isArray(t) ? t.map(text).join(' ') : t && typeof t === 'object' ? text(t.props?.children) : typeof t === 'string' || typeof t === 'number' ? String(t) : '';
const find = (t, type) => nodes(t).find(n => n.type === type);
const button = (t, label) => nodes(t).find(n => n.type === 'button' && text(n).trim() === label);
const tick = () => new Promise(resolve => setImmediate(resolve));
const previous = { flag: process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED, node: process.env.NODE_ENV, fetch: global.fetch };
test.after(() => { global.fetch = previous.fetch; for (const [key, value] of [['NODE_ENV', previous.node], ['NEXT_PUBLIC_PLAYER_CENTER_ENABLED', previous.flag]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

async function setup(sport, enabled = true) {
  context.sport = sport; context.group = 'a'; process.env.NODE_ENV = 'production';
  if (enabled === undefined) delete process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED; else process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = String(enabled);
  const calls = [], players = ['Alpha', 'Beta'].map((name, i) => ({ id: i + 1, name, position_group: sport === 'nba' ? 'G' : 'QB', nba_player_id: 10 + i, nfl_player_id: 100 + i, is_active: true }));
  global.fetch = async (url, init) => {
    assert.ok(!init?.method || init.method === 'GET', 'research never writes');
    return { ok: true, json: async () => url.startsWith('/api/player-history?') ? { sport, scope: { groupId: 'a' }, playerHistory: [] }
      : { available: true, professionalSeason: 2025, playerStats: players.map((p, i) => ({ player_id: p.id, points: 20 + i, passing_yards: [222, 333][i], passing_yards_per_game: [999, 1][i] })) } };
  };
  const props = { sport, players, filteredPlayers: players, searchTerm: '', setSearchTerm() {}, positionFilter: 'All', setPositionFilter() {}, onSlateOnly: false, setOnSlateOnly() {},
    availablePlayerIdsForSlate: [1, 2], availablePlayerIdSet: new Set([1, 2]), playerAverageMap: new Map(), playerProjections: {}, getOwnerTeamForPlayer: () => null,
    setDraftingPlayer: p => calls.push(['select', p.id]), isAssigningPlayer: false, selectedSeason: '2026', nflSeason: '2026', centerSeason: sport === 'nba' ? 2027 : 2026, slateId: 12,
    rosterSlots: [{ position: sport === 'nba' ? 'G' : 'QB', slot_count: 1 }], pillBase: '', activePill: '', inactivePill: '' };
  const outer = host(Pool), h = host(outer.render(props).type);
  h.render(props, true); await tick(); h.render(props, true); await tick();
  return { props, calls, h, outer, render: () => h.render(props), close: () => { h.unmount(); outer.unmount(); } };
}

for (const sport of ['nba', 'nfl']) {
  for (const enabled of [true, false]) test(`${sport}, profiles ${enabled}: Game Stats / League History are the only browser tabs`, async () => {
    const s = await setup(sport, enabled);
    assert.ok(button(s.render(), 'Game Stats')); assert.ok(button(s.render(), 'League History')); assert.equal(button(s.render(), 'Season Stats'), undefined);
    button(s.render(), 'League History').props.onClick(); assert.equal(find(s.render(), Center), undefined);
    assert.ok(nodes(s.render()).some(n => n.props?.['aria-label'] === 'Draft player sort'));
    button(s.render(), 'Game Stats').props.onClick(); let tree = s.render();
    assert.equal(button(tree, 'Game Stats').props['aria-pressed'], true);
    if (enabled) {
      const c = host(Center), browser = find(c.render(find(tree, Center).props), Browser), b = host(Browser), body = b.render(browser.props);
      const window = find(body, WindowControl); assert.ok(window);
      assert.deepEqual(nodes(WindowControl(window.props)).filter(n => n.type === 'button').map(text), ['Last game', 'Last 3', 'Last 5', 'Season']);
      assert.ok(nodes(body).some(n => n.props?.['aria-label'] === 'Stat sort'));
      assert.ok(nodes(body).some(n => n.props?.['aria-label'] === 'Position filter'));
      assert.ok(button(browser.props.extras, 'On slate')); assert.ok(button(browser.props.extras, 'All players'));
      b.unmount(); c.unmount();
    }
    assert.deepEqual(s.calls, []); s.close();
  });

  test(`${sport}: names and headshots share the existing profile-opening selection, without a separate Info cell`, async () => {
    const s = await setup(sport), c = host(Center), b = host(Browser), props = find(c.render(s.props), Browser).props;
    let selected = null; s.props.setDraftingPlayer = p => { selected = p; };
    const tree = b.render(find(c.render(s.props), Browser).props), row = nodes(tree).find(n => n.type === 'tr' && n.props['data-selected'] !== undefined), opener = find(row, 'button');
    assert.equal(opener.props.type, 'button'); assert.ok(find(opener, Headshot)); assert.match(text(opener), /Alpha/);
    assert.equal(row.props.children.length, 4); assert.equal(nodes(row).filter(n => n.type === 'button').length, 1);
    for (const hit of ['name', 'headshot']) {
      selected = null; opener.props.onClick({ target: hit === 'headshot' ? find(opener, Headshot) : find(opener, 'span') });
      assert.equal(selected.id, 1);
      const draft = DraftModal({ ...s.props, draftingPlayer: selected, setDraftingPlayer: s.props.setDraftingPlayer, orderedTeamsForSlate: [], playerAverageMap: new Map() });
      const playerModal = host(draft.type).render(draft.props); assert.equal(playerModal.type, Adapter);
      const profile = Adapter(playerModal.props); assert.equal(profile.type, Modal); assert.equal(profile.props.identity.id, 1); assert.equal(profile.props.sport, sport);
    }
    assert.deepEqual(s.calls, []); assert.equal(props.disabled, false); b.unmount(); c.unmount(); s.close();
  });

  test(`${sport}: comparison still selects players; Draft Order/correction name browsing does not execute a pick`, async () => {
    const s = await setup(sport), c = host(Center), b = host(Browser), actions = [];
    s.props.speedEntry = { onSelect: p => actions.push(['pick', p.id]), onResearch: p => actions.push(['research', p.id]) };
    let props = find(c.render(s.props), Browser).props, tree = b.render(props);
    nodes(tree).find(n => n.props?.['aria-label'] === 'Select Alpha player profile').props.onClick();
    assert.deepEqual(actions, [['research', 1]]); actions.length = 0;
    props = find(c.render({ ...s.props, comparison: { selectedIds: [2], onToggle: id => actions.push(['compare', id]) } }), Browser).props;
    tree = b.render(props); nodes(tree).find(n => n.props?.['aria-label'] === 'Compare Alpha player profile').props.onClick();
    assert.deepEqual(actions, [['compare', 1]]); assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Compare Beta player profile').props['aria-pressed'], true);
    assert.deepEqual(s.calls, []); b.unmount(); c.unmount(); s.close();
  });

  test(`${sport}: the individual Player Center still has Game Log, Season Stats and Fantasy tabs`, async () => {
    context.group = 'a'; const history = capture.histories.find(h => h.player.sport === sport && h.player.position === (sport === 'nba' ? 'F/C' : 'QB'));
    const profile = { ...presentProfile(history, { sport, settings: null, basis: 'legacy_defaults' }, capture.capturedAt), groupId: 'a' };
    const props = { sport, season: history.season, identity: { id: history.player.playerId, name: history.player.name }, loader: { profile: async () => profile } }, h = host(Profile(props).type);
    h.render(props, true); await tick(); let tree = h.render(props, true);
    assert.deepEqual(nodes(tree).filter(n => n.props?.role === 'tab').map(text), ['Game log', 'Season stats', 'Fantasy']);
    button(tree, 'Season stats').props.onClick(); tree = h.render(props); assert.ok(find(tree, SeasonStats)); h.unmount();
  });
}

test('NFL season totals stay under Game Stats with their source year and total-based ordering', async () => {
  const s = await setup('nfl');
  const source = () => nodes(s.render()).find(n => n.props?.['aria-label'] === 'Game Stats source');
  assert.match(text(source()), /2025\s+season totals/);
  source().props.onChange({ target: { value: 'totals' } }); s.h.render(s.props, true);
  const sort = nodes(s.render()).find(n => n.props?.['aria-label'] === 'Draft player sort'); sort.props.onChange({ target: { value: 'nfl_pass_yd' } });
  const cards = () => nodes(s.render()).filter(n => n.props?.['aria-label']?.startsWith('Select '));
  assert.equal(cards()[0].props['aria-label'], 'Select Beta'); assert.match(text(s.render()), /2025 regular-season stats · Totals/);
  nodes(s.render()).find(n => n.props?.['aria-label'] === 'Change NFL stat sort direction').props.onClick();
  assert.equal(cards()[0].props['aria-label'], 'Select Alpha');
  assert.equal(button(s.render(), 'Game Stats').props['aria-pressed'], true); assert.equal(button(s.render(), 'Season Stats'), undefined);
  source().props.onChange({ target: { value: 'games' } }); assert.ok(find(s.render(), Center));
  assert.equal(find(s.render(), Center).props.centerSeason, 2026); assert.deepEqual(s.calls, []); s.close();
});
