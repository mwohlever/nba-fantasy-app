/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
};

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { nflSlateWindow, resolveNflFantasyGames, nflGameActionLabel } = require('../lib/live-scores/nflFantasyGames.ts');
const { NflFantasyGameAction, NflFantasyGameCenter, NflFantasyGamesContext } = require('../components/lineups/NflFantasyGameCenter.tsx');
const { normalizeNflGame } = require('../lib/providers/nflLiveScores.ts');
const window = { date: '2026-09-10', start_date: '2026-09-10', end_date: '2026-09-14' };
function raw(id, date, team, state = 'pre') {
  return { id, date, competitions: [{ status: { type: { state } }, competitors: [
    { homeAway: 'away', team: { id: team, abbreviation: team, displayName: team } },
    { homeAway: 'home', team: { id: `${team}2`, abbreviation: `${team}2`, displayName: `${team}2` } },
  ] }] };
}
const thursday = normalizeNflGame(raw('101', '2026-09-11T00:20:00Z', 'KC'));
const sunday = normalizeNflGame(raw('102', '2026-09-13T17:00:00Z', 'BUF'));
const monday = normalizeNflGame(raw('103', '2026-09-15T00:20:00Z', 'NYJ'));
const games = [thursday, sunday, monday];

test('Thursday, Sunday and Monday night resolve within the inclusive multi-day slate', () => {
  const resolved = resolveNflFantasyGames(games, window);
  for (const game of games) assert.equal(resolved.get(game.awayTeam.abbreviation), game);
  assert.equal(resolved.get('BYE'), undefined);
  const players = [{ team: 'KC' }, { team: 'KC' }];
  assert.equal(resolved.get(players[0].team), resolved.get(players[1].team));
});
test('unrelated weeks, missing dates/identity and ambiguous team events never guess', () => {
  assert.equal(resolveNflFantasyGames(games, { date: '2026-09-20' }).size, 0);
  assert.equal(resolveNflFantasyGames([...games, { ...thursday, espnEventId: '999' }], window).get('KC'), undefined);
  assert.equal(resolveNflFantasyGames([thursday, thursday], window).get('KC'), thursday);
  for (const broken of [{ ...thursday, kickoffAt: '' }, { ...thursday, espnEventId: '' }, { ...thursday, status: 'unknown' }]) {
    assert.equal(resolveNflFantasyGames([broken], window).size, 0);
  }
  assert.equal(nflSlateWindow({ date: '2026-02-30' }), null);
  assert.equal(nflSlateWindow({ ...window, end_date: '2026-09-01' }), null);
  assert.equal(resolveNflFantasyGames(games, { date: '2026-09-13' }).get('KC'), undefined);
});
test('labels use provider status only', () => {
  assert.deepEqual(['pre', 'in', 'post', 'unknown'].map(nflGameActionLabel), ['View Game', 'View Live Game', 'View Final', null]);
});

test('distinct actions render only for resolved players and pass the NFL event identity', () => {
  const player = { name: 'Drafted player', team_abbreviation: 'kc' };
  const calls = [];
  const context = { gamesByTeam: { KC: thursday }, openGameCenter: request => calls.push(request) };
  const render = player => renderToStaticMarkup(React.createElement(NflFantasyGamesContext.Provider, { value: context }, React.createElement(NflFantasyGameAction, { player })));
  assert.match(render(player), /<button[^>]*>View Game<\/button>/);
  assert.equal(render({ ...player, team_abbreviation: 'BYE' }), '');
  assert.equal(render(null), '');
  const original = React.useContext;
  React.useContext = () => context;
  try {
    const button = NflFantasyGameAction({ player });
    let stopped = false;
    button.props.onClick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.deepEqual(calls, [{ sport: 'nfl', eventId: '101' }]);
  } finally { React.useContext = original; }
});

// Exercise provider state/effect transitions without introducing a browser test dependency.
async function harness(run) {
  const originals = { useState: React.useState, useEffect: React.useEffect, fetch: global.fetch };
  const states = [], effects = [];
  let cursor = 0, effectCursor = 0;
  React.useState = initial => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
  };
  React.useEffect = (callback, deps) => {
    const index = effectCursor++;
    if (!effects[index] || deps.some((dep, i) => dep !== effects[index].deps[i])) {
      effects[index]?.cleanup?.();
      effects[index] = { deps, cleanup: callback() };
    }
  };
  const child = React.createElement('div', { id: 'fantasy-state' });
  const render = (slateId = 1, refreshKey = null) => {
    cursor = 0; effectCursor = 0;
    return NflFantasyGameCenter({ slateId, refreshKey, children: child });
  };
  try { await run(render, child); }
  finally { effects.forEach(e => e.cleanup?.()); Object.assign(React, { useState: originals.useState, useEffect: originals.useEffect }); global.fetch = originals.fetch; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('one slate fetch serves players; opening and closing preserve fantasy children; refresh updates state', async () => harness(async (render, child) => {
  let count = 0, status = 'pre';
  global.fetch = async () => { count++; return Response.json({ slateId: 1, gamesByTeam: { KC: { ...thursday, status } } }); };
  render(); await flush();
  let tree = render();
  tree.props.value.openGameCenter({ sport: 'nfl', eventId: '101' });
  tree = render();
  assert.equal(tree.props.children[0], child);
  const modal = tree.props.children[1];
  assert.equal(modal.props.game.espnEventId, '101');
  assert.equal(modal.type.name, 'NflGameCenterModal');
  modal.props.onClose();
  tree = render();
  assert.equal(tree.props.children[0], child);
  assert.equal(tree.props.children[1], null);
  assert.equal(count, 1);
  status = 'in'; render(1, 'refresh'); await flush();
  assert.equal(render(1, 'refresh').props.value.gamesByTeam.KC.status, 'in');
}));
test('slate switches immediately hide previous games/modal and abort late responses', async () => harness(async render => {
  const pending = [];
  global.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }));
  render(1);
  let tree = render(2);
  assert.deepEqual(tree.props.value.gamesByTeam, {});
  assert.equal(pending[0].options.signal.aborted, true);
  pending[0].resolve(Response.json({ slateId: 1, gamesByTeam: { KC: thursday } }));
  await flush();
  assert.deepEqual(render(2).props.value.gamesByTeam, {});
  pending[1].resolve(Response.json({ slateId: 2, gamesByTeam: { BUF: sunday } }));
  await flush();
  tree = render(2);
  assert.equal(tree.props.value.gamesByTeam.KC, undefined);
  tree.props.value.openGameCenter({ sport: 'nfl', eventId: '102' });
  assert.equal(render(1).props.children[1], null);
}));

test('roster and Scores retain profile handlers and distinct sibling actions', () => {
  const draft = fs.readFileSync(path.join(root, 'components/lineups/DraftRosterCourt.tsx'), 'utf8');
  const league = fs.readFileSync(path.join(root, 'components/lineups/LeagueLineupCards.tsx'), 'utf8');
  const scores = fs.readFileSync(path.join(root, 'components/lineups/ScoresDashboard.tsx'), 'utf8');
  assert.match(draft, /onPlayerClick\(player\)/);
  assert.match(league, /setResearchPlayer\(player\)/);
  assert.match(scores, /setProfilePlayer\(player\)/);
  assert.match(scores, /<\/button>\s*\{sport === "nfl" && <div className="scores-roster-game"><NflFantasyGameAction player=\{player\}/);
});

test('NFL games API authorizes before reads and uses only the requested slate window', async () => {
  const authPath = require.resolve('../lib/security/resourceAuthorization.ts');
  const dbPath = require.resolve('../lib/supabaseAdmin.ts');
  const oldAuth = require.cache[authPath], oldDb = require.cache[dbPath];
  const originalFetch = global.fetch;
  let allowed = false, reads = 0, requestedId, urls = [];
  require.cache[authPath] = { exports: { authorizeSlateResource: async (_request, id) => {
    requestedId = id;
    return allowed ? { ok: true } : { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) };
  } } };
  require.cache[dbPath] = { exports: { supabaseAdmin: { from(table) {
    reads++; assert.equal(table, 'slates');
    return { select() { return this; }, eq(column, id) { assert.equal(column, 'id'); assert.equal(id, requestedId); return this; },
      async single() { return { data: { id: requestedId, sport: 'nfl', ...window } }; } };
  } } } };
  global.fetch = async url => {
    urls.push(String(url));
    return Response.json({ events: [raw('101', thursday.kickoffAt, 'KC'), raw('999', '2026-09-20T17:00Z', 'BUF'),
      { ...raw('998', sunday.kickoffAt, 'DAL'), competitions: [{ ...raw('998', sunday.kickoffAt, 'DAL').competitions[0], status: { type: { state: 'post', name: 'STATUS_CANCELED' } } }] },
      { ...raw('100', sunday.kickoffAt, 'NYJ'), competitions: [{ ...raw('100', sunday.kickoffAt, 'NYJ').competitions[0], status: {} }] }] });
  };
  try {
    const { GET } = require('../app/api/lineups/nfl-games/route.ts');
    const request = id => ({ nextUrl: new URL(`http://localhost/api/lineups/nfl-games?slateId=${id}`) });
    assert.equal((await GET(request('bad'))).status, 400);
    assert.equal((await GET(request(42))).status, 403);
    assert.equal(reads, 0); assert.equal(urls.length, 0);
    allowed = true;
    const response = await GET(request(42));
    const data = await response.json();
    assert.equal(data.slateId, 42);
    assert.equal(data.gamesByTeam.KC.espnEventId, '101');
    assert.equal(data.gamesByTeam.BUF, undefined);
    assert.equal(data.gamesByTeam.NYJ, undefined);
    assert.equal(data.gamesByTeam.DAL, undefined);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /dates=20260910-20260914/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    global.fetch = originalFetch;
    if (oldAuth) require.cache[authPath] = oldAuth; else delete require.cache[authPath];
    if (oldDb) require.cache[dbPath] = oldDb; else delete require.cache[dbPath];
  }
});

test('actual 2026 Week 1 Wednesday opener and Monday game use their ESPN identities', () => {
  const opener = normalizeNflGame(raw('401872656', '2026-09-10T00:20Z', 'NE'));
  const mondayGame = normalizeNflGame(raw('401872931', '2026-09-15T00:15Z', 'DEN'));
  const result = resolveNflFantasyGames([opener, mondayGame], { ...window, start_date: '2026-09-09' });
  assert.equal(result.get('NE').espnEventId, '401872656');
  assert.equal(result.get('DEN').espnEventId, '401872931');
  assert.equal(resolveNflFantasyGames([opener], window).size, 0);
});

test('drafted roster profile buttons and Game Center buttons invoke distinct handlers', () => {
  const DraftRosterCourt = require('../components/lineups/DraftRosterCourt.tsx').default;
  const LeagueLineupCards = require('../components/lineups/LeagueLineupCards.tsx').default;
  const player = { id: 1, name: 'Drafted QB', position_group: 'QB', team_abbreviation: 'KC' };
  const rosterSlots = [{ sport: 'nfl', position: 'QB', slot_count: 1, display_order: 0 }];
  const profiles = [], gamesOpened = [];
  const original = React.useContext;
  React.useContext = () => ({ gamesByTeam: { KC: thursday }, openGameCenter: request => gamesOpened.push(request) });
  function buttons(node) {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(buttons);
    if (node.type === 'button') return [node];
    if (typeof node.type === 'function' && ['DraftRosterSlot', 'MiniSlot', 'NflFantasyRosterPlayer', 'NflFantasyGameAction'].includes(node.type.name)) return buttons(node.type(node.props));
    return buttons(node.props?.children);
  }
  try {
    const trees = [
      DraftRosterCourt({ teamId: 1, teamName: 'My team', players: [player], rosterSlots, isLocked: false, setDraftingPlayer: p => profiles.push(p), setTargetDraftSlot() {} }),
      LeagueLineupCards({ teams: [{ id: 2, name: 'Another team' }], currentTeamId: 1, getPlayersForTeam: () => [player], getPlayerProjectionScore: () => 0, getDraftNeeds: () => '', rosterSlots, isLocked: false, setResearchPlayer: p => profiles.push(p), setTargetDraftSlot() {} }),
    ];
    for (const tree of trees) {
      const found = buttons(tree);
      found.find(button => button.props['aria-label'] === 'View Drafted QB').props.onClick();
      assert.equal(gamesOpened.length, profiles.length - 1);
      found.find(button => button.props['aria-label'] === 'View Game: Drafted QB').props.onClick({ stopPropagation() {} });
    }
    assert.deepEqual(profiles, [player, player]);
    assert.deepEqual(gamesOpened, [{ sport: 'nfl', eventId: '101' }, { sport: 'nfl', eventId: '101' }]);
  } finally { React.useContext = original; }
});
