/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);

const { currentFootballCompetitionPeriod } = require('../lib/live-scores/competitionPeriod.ts');

function scoreboard({ type = 2, week = 3 } = {}) {
  return {
    season: { year: 2026, type }, week: { number: week },
    leagues: [{ calendar: [{ value: '2', entries: [
      { value: '1', startDate: '2026-09-01T00:00Z', endDate: '2026-09-07T23:59Z' },
      { value: '2', startDate: '2026-09-08T00:00Z', endDate: '2026-09-14T23:59Z' },
      { value: '3', startDate: '2026-09-15T00:00Z', endDate: '2026-09-21T23:59Z' },
    ] }] }],
  };
}

test('NCAA and NFL initial football context uses the authoritative current regular-season week', () => {
  assert.deepEqual(currentFootballCompetitionPeriod(scoreboard()), { season: 2026, seasonType: 2, week: 3 });
});

test('uses the current scheduled regular-season week when the provider is outside that season type', () => {
  assert.deepEqual(
    currentFootballCompetitionPeriod(scoreboard({ type: 1, week: 1 }), 2, Date.parse('2026-09-17T12:00Z')),
    { season: 2026, seasonType: 2, week: 3 },
  );
});

test('NCAA Scores resolves the provider week once; manual URL week survives rerenders and reload', async () => {
  const { host, nodes } = require('./helpers/scores-harness.cjs');
  const { installViewingBrowser } = require('./helpers/viewing-browser.cjs');
  const Page = require('../app/ncaa-pickem/scores/page.tsx').default;
  const browser = installViewingBrowser('/ncaa-pickem/scores');
  const original = global.fetch, calls = [];
  global.fetch = async input => {
    const url = new URL(input, 'http://test'); calls.push(url);
    return { ok: true, json: async () => url.pathname.endsWith('/scores')
      ? { season: 2026, week: Number(url.searchParams.get('week') || 5), games: [] }
      : { teamIds: [] } };
  };
  const h = host(Page().props.children.type);
  async function settle() {
    let tree;
    for (let i = 0; i < 5; i++) { tree = h.render({}, true); await new Promise(resolve => setImmediate(resolve)); }
    return tree;
  }
  const weekControl = tree => nodes(tree).find(n => n.type === 'select' && nodes(n).some(option => option.type === 'option' && option.props.children?.includes('Week ')));
  try {
    let tree = await settle(); assert.equal(weekControl(tree).props.value, 5);
    weekControl(tree).props.onChange({ target: { value: '6' }, currentTarget: { blur() {} } });
    tree = await settle(); assert.equal(weekControl(tree).props.value, 6);
    h.remount({}, true); tree = await settle(); assert.equal(weekControl(tree).props.value, 6);
    assert.equal(calls.filter(url => url.pathname.endsWith('/scores') && !url.search).length, 1);
    assert.equal(calls.filter(url => url.pathname.endsWith('/scores')).at(-1).search, '?season=2026&week=6');
    assert.ok(browser.navigation.some(entry => entry.method === 'push' && entry.href.endsWith('season=2026&week=6')));
  } finally { h.unmount(); global.fetch = original; }
});

// NFL now persists the authoritative week in the URL rather than local initialization.
test('NFL calendar navigation uses URL state and resolves a missing context from the provider', () => {
  const source = fs.readFileSync('components/live-scores/NflLiveScores.tsx', 'utf8');
  assert.match(source, /useNflLiveUrl/);
  assert.match(source, /live.resolveCalendar\(calendar\)/);
  assert.match(source, /live.selectCalendar/);
  assert.doesNotMatch(source, /setWeek|setSeason|setInitialized/);
});
