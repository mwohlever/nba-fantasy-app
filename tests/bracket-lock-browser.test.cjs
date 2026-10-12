/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const sim = require('../lib/bracket/simulation.ts');
const enabled = process.env.FOOTBALL_BROWSER_MODULE && process.env.BRACKET_DEV_BROWSER_URL;

test('independent simulated contest lock controls privacy across pregame/live/provisional/official states in Chromium', { skip: !enabled && 'Set browser module and Dev URL' }, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const calls = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { calls.push(route.request().url()); return route.fulfill({ status: 403, body: '{}' }); });
      await page.goto(`${process.env.BRACKET_DEV_BROWSER_URL}/dev/cfp-simulation`);
      const lock = page.getByRole('combobox', { name: 'Simulation contest lock', exact: true });
      const state = page.getByRole('combobox', { name: 'Simulation game state', exact: true });
      const heading = page.locator('[data-bracket-implications] header h2');
      await heading.waitFor();
      assert.equal(await lock.inputValue(), 'before');
      await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).waitFor();
      await state.selectOption('live');
      await page.getByText('Privacy test: this simulated game state', { exact: false }).waitFor();
      await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).waitFor();
      assert.doesNotMatch(await page.locator('[data-story-kind]').innerText(), /Jordan|Casey|Taylor/);
      assert.equal(await lock.inputValue(), 'before');
      await lock.selectOption('after');
      await page.getByText('Casey’s championship pick would be gone.', { exact: false }).waitFor();
      assert.equal(await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).count(), 0);
      assert.equal(await state.inputValue(), 'live');
      await lock.selectOption('before');
      await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).waitFor();
      assert.doesNotMatch(await page.locator('[data-bracket-implications] header').innerText(), /Casey|Jordan|Taylor/);
      await page.getByRole('combobox', { name: 'Viewing bracket', exact: true }).selectOption('sim-master-2');
      await page.getByText('Jordan has River Rebels winning the whole thing.', { exact: true }).count();
      await lock.selectOption('after');
      await state.selectOption('provider_final');
      await page.getByText('Official advancement is pending.', { exact: false }).waitFor();
      assert.equal(await lock.inputValue(), 'after');
      assert.doesNotMatch(await page.locator('[data-story-kind]').innerText(), /Jordan earned|championship pick is out/);
      await page.getByRole('combobox', { name: 'Simulation winner', exact: true }).selectOption('sim-team-9');
      await state.selectOption('official_final');
      await heading.filter({ hasText: 'Lake Lions won. Jordan’s championship pick is out.' }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /140 points that had been possible/);
      assert.equal(await lock.inputValue(), 'after');
      // Artificial before-lock + official result is a privacy test, not a production lifecycle claim.
      await lock.selectOption('before');
      await heading.filter({ hasText: 'Lake Lions won. Jordan earned 0 points.' }).waitFor();
      assert.doesNotMatch(await page.locator('[data-bracket-implications] header').innerText(), /Alex|Casey|Taylor/);
      await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).waitFor();
      for (const preset of sim.simulationPresets) {
        await page.getByRole('combobox', { name: 'Simulation scenario', exact: true }).selectOption(preset.id);
        await heading.waitFor();
        assert.equal(await lock.inputValue(), 'after', preset.id);
      }
      await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
      await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).waitFor();
      assert.equal(await lock.inputValue(), 'before');
      assert.equal(await state.inputValue(), 'pregame');
      assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth));
      assert.deepEqual(calls, []); assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/bracket-phase1d1-lock-${width}.png`, fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});

test('production client discovers post-lock brackets without a selection, and ignores an older list snapshot', { skip: !enabled && 'Set browser module and Dev URL' }, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.clock.install();
    let locked = false, oldList = false, reopened = false, delayed = null;
    const state = sim.transitionSimulation(sim.initialSimulationState(), 'r1-1', 'live', 'sim-team-8');
    const provider = sim.simulationMatchup(state, 'r1-1').provider;
    const responseFor = (gameId, entryId, before) => {
      const data = sim.simulationResponse(state, gameId, entryId ? { entryId } : undefined, before);
      data.contestId = 'fixture'; data.subjects = before ? [] : data.subjects.map(row => ({ ...row, contestId: 'fixture', isAccountOwner: false }));
      if (data.subject) data.subject = { ...data.subject, contestId: 'fixture', isAccountOwner: false };
      data.contestLock.evaluatedAt = before ? reopened && !oldList ? '2026-01-03T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' : '2026-01-02T00:00:00.000Z';
      return data;
    };
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') return route.fulfill({ status: 403, body: '{}' });
      let body = {};
      if (url.pathname.endsWith('/live')) body = { contest: { id: 'fixture', status: 'open' }, competition: { id: 0, name: 'Lock fixture', season: 2026 },
        group: { id: 'fictional', name: 'Fixture Group' }, provider: { availability: 'available' }, rounds: [{ key: 'first_round', label: 'First round', order: 1 }],
        games: [{ ...sim.simulationMatchup(state, 'r1-1').matchup, officialStatus: 'scheduled', bracketGameId: 1, roundKey: 'first_round', roundOrder: 1, provider: { mappingState: 'valid', game: provider } }] };
      else if (url.pathname.endsWith('/game-detail')) body = { eventId: provider.espnEventId, header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] } };
      else if (url.pathname.endsWith('/implications')) {
        const id = Number(url.searchParams.get('entryId')), gameId = url.searchParams.get('gameId') ?? undefined;
        if (gameId && reopened) { delayed = { route, body: responseFor(gameId, id, false) }; return; }
        body = responseFor(gameId, id, gameId ? !locked : oldList || !locked);
      } else if (url.pathname === '/api/groups/context') body = { context: null, groups: [] };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${process.env.BRACKET_DEV_BROWSER_URL}/bracket-challenge/fixture/live?gameId=r1-1&tab=implications`);
    const selector = page.getByRole('combobox', { name: 'Viewing bracket', exact: true });
    await page.getByText('No viewable brackets are available yet.', { exact: true }).waitFor();
    assert.equal(await selector.locator('option').count(), 1);
    locked = true;
    // The provider is still LIVE and no subject is selected. Only the server's contest decision changes.
    await page.clock.runFor(21_000);
    await selector.locator('option[value="sim-master-2"]').waitFor({ state: 'attached' });
    assert.equal(await selector.locator('option').count(), 5);
    assert.equal(await selector.inputValue(), '');
    await selector.selectOption('sim-master-2');
    await page.locator('[data-story-kind] h2').filter({ hasText: 'River Rebels leads by 7.' }).waitFor();
    assert.equal(await page.getByText('Other brackets will be available once the contest locks.', { exact: true }).count(), 0);
    oldList = true;
    await page.clock.runFor(21_000);
    assert.equal(await selector.locator('option').count(), 5);
    assert.equal(await selector.inputValue(), 'sim-master-2');
    // A newer private decision hides the old Group story before a stale analysis can return.
    oldList = false; locked = false; reopened = true;
    await page.clock.runFor(21_000);
    await page.getByText('That bracket is unavailable or private.', { exact: false }).waitFor();
    assert.equal(await page.locator('[data-bracket-implications] header h2').count(), 0);
    if (delayed) await delayed.route.fulfill({ contentType: 'application/json', body: JSON.stringify(delayed.body) }).catch(() => undefined);
    assert.equal(await page.locator('[data-bracket-implications] header h2').count(), 0);
    await page.close();
  } finally { await browser.close(); }
});
