/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
const Research = require('../components/lineups/PlayerResearchModal.tsx').default;
const PlayerModal = require('../components/lineups/PlayerModal.tsx').default;
const DraftModal = require('../components/lineups/DraftPlayerModal.tsx').default;
const ReadOnly = require('../components/lineups/ReadOnlyPlayerModal.tsx').default;
const Adapter = require('../components/player-center/PlayerModalAdapter.tsx').default;
const Modal = require('../components/player-center/PlayerCenterModal.tsx').default;
const Content = require('../components/player-center/PlayerProfileContent.tsx').default;
const Profile = require('../components/player-center/PlayerCenter.tsx').default;
const League = require('../components/player-center/PlayerLeagueHistory.tsx').default;
const Basics = require('../components/player-center/PlayerBasics.tsx').default;
const HistoryCenter = require('../components/player-center/PlayerHistoryCenter.tsx').default;
const { modalSeasons, leagueHistoryHref } = require('../lib/player-center/modalContext.ts');
const { professionalSeason } = require('../lib/player-center/types.ts');
const { mountPlayerModal } = require('../lib/client/playerModalLifecycle.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const find = (tree, type) => nodes(tree).find(n => n.type === type);
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n).replace(/\s+/g, ' ').trim() === label);
const player = { id: 7, name: 'Player Seven', position_group: 'QB', nfl_player_id: 123, nba_player_id: 456 };
const identity = { id: 7, name: 'Player Seven', positionGroup: 'QB' };
const previous = { flag: process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED, fetch: global.fetch, window: global.window, document: global.document };
test.after(() => { if (previous.flag === undefined) delete process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED; else process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = previous.flag; global.fetch = previous.fetch; global.window = previous.window; global.document = previous.document; });
function profile(sport = 'nba', season = 2024) {
  return { sport, scope: { groupId: 'a', leagueId: `${sport}-a` }, selectedSeason: season,
    player: { id: 7, name: 'Player Seven' },
    summary: { timesDrafted: 3, wins: 1, runnerUps: 1, winRate: 33.3, averageFantasyPoints: 25, bestFantasyPoints: 99, worstFantasyPoints: -2, averageFinish: 2,
      draftedMostBy: { teamName: 'Historical owner', count: 2 }, draftedByBreakdown: [{ teamName: 'Other owner', count: 1 }, { teamName: 'Historical owner', count: 2 }] },
    recentHistory: [{ slateId: 12, slateLabel: '2024-01-01', teamName: 'Historical owner', finishPosition: 1, fantasyPoints: 99,
      stats: { points: 20, passing_yards: 400 }, projectedFantasyPoints: 99999 }], projectedFantasyPoints: 99999 };
}
for (const sport of ['nba', 'nfl']) {
  test(`${sport}: research retains requested league/professional seasons, mode, slate and close/action callbacks`, () => {
    let closes = 0, actions = 0;
    const props = { sport, player: identity, season: 2024, centerSeason: sport === 'nba' ? 2027 : 2025, nflStatsSeason: 2025,
      defaultMode: 'league', slateId: 12, onClose: () => closes++, actionLabel: 'Explicit draft action', onAction: () => actions++ };
    const tree = Research(props); assert.equal(tree.type, Modal);
    assert.equal(tree.props.leagueSeason, 2024); assert.equal(tree.props.season, props.centerSeason);
    assert.equal(tree.props.defaultMode, 'league'); assert.equal(tree.props.slateId, 12); assert.equal(tree.props.sport, sport);
    assert.equal(actions, 0); tree.props.onClose(); assert.equal(closes, 1); assert.equal(props.season, 2024); assert.equal(props.defaultMode, 'league');
    const disabled = Research({ ...props, actionDisabled: true }); assert.equal(disabled.props.children.props.disabled, true);
    disabled.props.children.props.onClick(); assert.equal(actions, 0);
    tree.props.children.props.onClick(); assert.equal(actions, 1);
    const legacySeason = Research({ ...props, centerSeason: undefined, defaultMode: 'season' });
    assert.equal(legacySeason.props.season, sport === 'nfl' ? 2025 : professionalSeason('nba'), 'explicit NFL baseline retained; league year does not choose NBA profile season');
  });
  test(`${sport}: normal draft and read-only wrappers carry explicit sport even if persisted sport differs`, () => {
    context.sport = sport === 'nba' ? 'nfl' : 'nba';
    const props = { sport, leagueSeason: 2024, centerSeason: sport === 'nba' ? 2027 : 2025, slateId: 12, researchMode: 'league',
      player, draftingPlayer: player, setDraftingPlayer() {}, setPlayer() {}, playerAverageMap: new Map(), playerProjections: {} };
    const d = DraftModal(props); assert.equal(d.type, PlayerModal); assert.equal(d.props.mode, 'draft');
    const r = ReadOnly(props); assert.equal(r.type, PlayerModal); assert.equal(r.props.mode, 'view');
    for (const tree of [d, r]) {
      const adapter = host(PlayerModal).render(tree.props); assert.equal(adapter.type, Adapter); assert.equal(adapter.props.sport, sport);
      assert.equal(adapter.props.leagueSeason, 2024); assert.equal(adapter.props.centerSeason, props.centerSeason); assert.equal(adapter.props.slateId, 12);
    }
    const readonly = Adapter({ ...r.props, sport }); assert.equal(readonly.props.children, null);
    assert.equal(readonly.props.defaultMode, 'league'); assert.equal(readonly.props.season, props.centerSeason);
  });
  for (const enabled of [true, false]) test(`${sport}, profiles ${enabled}: history retains saved results, résumé, ownership, career and navigation`, async () => {
    context.group = 'a'; context.sport = sport; process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = String(enabled);
    const requests = []; global.fetch = async (url, init) => { requests.push([url, init]); return { ok: true, json: async () => profile(sport) }; };
    const h = host(League), props = { identity, sport, initialSeason: 2024 };
    h.render(props, true); await tick(); const tree = h.render(props), body = text(tree);
    for (const label of ['Performance résumé', 'Recent Drafts', 'Drafted By', 'More career numbers', 'Avg FP', 'Historical owner', '99.0']) assert.ok(body.includes(label), label);
    assert.doesNotMatch(body, /projection|99999/i); assert.equal(find(tree, Profile), undefined, 'saved results never use professional scorers');
    const owners = nodes(tree).filter(n => n.props?.className === 'player-modal-owner-label'); assert.match(text(owners[0]), /Historical owner/);
    const link = nodes(tree).find(n => n.type === 'a'); assert.equal(link.props.href, leagueHistoryHref(sport, 2024, 7));
    assert.ok(requests.every(([, init]) => !init.method || init.method === 'GET'));
    const url = new URL(requests[0][0], 'http://test'); assert.equal(url.searchParams.get('season'), '2024'); assert.equal(url.searchParams.get('sport'), sport);
    assert.equal(url.searchParams.has('slateId'), false, 'league history is not restricted to the inspected slate');
    const select = nodes(tree).find(n => n.type === 'select'); select.props.onChange({ target: { value: 'all' } });
    global.fetch = async () => ({ ok: true, json: async () => profile(sport, 'all') });
    h.render(props, true); await tick(); assert.match(text(h.render(props)), /All-Time\s+League Snapshot/);
    h.unmount();
  });
}
test('league-year selection never becomes an implicit professional year', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  assert.deepEqual(modalSeasons({ sport: 'nba', season: 2024, defaultMode: 'league' }, now), { leagueSeason: 2024, professionalSeason: 2027 });
  assert.deepEqual(modalSeasons({ sport: 'nfl', season: 2024, nflStatsSeason: 2025, defaultMode: 'season' }, now), { leagueSeason: 2024, professionalSeason: 2025 });
  assert.deepEqual(modalSeasons({ sport: 'nfl', season: 'all', defaultMode: 'league' }, now), { leagueSeason: 'all', professionalSeason: 2026 });
});
test('assign, move, remove, fixed slot, ownership, eligibility/capacity and busy checks retain the parent handlers', () => {
  const calls = [], teams = [{ id: 1, name: 'Owner' }, { id: 2, name: 'Full' }, { id: 3, name: 'Eligible' }];
  const props = { sport: 'nfl', mode: 'draft', player, ownerTeam: teams[0], orderedTeamsForSlate: teams, onClose() {},
    centerSeason: 2025, leagueSeason: 2024, slateId: 12, isAssigningPlayer: false, isSaving: false,
    getTeamStats: () => ({ totalPlayers: 2 }), getTeamAssignmentStatus: id => ({ canAssign: id === 3, reason: 'Full or ineligible' }), getOwnerTeamIdForPlayer: () => 1,
    handleAssignPlayerToTeam: async (p, id) => { calls.push(['move', p.id, id]); return true; }, handleRemovePlayerFromTeam: async p => calls.push(['remove', p.id]),
    targetDraftSlot: { teamId: 3, positionGroup: 'QB' }, handleDraftToTargetSlot: async p => calls.push(['slot', p.id]) };
  const tree = Adapter(props); assert.deepEqual(calls, []);
  const actions = nodes(tree).filter(n => n.type === 'button');
  assert.equal(actions.find(n => text(n).includes('Owner') && text(n).includes('Current lineup')).props.disabled, true);
  assert.equal(actions.find(n => text(n).includes('Full')).props.disabled, true);
  button(tree, 'Draft to QB Slot').props.onClick(); button(tree, 'Remove from Owner').props.onClick();
  actions.find(n => text(n).includes('Move here')).props.onClick();
  assert.deepEqual(calls, [['slot', 7], ['remove', 7], ['move', 7, 3]]);
  for (const flag of ['isAssigningPlayer', 'isSaving', 'isExternalLoading']) assert.ok(nodes(Adapter({ ...props, [flag]: true })).filter(n => n.type === 'button').every(n => n.props.disabled));
  assert.equal(button(Adapter({ ...props, getTeamAssignmentStatus: () => ({ canAssign: false, reason: 'Not authorized' }) }), 'Draft to QB Slot').props.disabled, true);
});
test('context switching preserves mounted profile/chart and league selectors without nesting dialogs', () => {
  process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = 'true'; context.group = 'a';
  const props = { identity, sport: 'nba', season: 2027, leagueSeason: 2024, defaultMode: 'league', slateId: 12 };
  const wrapper = host(Content), initial = wrapper.render(props), h = host(initial.type);
  let tree = h.render(props); assert.ok(find(tree, League)); assert.equal(find(tree, Profile), undefined);
  button(tree, 'NBA statistics').props.onClick(); tree = h.render(props); assert.equal(find(tree, Profile).props.season, 2027);
  assert.equal(find(tree, League).props.initialSeason, 2024);
  button(tree, '111 Sports League History').props.onClick(); tree = h.render(props); assert.ok(find(tree, Profile), 'profile stays mounted while hidden');
  assert.equal(nodes(tree).filter(n => n.props?.role === 'dialog').length, 0);
  context.group = 'b'; assert.notEqual(wrapper.render(props).key, initial.key);
  process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = 'false'; button(tree, 'NBA statistics').props.onClick(); tree = h.render(props);
  assert.ok(find(tree, Basics)); assert.ok(find(tree, League)); h.unmount(); wrapper.unmount();
  assert.equal(host(Content).render({ ...props, fixture: true }).type, Profile, 'fixture preview never adds authenticated league-history reads');
});
for (const field of ['group', 'league', 'player', 'sport', 'season']) test(`league history rejects mismatched ${field} context`, async () => {
  context.group = 'a'; context.sport = 'nba'; const bad = profile();
  if (field === 'group') bad.scope.groupId = 'other'; if (field === 'league') bad.scope.leagueId = 'other';
  if (field === 'player') bad.player.id = 99; if (field === 'sport') bad.sport = 'nfl'; if (field === 'season') bad.selectedSeason = 2025;
  global.fetch = async () => ({ ok: true, json: async () => bad });
  const h = host(League), props = { identity, sport: 'nba', initialSeason: 2024 }; h.render(props, true); await tick();
  assert.match(text(h.render(props)), /does not match/); assert.doesNotMatch(text(h.render(props)), /Historical owner/); h.unmount();
});
test('late Group/season reads abort and cannot flash saved results into a changed context', async () => {
  context.group = 'a'; const requests = []; global.fetch = (url, init) => new Promise(resolve => requests.push({ url, init, resolve }));
  const h = host(League), props = { identity, sport: 'nba', initialSeason: 2024 }; h.render(props, true);
  context.group = 'b'; assert.doesNotMatch(text(h.render(props, true)), /Historical owner/); assert.equal(requests[0].init.signal.aborted, true);
  requests[0].resolve({ ok: true, json: async () => profile() }); await tick(); assert.doesNotMatch(text(h.render(props)), /Historical owner/);
  const changed = profile(); changed.scope = { groupId: 'b', leagueId: 'nba-b' }; requests[1].resolve({ ok: true, json: async () => changed }); await tick(); assert.match(text(h.render(props)), /Historical owner/); h.unmount();
});
test('modal stack closes only the top profile, traps visible focus, restores focus and preserves scroll lock during handoff', () => {
  const listeners = [], doc = { activeElement: null, body: { style: { overflow: 'auto' } }, addEventListener: (type, fn) => listeners.push(fn), removeEventListener: (type, fn) => listeners.splice(listeners.indexOf(fn), 1) };
  global.document = doc;
  const element = (visible = true) => ({ isConnected: true, getClientRects: () => visible ? [1] : [], focus() { doc.activeElement = this; } });
  const original = element(); original.focus();
  const a = [element(), element(false), element()], b = [element(), element()];
  const panel = items => ({ querySelectorAll: () => items, contains: target => items.includes(target) });
  let first = 0, second = 0;
  const closeA = mountPlayerModal(panel(a), () => first++); assert.equal(doc.body.style.overflow, 'hidden'); assert.equal(doc.activeElement, a[0]);
  const closeB = mountPlayerModal(panel(b), () => second++);
  const event = key => ({ key, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } });
  const escape = event('Escape'); for (const fn of [...listeners]) { fn(escape); if (escape.stopped) break; }
  assert.equal(first, 0); assert.equal(second, 1);
  b[1].focus(); listeners.at(-1)(event('Tab')); assert.equal(doc.activeElement, b[0]);
  closeB(); assert.equal(doc.body.style.overflow, 'hidden'); assert.equal(doc.activeElement, a[0]);
  const tab = { ...event('Tab'), shiftKey: true }; listeners[0](tab); assert.equal(doc.activeElement, a[2], 'hidden research pane is excluded');
  closeA(); assert.equal(doc.body.style.overflow, 'auto'); assert.equal(doc.activeElement, original); assert.equal(listeners.length, 0);
  const old = mountPlayerModal(panel(a), () => {}), replacement = mountPlayerModal(panel(b), () => {});
  old(); assert.equal(doc.activeElement, b[0], 'outgoing modal cannot steal focus from replacement'); assert.equal(doc.body.style.overflow, 'hidden'); replacement(); assert.equal(doc.body.style.overflow, 'auto'); assert.equal(doc.activeElement, original, 'handoff restores the original opener');
});
test('history navigation honors league-season links and retains the mounted professional research on return', async () => {
  const load = Module._load;
  Module._load = function(request, parent, ...args) { if (request.includes('providers/SportProvider')) return { useSelectedSport: () => ({ selectedSport: context.sport, isHydrated: true }) }; return load.call(this, request, parent, ...args); };
  let Page; try { Page = require('../app/player-history/page.tsx').default; } finally { Module._load = load; }
  context.sport = 'nfl'; context.group = 'a'; process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = 'true'; global.window = { location: { search: '?sport=nfl&mode=league&season=2024' } };
  const h = host(Page); h.render({}, true); await tick(); let tree = h.render({});
  const center = find(tree, HistoryCenter); assert.ok(center);
  const legacy = nodes(tree).find(n => n.type?.name === 'LegacyPlayerHistoryPage'); assert.equal(legacy.props.initialSeason, 2024); assert.equal(legacy.props.initialMode, 'league');
  button(tree, '← Player Center').props.onClick(); tree = h.render({}); assert.equal(find(tree, HistoryCenter).key, center.key); assert.ok(nodes(tree).some(n => n.type?.name === 'LegacyPlayerHistoryPage'));
  h.unmount();
});
for (const sport of ['nba', 'nfl']) test(`${sport}: actual league-profile API echoes authorized scope and saved results without cross-Group leakage`, async () => {
  const active = { group: 'a', signedIn: true, enabled: true }, queries = [];
  const tables = {
    slates: ['a', 'b'].map((group, i) => ({ id: i + 1, league_id: `${sport}-${group}`, sport, start_date: '2024-01-01', date: '2024-01-01' })),
    lineups: [{ id: 11, slate_id: 1, team_id: 1 }, { id: 22, slate_id: 2, team_id: 2 }],
    lineup_players: [{ lineup_id: 11, player_id: 7 }, { lineup_id: 22, player_id: 7 }],
    teams: [{ id: 1, group_id: 'a', name: 'Historical owner' }, { id: 2, group_id: 'b', name: 'Other Group' }],
    team_slate_results: [{ slate_id: 1, team_id: 1, finish_position: 1 }, { slate_id: 2, team_id: 2, finish_position: 2 }],
    [sport === 'nba' ? 'players' : 'players_nfl']: [{ id: 7, name: 'Player Seven' }],
    [sport === 'nba' ? 'player_slate_stats' : 'player_nfl_slate_stats']: [{ slate_id: 1, player_id: 7, fantasy_points: 99 }, { slate_id: 2, player_id: 7, fantasy_points: -2 }],
  };
  const db = { from(table) { queries.push(table); let rows = [...(tables[table] ?? [])], single = false;
    const q = { select: () => q, eq(k, v) { rows = rows.filter(row => row[k] === v); return q; }, in(k, v) { rows = rows.filter(row => v.includes(row[k])); return q; },
      maybeSingle() { single = true; return q; }, then(ok, no) { return Promise.resolve({ data: single ? rows[0] : rows, error: null }).then(ok, no); },
      insert: () => assert.fail('No writes'), update: () => assert.fail('No writes'), delete: () => assert.fail('No writes') }; return q;
  } };
  const mocks = { 'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } }, '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/auth': { getCurrentUser: async () => active.signedIn ? { id: 'user' } : null },
    '@/lib/groups/context': { getActiveLeagueForSport: async () => active.enabled ? { context: { group: { id: active.group } }, league: { id: `${sport}-${active.group}` } } : null } };
  const load = Module._load;
  Module._load = function(request, parent, ...args) { if (parent?.filename.endsWith('/app/api/player-league-profile/route.ts') && request in mocks) return mocks[request]; return load.call(this, request, parent, ...args); };
  let route; try { delete require.cache[require.resolve('../app/api/player-league-profile/route.ts')]; route = require('../app/api/player-league-profile/route.ts'); } finally { Module._load = load; }
  const request = new Request(`http://test/api/player-league-profile?sport=${sport}&season=2024&playerId=7`);
  for (const group of ['a', 'b']) {
    active.group = group; const response = await route.GET(request), data = await response.json(); assert.equal(response.status, 200);
    assert.deepEqual(data.scope, { groupId: group, leagueId: `${sport}-${group}` }); assert.equal(data.sport, sport); assert.equal(data.selectedSeason, 2024);
    assert.equal(data.summary.timesDrafted, 1); assert.equal(data.recentHistory[0].fantasyPoints, group === 'a' ? 99 : -2);
    assert.equal(data.recentHistory[0].teamName, group === 'a' ? 'Historical owner' : 'Other Group');
  }
  queries.length = 0; active.signedIn = false; assert.equal((await route.GET(request)).status, 401); assert.deepEqual(queries, []);
  active.signedIn = true; active.enabled = false; assert.equal((await route.GET(request)).status, 404); assert.deepEqual(queries, []);
});
test('shared draft browser uses the owning sport for research instead of a mismatched persisted selection', () => {
  const Pool = require('../components/lineups/PlayerPool.tsx').default;
  const Center = require('../components/player-center/DraftPlayerCenter.tsx').default;
  context.sport = 'nfl'; context.group = 'a'; process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED = 'true';
  const props = { sport: 'nba', players: [player], filteredPlayers: [player], playerAverageMap: new Map(), selectedSeason: '2024', centerSeason: 2025,
    setOnSlateOnly() {}, setSearchTerm() {}, setPositionFilter() {}, getOwnerTeamForPlayer: () => null, availablePlayerIdsForSlate: [], availablePlayerIdSet: new Set() };
  const outer = host(Pool), shell = outer.render(props), h = host(shell.type), tree = h.render(props);
  assert.equal(find(tree, Center).props.sport, 'nba'); assert.equal(find(tree, Research).props.sport, 'nba');
  button(tree, 'League History').props.onClick(); assert.equal(find(h.render(props), Research).props.defaultMode, 'league'); h.unmount(); outer.unmount();
});
