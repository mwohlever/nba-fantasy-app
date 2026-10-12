/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

test('isolated CFP simulator uses real components and updates entrants, states, winners and dependent rounds in Chromium', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.BRACKET_DEV_BROWSER_URL) && 'Set Playwright module and Dev URL for simulation interactions',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Block and record any unexpected real API access. A passing test requires there to be none.
      await page.route('**/api/**', route => { requests.push(route.request().url()); return route.fulfill({ status: 403, body: '{}' }); });
      await page.addInitScript(() => localStorage.setItem('simulation-group-sentinel', 'unchanged'));
      await page.goto(`${process.env.BRACKET_DEV_BROWSER_URL}/dev/cfp-simulation`);
      await page.getByText('SIMULATION — NOT REAL RESULTS', { exact: true }).waitFor();
      await page.getByText('River Rebels has a longer road in your bracket.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('combobox', { name: 'Viewing bracket' }).locator('option').count(), 5);
      assert.match(await page.getByLabel('CFP matchup').innerText(), /#8 River Rebels.*#9 Lake Lions/s);
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /20 more points depend on those later wins/);
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      await page.getByText('This simulation supplies bracket outcomes and scores only.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByText('This simulation supplies bracket outcomes and scores only.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Player Stats', exact: true }).click();
      await page.getByRole('button', { name: 'Implications', exact: true }).click();
      const bracket = page.getByRole('combobox', { name: 'Viewing bracket' });
      await bracket.selectOption('sim-master-2');
      await page.getByText('Jordan has River Rebels winning the whole thing.', { exact: true }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /championship pick is gone/);
      await bracket.selectOption('sim-master-3');
      await page.getByText('Casey has Lake Lions winning the whole thing.', { exact: true }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /championship pick is gone/);
      await bracket.selectOption('sim-master-4');
      await page.getByText('River Rebels is Taylor’s pick for this game, then Summit Eagles takes over.', { exact: true }).waitFor();
      await bracket.selectOption('sim-master-2');
      const state = page.getByRole('combobox', { name: 'Simulation game state' });
      await state.selectOption('live');
      await page.getByText('Nothing is settled yet.', { exact: false }).waitFor();
      assert.match(await page.getByLabel('CFP matchup').innerText(), /Live.*Q3.*14.*7/is);
      await state.selectOption('provider_final');
      await page.getByText('Official advancement is pending.', { exact: false }).waitFor();
      assert.match(await page.getByLabel('CFP matchup').innerText(), /Awaiting official result/i);
      assert.equal(await page.getByText('If River Rebels wins', { exact: true }).count(), 0);
      await page.getByRole('combobox', { name: 'Simulation contest lock', exact: true }).selectOption('after');
      await page.getByText('Jordan and Alex', { exact: false }).count();
      await page.getByRole('combobox', { name: 'Simulation winner' }).selectOption('sim-team-9');
      await state.selectOption('official_final');
      await page.locator('[data-story-kind="result_recap"] h2').filter({ hasText: 'Lake Lions won.' }).waitFor();
      assert.equal(await page.getByText('If River Rebels wins', { exact: true }).count(), 0);
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /140 points/);
      await page.getByRole('combobox', { name: 'Simulation winner' }).selectOption('sim-team-8');
      await page.locator('[data-story-kind="result_recap"] h2').filter({ hasText: 'River Rebels won.' }).waitFor();
      await page.getByRole('combobox', { name: 'Simulation game', exact: true }).selectOption('champ');
      await page.getByLabel('CFP matchup').getByText('TBD', { exact: true }).first().waitFor();
      assert.notEqual(await state.locator('option[value="official_final"]').getAttribute('disabled'), null);
      await page.getByRole('button', { name: 'Prepare legal feeder results from viewed picks', exact: true }).click();
      await page.getByLabel('CFP matchup').getByText('#8 River Rebels', { exact: true }).waitFor();
      await state.selectOption('official_final');
      await page.getByText('River Rebels are national champions.', { exact: true }).waitFor();
      // Correct an early result; the previously finalized championship must become unresolved again.
      await page.getByRole('combobox', { name: 'Simulation game', exact: true }).selectOption('r1-1');
      await page.getByRole('combobox', { name: 'Simulation winner' }).selectOption('sim-team-9');
      await page.getByRole('combobox', { name: 'Simulation game', exact: true }).selectOption('champ');
      await page.getByLabel('CFP matchup').getByText('TBD', { exact: true }).first().waitFor();
      assert.equal(await state.inputValue(), 'pregame');
      assert.equal(await page.getByText('River Rebels are national champions.', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
      await page.getByText('River Rebels has a longer road in your bracket.', { exact: true }).waitFor();
      assert.equal(await state.inputValue(), 'pregame');
      assert.equal(await bracket.inputValue(), 'sim-master-1');
      await page.getByRole('button', { name: 'Refresh game center', exact: true }).click();
      await page.getByText('River Rebels has a longer road in your bracket.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Back to games', exact: true }).click();
      await page.getByRole('region', { name: 'Simulation games' }).waitFor();
      await page.getByRole('button', { name: 'first round · Game 1', exact: true }).click();
      await page.getByText('River Rebels has a longer road in your bracket.', { exact: true }).waitFor();
      assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth));
      assert.equal(await page.evaluate(() => localStorage.getItem('simulation-group-sentinel')), 'unchanged');
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/bracket-phase1c-simulation-${width}.png`, fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});

test('production denies the simulator page, Next data request and nonexistent API directly', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.BRACKET_PRODUCTION_BROWSER_URL && process.env.BRACKET_PRODUCTION_BUILD_ID) && 'Set production URL/build ID for direct denial checks',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    for (const url of ['/dev/cfp-simulation', `/_next/data/${process.env.BRACKET_PRODUCTION_BUILD_ID}/dev/cfp-simulation.json`, '/api/dev/cfp-simulation']) {
      const response = await context.request.get(`${process.env.BRACKET_PRODUCTION_BROWSER_URL}${url}`);
      assert.equal(response.status(), 404, url);
    }
    const page = await context.newPage();
    const requests = [];
    await page.route('**/api/**', route => { requests.push(route.request().url()); return route.fulfill({ status: 403, body: '{}' }); });
    const response = await page.goto(`${process.env.BRACKET_PRODUCTION_BROWSER_URL}/dev/cfp-simulation`);
    assert.equal(response.status(), 404);
    await page.waitForTimeout(500);
    assert.equal(await page.getByText('SIMULATION — NOT REAL RESULTS', { exact: true }).count(), 0);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});
