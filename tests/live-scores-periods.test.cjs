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

test('Live Scores initializes provider context once so manual week navigation survives refreshes', () => {
  for (const file of ['app/ncaa-pickem/scores/page.tsx', 'components/live-scores/NflLiveScores.tsx']) {
    const source = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    assert.match(source, /const \[initialized, setInitialized\] = useState\(false\)/);
    assert.match(source, /if \(!initialized\) \{[\s\S]*?setInitialized\(true\)/);
    assert.match(source, /initialized \? .*season=.*week=.*: .*scores/);
  }
});
