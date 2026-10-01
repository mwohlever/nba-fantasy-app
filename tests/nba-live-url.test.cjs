/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { parseNbaLiveState, nbaLiveHref, validNbaEventId, nbaEventDate, liveBackMatches } = require('../lib/live-scores/urlState.ts');
const { nbaDateKey, easternToday } = require('../lib/live-scores/nbaDate.ts');

test('Live dates validate the calendar and default to the Eastern day', () => {
  assert.equal(nbaDateKey('2026-02-29'), null); assert.equal(nbaDateKey('2026-04-31'), null);
  assert.equal(nbaDateKey('2028-02-29'), '20280229'); assert.equal(nbaDateKey('2026-5-25'), null);
  assert.equal(easternToday(new Date('2026-05-26T01:00:00Z')), '2026-05-25');
  for (const search of ['', 'date=no', 'date=2026-02-30']) {
    const state = parseNbaLiveState('nba', search, '2026-05-25');
    assert.equal(state.view, 'games'); assert.equal(state.date, '2026-05-25');
    assert.equal(nbaLiveHref(state), '/live-scores?sport=nba&date=2026-05-25');
  }
});

test('NBA URL round trips are context-specific and discard incompatible identifiers', () => {
  for (const context of ['nba', 'nba-skins']) {
    const state = parseNbaLiveState(context, 'date=2026-05-25&gameId=401811111&tab=stats&slateId=8&season=2025&groupId=old&sport=nfl&golferId=9');
    assert.deepEqual(state, { sport: 'nba', context, view: 'detail', date: '2026-05-25', gameId: '401811111', tab: 'stats' });
    const href = nbaLiveHref(state);
    assert.equal(href, `${context === 'nba' ? '/live-scores?sport=nba&' : '/nba-skins/live?'}date=2026-05-25&gameId=401811111&tab=stats`);
    assert.deepEqual(parseNbaLiveState(context, href.split('?')[1]), state);
  }
});

test('invalid game IDs select an error detail instead of silently choosing Games or another event', () => {
  for (const value of ['', 'bad', '12/34', '-123']) {
    const state = parseNbaLiveState('nba', `gameId=${encodeURIComponent(value)}&tab=unknown`, '2026-05-25');
    assert.equal(state.view, 'detail'); assert.equal(state.gameId, value); assert.equal(state.date, null);
    assert.equal(state.tab, 'summary'); assert.equal(validNbaEventId(state.gameId), false);
  }
  assert.equal(validNbaEventId('401123456'), true);
});

test('date-free deep links wait for the event Eastern date, never use today as the event date', () => {
  assert.equal(parseNbaLiveState('nba-skins', 'gameId=123').date, null);
  assert.equal(nbaEventDate({ competitions: [{ date: '2026-05-26T01:00:00Z' }] }), '2026-05-25');
  assert.equal(nbaEventDate({ competitions: [{ date: 'invalid' }] }), null);
});

test('Back uses history only for the corresponding overview, event, and viewer/Group/app scope', () => {
  const overview = '/live-scores?sport=nba&date=2026-05-25';
  const entry = { overview, gameId: '123', scope: 'viewer:group:league:nba' };
  assert.equal(liveBackMatches(entry, overview, '123', entry.scope), true);
  assert.equal(liveBackMatches(entry, overview, '456', entry.scope), false);
  assert.equal(liveBackMatches(entry, overview, '123', 'viewer:other:league:nba'), false);
  assert.equal(liveBackMatches(entry, overview, '123', 'other:group:league:nba'), false);
  assert.equal(liveBackMatches(entry, '/nba-skins/live?date=2026-05-25', '123', entry.scope), false);
  assert.equal(liveBackMatches(null, overview, '123', entry.scope), false);
});

test('future Live contract allows basketball/football standings, with Golf leaderboard and golfer detail only', () => {
  const filename = require.resolve('../lib/live-scores/urlState.ts');
  const checkFile = '/tmp/111-live-state-typecheck.ts';
  // Compile a virtual consumer alongside the real contract; no generated workspace files.
  const source = `import type { LiveState } from '${filename.replace(/\.ts$/, '')}';
const nba: LiveState = {sport:'nba',context:'nba-skins',view:'standings',leagueSeason:2026};
const nfl: LiveState = {sport:'nfl',context:'nfl',view:'standings',season:2025};
const golf: LiveState = {sport:'golf',context:'golf',view:'detail',tournamentId:'1',golferId:'2'};
// @ts-expect-error Golf does not have standings
const wrongGolf: LiveState = {sport:'golf',context:'golf',view:'standings',tournamentId:'1',season:2026};
// @ts-expect-error NFL cannot consume an NBA Skins context
const wrongContext: LiveState = {sport:'nfl',context:'nba-skins',view:'detail',gameId:'123',tab:'summary'};`;
  const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, types: [] };
  const compilerHost = ts.createCompilerHost(options);
  const read = compilerHost.readFile, exists = compilerHost.fileExists;
  compilerHost.readFile = file => file === checkFile ? source : read(file);
  compilerHost.fileExists = file => file === checkFile || exists(file);
  const program = ts.createProgram([checkFile], options, compilerHost);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
