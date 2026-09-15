/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function loadTypeScriptModule(file, requireImpl = require) {
  const moduleUnderTest = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(file, 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      module: moduleUnderTest,
      exports: moduleUnderTest.exports,
      require: requireImpl,
      structuredClone,
    },
  );
  return moduleUnderTest.exports;
}

const rules = loadTypeScriptModule(
  path.join(__dirname, '../lib/rules/leagueRules.ts'),
);
const historicalFormat = loadTypeScriptModule(
  path.join(__dirname, '../lib/golf/historicalFormat.ts'),
  (moduleId) => {
    if (moduleId === '@/lib/rules/leagueRules') return rules;
    return require(moduleId);
  },
);
const json = (value) => JSON.parse(JSON.stringify(value));

test('Golf profile historical format defaults and matching keep game and draft axes independent', () => {
  assert.deepEqual(
    json(historicalFormat.resolveGolfHistoricalFormat(null)),
    { gameType: 'standard', draftType: 'snake' },
  );
  assert.deepEqual(
    json(historicalFormat.resolveGolfHistoricalFormat({
      gameType: 'best_ball',
      draft: { type: 'salary_cap' },
    })),
    { gameType: 'best_ball', draftType: 'salary_cap' },
  );
  assert.deepEqual(
    json(historicalFormat.resolveGolfHistoricalFormat({
      gameType: 'unexpected',
      draft: { type: 'unexpected' },
    })),
    { gameType: 'standard', draftType: 'snake' },
  );

  const standardSnake = null;
  const bestBallSalaryCap = {
    gameType: 'best_ball',
    draft: { type: 'salary_cap' },
  };

  assert.equal(
    historicalFormat.matchesGolfHistoricalFormat(standardSnake, {
      gameType: 'all',
      draftType: 'all',
    }),
    true,
  );
  assert.equal(
    historicalFormat.matchesGolfHistoricalFormat(standardSnake, {
      gameType: 'standard',
      draftType: 'all',
    }),
    true,
  );
  assert.equal(
    historicalFormat.matchesGolfHistoricalFormat(standardSnake, {
      gameType: 'all',
      draftType: 'salary_cap',
    }),
    false,
  );
  assert.equal(
    historicalFormat.matchesGolfHistoricalFormat(bestBallSalaryCap, {
      gameType: 'best_ball',
      draftType: 'salary_cap',
    }),
    true,
  );
  assert.equal(
    historicalFormat.matchesGolfHistoricalFormat(bestBallSalaryCap, {
      gameType: 'standard',
      draftType: 'salary_cap',
    }),
    false,
  );
});

test('Golf historical availability uses only qualifying snapshots and remains non-circular', () => {
  const activeStandardSnake = null;
  const activeBestBallSalaryCap = {
    gameType: 'best_ball',
    draft: { type: 'salary_cap' },
  };

  assert.deepEqual(
    json(historicalFormat.getGolfHistoricalFormatAvailability([
      activeStandardSnake,
    ])),
    {
      gameTypes: { standard: true, best_ball: false },
      draftTypes: { snake: true, salary_cap: false },
    },
  );

  const availability = json(
    historicalFormat.getGolfHistoricalFormatAvailability([
      activeStandardSnake,
      activeBestBallSalaryCap,
    ]),
  );
  assert.deepEqual(availability, {
    gameTypes: { standard: true, best_ball: true },
    draftTypes: { snake: true, salary_cap: true },
  });
  assert.equal(
    historicalFormat.matchesGolfHistoricalFormat(
      activeBestBallSalaryCap,
      { gameType: 'standard', draftType: 'all' },
    ),
    false,
  );
  assert.equal(
    availability.draftTypes.salary_cap,
    true,
    'a Standard selection does not suppress Salary Cap availability',
  );
});

test('Golf Profile Overview threads filters to the authoritative profile endpoint', () => {
  const page = fs.readFileSync(
    path.join(__dirname, '../app/profile/page.tsx'),
    'utf8',
  );
  const overview = fs.readFileSync(
    path.join(__dirname, '../components/profile/GolfProfileOverview.tsx'),
    'utf8',
  );

  assert.match(page, /golfGameType/);
  assert.match(page, /golfDraftType/);
  assert.match(page, /&gameType=\$\{golfGameType\}/);
  assert.match(page, /&draftType=\$\{golfDraftType\}/);
  assert.match(overview, /\n\s+Scoring\n/);
  assert.match(overview, /\n\s+Draft\n/);
  assert.match(overview, /Best Ball/);
  assert.match(overview, /Salary Cap/);
  assert.match(overview, /formatAvailability\?\.gameTypes\.best_ball === false/);
  assert.match(overview, /formatAvailability\?\.draftTypes\.salary_cap === false/);
  assert.doesNotMatch(overview, /Roster Period/);
});

test('Golf profile excludes archived slates and normalizes unavailable selections', () => {
  const profile = fs.readFileSync(
    path.join(__dirname, '../lib/profile/golfTeamProfile.ts'),
    'utf8',
  );
  const page = fs.readFileSync(
    path.join(__dirname, '../app/profile/page.tsx'),
    'utf8',
  );

  assert.match(profile, /\.is\("archived_at", null\)/);
  assert.match(profile, /matchesGolfHistoricalFormat\(/);
  assert.match(profile, /const historicalSlateIds = new Set/);
  assert.match(profile, /const completedSlateIds = new Set/);
  assert.match(profile, /getGolfHistoricalFormatAvailability\(/);
  assert.match(profile, /!completedSlateIds\.has\(/);
  assert.doesNotMatch(profile, /OLD TEST|display_name.*OLD/);
  assert.match(page, /setGolfGameType\("all"\)/);
  assert.match(page, /setGolfDraftType\("all"\)/);
});

test('Golf standings returns non-circular availability and disables unavailable controls', () => {
  const route = fs.readFileSync(
    path.join(__dirname, '../app/api/golf-standings/route.ts'),
    'utf8',
  );
  const page = fs.readFileSync(
    path.join(__dirname, '../components/standings/GolfStandingsPage.tsx'),
    'utf8',
  );

  assert.match(route, /\.is\("archived_at", null\)/);
  assert.match(route, /const contextSlates/);
  assert.match(route, /getGolfHistoricalFormatAvailability\(/);
  assert.match(route, /historicalFormatAvailability/);
  assert.match(route, /contextSlates\n\s+\.filter/);
  assert.doesNotMatch(route, /OLD TEST|display_name.*OLD/);
  assert.match(page, /formatAvailability\?\.gameTypes\.best_ball === false/);
  assert.match(page, /formatAvailability\?\.draftTypes\.salary_cap === false/);
  assert.match(page, /const nextGameType/);
  assert.match(page, /const nextDraftType/);
  assert.match(page, /setGameType\(nextGameType\)/);
  assert.match(page, /setDraftType\(nextDraftType\)/);
});

test('Golf Player History filters only league history and excludes archived slates', () => {
  const route = fs.readFileSync(
    path.join(__dirname, '../app/api/player-history/route.ts'),
    'utf8',
  );
  const page = fs.readFileSync(
    path.join(__dirname, '../app/player-history/page.tsx'),
    'utf8',
  );

  assert.match(route, /\.is\("archived_at", null\)/);
  assert.match(route, /matchesGolfHistoricalFormat\(/);
  assert.match(route, /getGolfHistoricalFormatAvailability\(/);
  assert.match(route, /historicalFormatAvailability/);
  assert.doesNotMatch(route, /OLD TEST|display_name.*OLD/);
  assert.match(page, /golf-history-scoring/);
  assert.match(page, /golf-history-draft/);
  assert.match(page, /historyMode === "league"/);
  assert.match(page, /&gameType=\$\{golfGameType\}/);
  assert.match(page, /&draftType=\$\{golfDraftType\}/);
  assert.match(page, /\/api\/player-season-stats\?season=\$\{season\}&sport=\$\{selectedSport\}/);
  assert.match(page, /golfFormatAvailability\?\.gameTypes\.best_ball ===/);
  assert.match(page, /golfFormatAvailability\?\.draftTypes\.salary_cap ===/);
  assert.match(page, /setGolfGameType\("all"\)/);
  assert.match(page, /setGolfDraftType\("all"\)/);
});
