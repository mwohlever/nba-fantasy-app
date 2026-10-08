/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}, globals = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: loaded, exports: loaded.exports, Response, Buffer, AbortController,
    setTimeout, clearTimeout, process: { env: {} }, console, ...globals,
    require(id) { if (id in mocks) return mocks[id]; throw Error(`Unexpected import: ${id}`); },
  });
  return loaded.exports;
}

for (const [file, methods] of [
  ['app/api/golf/hole-replay/route.ts', ['GET']],
  ['app/api/golf/shotcast-manifest/route.ts', ['GET']],
  ['app/api/admin/golf/shotcast/route.ts', ['GET', 'POST']],
]) {
  test(`${file} rejects all former access without acquiring data or writing scores`, async () => {
    // Any imported auth/database/provider or fetch fails, even for valid legacy URLs.
    const route = load(file, {}, { fetch() { throw Error('Retired endpoint fetched data'); } });
    for (const method of methods) for (const query of ['', '?slateId=1&playerId=7&round=1&hole=1&tournamentId=R2026013', '?slateId=invalid']) {
      const request = new Request(`http://localhost/${query}`, { method });
      const response = await route[method](request);
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { error: 'ShotCast has been discontinued.' });
    }
  });
}

test('replay assets, acquisition scripts and UI are removed from the main repository', () => {
  for (const file of ['components/lineups/GolfHoleMap2D.tsx', 'components/lineups/GolfHoleReplayPanel.tsx',
    'components/lineups/GolfInlineHoleReplayModal.tsx', 'components/platform/ProductShowcase.tsx',
    'scripts/import-shotcast-course.mjs', 'scripts/compare-live-golf-latency.mjs',
    'lib/providers/pgaTourShots.ts', 'lib/shotcast/importShotCastManifest.ts']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  const publicAssets = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? publicAssets(path.join(dir, entry.name)) : [path.join(dir, entry.name)]) : [];
  assert.equal(publicAssets(path.join(root, 'public/shotcast')).length, 0);
  assert.equal(JSON.parse(source('package.json')).scripts['import-shotcast-course'], undefined);
  for (const file of ['app/page.tsx', 'app/admin/slates/page.tsx', 'components/lineups/GolfPlayerModal.tsx',
    'components/lineups/GolfLeagueView.tsx', 'components/golf/GolfLivePage.tsx']) {
    assert.doesNotMatch(source(file), /shotcast|hole-replay|GolfHoleMap|GolfHoleReplay|tourcast|pga-tour-res\.cloudinary|cdn\.nba/i, file);
  }
});

test('manual and background refresh retain ESPN reconciliation without a PGA shot acquisition path', () => {
  const refresh = source('lib/golf/refreshSlate.server.ts');
  const worker = source('lib/golf/backgroundRefresh.server.ts');
  assert.match(refresh, /source: "espn" as const/);
  assert.match(refresh, /final: hole.strokes !== null && hole.relativeToPar !== null/);
  assert.match(refresh, /await reconcileGolf\(slateId/);
  assert.match(worker, /await refreshGolfSlate\(slateId, input, assertLease\)/);
  assert.doesNotMatch(refresh + worker, /ShotDetailsCompressedV3|fetchGolfRoundScorecard|pgaTourShots|shotcastObservation|shotcastFailures/);
  assert.equal(load('lib/golf/holeAcceptance.ts').shotcastObservation, undefined);
});

test('field imports retain 18 course pars and yardages without acquiring replay media', async () => {
  const calls = [];
  const provider = load('lib/providers/pgaTourCourse.ts', { '@/lib/providers/pgaTourField': {} }, {
    fetch: async (url, options) => {
      const request = JSON.parse(options.body); calls.push({ url, ...request });
      const data = request.operationName === 'LeaderboardHoleByHole'
        ? { leaderboardHoleByHole: { courses: [{ id: 'course-1', courseName: 'Fixture Course', hostCourse: true }],
          courseHoleHeaders: [{ courseId: 'course-1', holeHeaders: Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4 })) }] } }
        : { holeDetails: { holeInfo: { par: 4, yards: 400 + request.variables.hole } } };
      return new Response(JSON.stringify({ data }));
    },
  });
  const course = await provider.fetchPgaTourCourseMetadata({ tournamentId: 'R2026013' });
  assert.equal(course.holes.length, 18);
  assert.equal(course.holes[0].par, 4); assert.equal(course.holes[17].yards, 418);
  assert.equal(course.courseId, 'course-1');
  assert.equal(calls.length, 19);
  assert.ok(calls.every(call => call.url === 'https://orchestrator.pgatour.com/graphql'));
  assert.ok(calls.every(call => !/shotDetails|tourcast|image|pickle|pinGreen/i.test(call.query)));
  assert.match(source('app/api/admin/golf/import-field/route.ts'), /@\/lib\/providers\/pgaTourCourse/);
});
