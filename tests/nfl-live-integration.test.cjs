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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};
const React = require('react');
const { renderToStaticMarkup: render } = require('react-dom/server');
const { matchingNflSlate, buildNflOwnership, nflAthleteId } = require('../lib/live-scores/nflOwnership.ts');
const { normalizeNflField } = require('../lib/live-scores/nflField.ts');
const Field = require('../components/live-scores/NflLiveField.tsx').default;
const Owner = require('../components/live-scores/FantasyOwnerLabel.tsx').default;
const slates = [{ id: 1, date: '2026-09-09', end_date: '2026-09-14' }, { id: 2, date: '2026-09-17', end_date: '2026-09-21' }];

test('slate selection uses actual game Eastern date, including Monday UTC rollover; no week fallback', () => {
  assert.equal(matchingNflSlate(slates, '2026-09-15T00:20Z').id, 1);
  assert.equal(matchingNflSlate(slates, '2026-09-21T17:00Z').id, 2);
  for (const date of ['bad', '2026-09-16T17:00Z', '2027-09-15T00:20Z']) assert.equal(matchingNflSlate(slates, date), null);
  assert.equal(matchingNflSlate([...slates, slates[0]], '2026-09-15T00:20Z'), null);
});
test('stable IDs only, distinct owners, unrostered and ambiguous players stay normal', () => {
  const map = buildNflOwnership([{ providerId: 123, teamId: 1, name: 'Owner A' }, { providerId: '456', teamId: 2, name: 'Owner B' }], 1);
  assert.deepEqual(map['123'], { name: 'Owner A', isYou: true });
  assert.deepEqual(map['456'], { name: 'Owner B', isYou: false });
  assert.equal(map['789'], undefined);
  assert.equal(nflAthleteId('Same Name'), null);
  assert.equal(nflAthleteId('00123'), '123');
  assert.deepEqual(buildNflOwnership([{ providerId: 123, teamId: 1, name: 'A' }, { providerId: 123, teamId: 2, name: 'B' }]), {});
  assert.match(render(React.createElement(Owner, { owner: map['123'] })), /Owner A · You/);
  assert.match(render(React.createElement(Owner, { owner: map['456'] })), /Owner B/);
  assert.doesNotMatch(render(React.createElement(Owner, { owner: map['456'] })), /· You/);
  assert.equal(render(React.createElement(Owner, {})), '');
});

function summary(yards = 63, distance = 10) {
  return { header: { competitions: [{ status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS' }, period: 3, displayClock: '8:42' }, competitors: [
    { id: '1', possession: true, team: { id: '1', abbreviation: 'AAA', color: '123456' } },
    { id: '2', possession: false, team: { id: '2', abbreviation: 'BBB' } },
  ] }] }, drives: { current: { team: { id: '1' }, plays: [{ text: 'Structured play', type: { text: 'Rush' }, period: { number: 3 }, clock: { displayValue: '8:42' }, end: { team: { id: '1' }, down: 1, distance, yardsToEndzone: yards, yardLine: 999 } }] } } };
}
for (const [yards, ball, position] of [[78,22,'AAA 22'],[37,63,'BBB 37'],[50,50,'50'],[20,80,'BBB 20'],[1,99,'BBB 1']]) {
  test(`offense-relative field position ${position}; ignores ambiguous yardLine`, () => {
    const field = normalizeNflField(summary(yards));
    assert.equal(field.ball, ball); assert.equal(field.position, position);
    assert.equal(field.firstDown, yards <= 10 ? null : ball + 10);
  });
}
test('goal-to-go, down distance, clock and compact accessible LOS/first-down SVG', () => {
  let raw = summary(8,8); raw.drives.current.plays[0].end.down = 2;
  const goal = normalizeNflField(raw);
  assert.equal(goal.downDistance, '2nd & Goal'); assert.equal(goal.firstDown, null);
  const field = normalizeNflField(summary());
  assert.equal(field.clock, '8:42 Q3'); assert.equal(field.downDistance, '1st & 10');
  const markup = render(React.createElement(Field, { field }));
  assert.match(markup, /h-20/); assert.match(markup, /AAA possession/);
  assert.match(markup, /Solid: scrimmage/); assert.match(markup, /stroke-dasharray/);
  assert.match(markup, /Latest:/); assert.match(markup, /After latest play/);
  assert.equal(render(React.createElement(Field, { field: null })), '');
});
for (const [label, change] of [
  ['no explicit possession', s => s.header.competitions[0].competitors[0].possession = false],
  ['ambiguous possession', s => s.header.competitions[0].competitors[1].possession = true],
  ['possession changes before current drive', s => { s.header.competitions[0].competitors[0].possession = false; s.header.competitions[0].competitors[1].possession = true; }],
  ['turnover', s => s.drives.current.plays[0].isTurnover = true],
  ['touchdown', s => s.drives.current.plays[0].scoringPlay = true],
  ['PAT', s => s.drives.current.plays[0].type.text = 'Extra Point Good'],
  ['kickoff', s => s.drives.current.plays[0].type.text = 'Kickoff'],
  ['punt', s => s.drives.current.plays[0].type.text = 'Punt'],
  ['missing down', s => delete s.drives.current.plays[0].end.down],
  ['missing distance', s => delete s.drives.current.plays[0].end.distance],
  ['missing yards', s => delete s.drives.current.plays[0].end.yardsToEndzone],
  ['zero yards', s => s.drives.current.plays[0].end.yardsToEndzone = 0],
  ['quarter ended', s => s.drives.current.plays[0].type.text = 'End Period'],
  ['halftime', s => s.header.competitions[0].status.type.name = 'STATUS_HALFTIME'],
  ['pregame', s => s.header.competitions[0].status.type.state = 'pre'],
  ['final', s => s.header.competitions[0].status.type.completed = true],
  ['no current drive', s => { s.drives.previous = [s.drives.current]; delete s.drives.current; }],
]) test(`field hides safely: ${label}`, () => { const s = summary(); change(s); assert.equal(normalizeNflField(s), null); });
test('possession change with new drive normalizes both teams in same direction', () => {
  const s = summary(63); const c = s.header.competitions[0];
  c.competitors[0].possession = false; c.competitors[1].possession = true;
  s.drives.current.team.id = '2'; s.drives.current.plays[0].end.team.id = '2';
  const field = normalizeNflField(s);
  assert.equal(field.offense, 'BBB'); assert.equal(field.position, 'BBB 37'); assert.equal(field.ball, 37);
});

test('batched roster loader scopes league, week, Group teams and provider table; excludes synthetic D/ST', async () => {
  const calls = [];
  const data = {
    slates,
    lineups: [{ team_id: 10, lineup_players: [{ player_id: 1 }, { player_id: 2 }] }, { team_id: 20, lineup_players: [{ player_id: 3 }] }, { team_id: 999, lineup_players: [{ player_id: 4 }] }],
    teams: [{ id: 10, name: 'Owner A' }, { id: 20, name: 'Owner B' }],
    players_nfl: [{ id: 1, nfl_player_id: 123, position: 'QB' }, { id: 2, nfl_player_id: 100000001, position: 'D/ST' }, { id: 3, nfl_player_id: 456, position: 'WR' }],
  };
  const dbPath = require.resolve('../lib/supabaseAdmin.ts'); const old = require.cache[dbPath];
  require.cache[dbPath] = { exports: { supabaseAdmin: { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    return { select() { return this; }, eq(...args) { call.filters.push(args); return this; }, in(...args) { call.filters.push(args); return this; },
      then(resolve) { resolve({ data: data[table], error: null }); } };
  } } } };
  try {
    const { loadNflOwnership } = require('../lib/live-scores/nflOwnership.server.ts');
    const access = { context: { group: { id: 'A' }, team: { id: 10 } }, league: { id: 'nfl-A' } };
    const result = await loadNflOwnership(access, '2026-09-15T00:20Z');
    assert.deepEqual(result.players, { '123': { name: 'Owner A', isYou: true }, '456': { name: 'Owner B', isYou: false } });
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].filters, [['league_id','nfl-A'],['sport','nfl']]);
    assert.deepEqual(calls.find(c => c.table === 'lineups').filters, [['slate_id',1]]);
    assert.deepEqual(calls.find(c => c.table === 'teams').filters, [['group_id','A']]);
    assert.deepEqual(calls.find(c => c.table === 'players_nfl').filters, [['id',[1,2,3]]]);
    calls.length = 0; data.teams = [];
    const b = await loadNflOwnership({ context: { group: { id: 'B' } }, league: { id: 'nfl-B' } }, '2026-09-21T17:00Z');
    assert.deepEqual(b.players, {}); assert.equal(b.slateId, 2);
    calls.length = 0;
    const none = await loadNflOwnership(access, '2027-01-01T17:00Z');
    assert.equal(none.slateId, null); assert.deepEqual(none.players, {}); assert.equal(calls.length, 1);
  } finally { if (old) require.cache[dbPath] = old; else delete require.cache[dbPath]; }
});

function modalHarness(run) {
  const names = ['useState','useRef','useMemo','useCallback','useEffect'];
  const originals = Object.fromEntries(names.map(name => [name, React[name]]));
  const states = []; const refs = []; let cursor = 0, refCursor = 0;
  let effects = [], setters = [];
  React.useState = initial => { const i = cursor++; if (!(i in states)) states[i] = initial; const set = value => states[i] = typeof value === 'function' ? value(states[i]) : value; setters[i] = set; return [states[i], set]; };
  React.useRef = initial => refs[refCursor++] ??= { current: initial };
  React.useMemo = fn => fn(); React.useCallback = fn => fn; React.useEffect = fn => effects.push(fn);
  delete require.cache[require.resolve('../components/live-scores/GameCenterModal.tsx')];
  const Modal = require('../components/live-scores/GameCenterModal.tsx').default;
  const game = { espnEventId: '99', kickoffAt: '2026-09-13T17:00Z', status: 'in', awayTeam: { id: '1', displayName: 'AAA' }, homeTeam: { id: '2', displayName: 'BBB' } };
  const props = { game, apiBase: '/api/live-scores/nfl', fantasyScope: { groupId: 'A', leagueId: 'nfl-A' }, onClose() {} };
  const draw = (overrides = {}) => { cursor = 0; refCursor = 0; effects = []; return Modal({ ...props, ...overrides }); };
  return Promise.resolve().then(() => run({ states, draw, effects: () => effects, setters: () => setters })).finally(() => names.forEach(name => React[name] = originals[name]));
}
const detail = () => ({ eventId: '99', header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [{ id: '1', homeAway: 'away', team: { id:'1', abbreviation: 'AAA' } }, { id: '2', homeAway: 'home', team: { id:'2', abbreviation: 'BBB' } }] }] },
  ownership: { groupId: 'A', leagueId: 'nfl-A', slateId: 1, players: { '123': { name: 'Owner A', isYou: true }, '456': { name: 'Owner B', isYou: false } } },
  boxscore: { players: [{ team: { id: '1' }, statistics: [{ name: 'passing', labels: ['YDS'], athletes: [
    { athlete: { id: '123', displayName: 'Player One' }, stats: ['100'] },
    { athlete: { id: '456', displayName: 'Player Two' }, stats: ['200'] },
    { athlete: { id: '789', displayName: 'Player One' }, stats: ['300'] },
  ] }] }] },
});
test('actual Player Stats rows annotate stable IDs, preserve detail actions and synchronously reject other scopes/events/NCAA', () => modalHarness(({ states, draw, setters }) => {
  draw(); states[0] = 'stats'; states[1] = detail(); states[2] = false; states[5] = '1';
  const tree = draw(); const html = render(tree);
  assert.match(html, /Owner A · You/); assert.match(html, /Owner B/);
  assert.equal((html.match(/>Owner A · You</g) || []).length, 1); // Same name, different ID is unrostered.
  assert.match(html, /bg-sky-50/); assert.match(html, /role="button"/);
  for (const overrides of [{ fantasyScope: null }, { fantasyScope: { groupId:'B', leagueId:'nfl-B' } }, { apiBase:'/api/ncaa-pickem' }, { game: { espnEventId:'100', status:'in', awayTeam:{}, homeTeam:{} } }]) {
    assert.doesNotMatch(render(draw(overrides)), /Owner A|Owner B/);
  }
  function findRows(node) { if (!node) return []; if (Array.isArray(node)) return node.flatMap(findRows); return node.type === 'tr' && node.props.role === 'button' ? [node] : findRows(node.props?.children); }
  findRows(tree)[0].props.onClick(); assert.equal(states[7].id, '123');
}));
test('aborted Group A response cannot replace B or a later A response; one existing refresh request', () => modalHarness(async ({ states, draw, effects }) => {
  const oldFetch = global.fetch; const pending = [];
  global.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    draw(); const cleanupA = effects()[0]();
    assert.match(pending[0].url, /groupId=A/);
    cleanupA();
    draw({ fantasyScope: { groupId:'B', leagueId:'nfl-B' } }); const cleanupB = effects()[0]();
    pending[0].resolve(Response.json(detail())); await flush(); assert.equal(states[1], null);
    cleanupB(); draw(); const cleanupNewA = effects()[0]();
    pending[1].resolve(Response.json({ ...detail(), ownership: { groupId:'B', leagueId:'nfl-B', players: {} } })); await flush(); assert.equal(states[1], null);
    pending[2].resolve(Response.json(detail())); await flush(); assert.equal(states[1].ownership.groupId, 'A');
    assert.equal(pending.length, 3); assert.equal(pending[0].options.signal.aborted, true); cleanupNewA();
  } finally { global.fetch = oldFetch; }
}));

test('captured ESPN final stays hidden; recorded home and away yardsToEndzone normalize to the recorded spot', () => {
  const captured = require('./fixtures/nfl-field-401772936.json');
  assert.equal(normalizeNflField(captured), null);
  for (const drive of captured.drives.previous) {
    const replay = structuredClone(captured); const competition = replay.header.competitions[0];
    const play = drive.plays[0];
    // Explicit synthetic live envelope around an unchanged, captured provider play.
    competition.status = { type: { state:'in', name:'STATUS_IN_PROGRESS' }, period:play.period.number, displayClock:play.clock.displayValue };
    competition.competitors.forEach(team => team.possession = team.id === drive.team.id);
    replay.drives = { current: drive };
    assert.equal(normalizeNflField(replay).position, play.end.possessionText);
  }
});

test('NFL endpoint keeps one provider request, gates ownership by authorized client Group, and tolerates roster errors', async () => {
  const files = ['../lib/auth.ts','../lib/live-scores/access.ts','../lib/live-scores/nflOwnership.server.ts','../lib/live-scores/game-detail.ts','../app/api/live-scores/nfl/game-detail/route.ts'];
  const paths = files.map(file => require.resolve(file)); const saved = paths.map(p => require.cache[p]);
  const oldFetch = global.fetch; let providerCalls = 0, rosterCalls = 0, fail = false, allowed = true;
  const access = { context: { group: { id:'A' } }, league: { id:'nfl-A' } };
  require.cache[paths[0]] = { exports: { getCurrentUser: async () => ({ id:'user' }) } };
  require.cache[paths[1]] = { exports: { getNflLiveAccess: async () => allowed ? access : null } };
  require.cache[paths[2]] = { exports: { loadNflOwnership: async received => { rosterCalls++; assert.equal(received, access); if (fail) throw Error('Unavailable'); return detail().ownership; } } };
  delete require.cache[paths[3]]; delete require.cache[paths[4]];
  global.fetch = async url => { providerCalls++; assert.match(String(url), /\/nfl\/summary\?event=99$/); return Response.json(require('./fixtures/nfl-field-401772936.json')); };
  try {
    const { GET } = require('../app/api/live-scores/nfl/game-detail/route.ts');
    const request = group => { const url = new URL(`http://localhost/api/live-scores/nfl/game-detail?eventId=99&groupId=${group}`); return { url:String(url), nextUrl:url }; };
    let response = await GET(request('B')); assert.equal(response.status,200); assert.equal((await response.json()).ownership,undefined); assert.equal(rosterCalls,0); assert.equal(providerCalls,1);
    response = await GET(request('A')); let body = await response.json(); assert.equal(body.ownership.groupId,'A'); assert.equal(response.headers.get('cache-control'),'private, no-store'); assert.equal(body.field,null); assert.equal(providerCalls,2); assert.equal(rosterCalls,1);
    fail = true; response = await GET(request('A')); body = await response.json(); assert.equal(response.status,200); assert.equal(body.ownership,null); assert.ok(body.drives); assert.ok(body.header);
    allowed = false; response = await GET(request('A')); assert.equal(response.status,404); assert.equal(providerCalls,3);
  } finally { global.fetch = oldFetch; paths.forEach((p,i) => { if (saved[i]) require.cache[p] = saved[i]; else delete require.cache[p]; }); }
});
