/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');

test('distinct CFP scenario stories, live/provisional aftermath and final rankings update in real Chromium', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.BRACKET_DEV_BROWSER_URL) && 'Set Playwright module and local Dev URL',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { requests.push(route.request().url()); return route.fulfill({ status: 403, body: '{}' }); });
      await page.goto(`${process.env.BRACKET_DEV_BROWSER_URL}/dev/cfp-simulation`);
      const scenario = page.getByRole('combobox', { name: 'Simulation scenario', exact: true });
      const headline = page.locator('[data-bracket-implications] header h2');
      const header = page.locator('[data-story-kind]');
      const kinds = new Set(), headlines = new Set();
      const cases = [
        ['quiet', 'low_impact', 'Everyone picked River Rebels here.'],
        ['unanimous', 'consensus', 'The whole Group is with River Rebels on this one.'],
        ['unique', 'unique_champion', 'Jordan is the only one with River Rebels winning it all.'],
        ['shared', 'shared_dependency', 'You need River Rebels here. Jordan has even more riding on them.'],
        ['eliminated', 'eliminated_interest', 'Jordan is out of points here. Casey still has 94 riding on Lake Lions.'],
        ['upset', 'result_recap', 'Lake Lions won. Jordan’s championship pick is out.'],
        ['championship', 'personal_champion', 'You’ve got Summit Eagles winning the whole thing.'],
        ['complete', 'champion_recap', 'Harbor Bears are national champions.'],
      ];
      for (const [id, kind, text] of cases) {
        await scenario.selectOption(id);
        await headline.filter({ hasText: text }).waitFor();
        assert.equal(await header.getAttribute('data-story-kind'), kind);
        kinds.add(kind); headlines.add(await headline.innerText());
        if (id === 'quiet') {
          assert.equal(await page.getByRole('region', { name: 'Possible outcomes' }).count(), 0);
          assert.equal(await page.locator('[data-bracket-implications] article').count(), 0);
        }
        if (id === 'unanimous') assert.match(await page.locator('[data-bracket-implications]').innerText(), /picks part ways.*semifinal/);
        if (id === 'championship') assert.doesNotMatch(await page.locator('[data-bracket-implications]').innerText(), /finished.*#|shared first place/);
      }
      assert.ok(kinds.size >= 6); assert.equal(headlines.size, cases.length);
      await page.getByRole('region', { name: 'Championship recap' }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /Runner-up: Summit Eagles.*You finished tied #3.*Casey and Taylor shared first place/s);
      assert.equal(await page.locator('[data-bracket-implications] article').count(), 0);
      await page.getByRole('combobox', { name: 'Simulation winner', exact: true }).selectOption('sim-team-1');
      await headline.filter({ hasText: 'Summit Eagles are national champions.' }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /You picked the champion and earned 80 championship points.*You finished tied #1/s);
      await page.getByRole('combobox', { name: 'Viewing bracket', exact: true }).selectOption('sim-master-3');
      await page.getByText('Casey finished tied #3 on points with 200 points.', { exact: true }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /Casey had Harbor Bears/);
      await scenario.selectOption('unique');
      await headline.filter({ hasText: 'Jordan is the only one' }).waitFor();
      await page.getByRole('combobox', { name: 'Simulation game state', exact: true }).selectOption('live');
      await page.getByRole('combobox', { name: 'Simulation winner', exact: true }).selectOption('sim-team-9');
      await headline.filter({ hasText: 'Lake Lions leads by 7.' }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /If that holds.*championship pick would be gone.*Nothing is settled/s);
      await page.getByRole('combobox', { name: 'Simulation game state', exact: true }).selectOption('provider_final');
      await headline.filter({ hasText: 'Lake Lions finished ahead on the scoreboard.' }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /If the official result confirms it.*Official advancement is pending/s);
      assert.doesNotMatch(await page.locator('[data-bracket-implications]').innerText(), /Jordan earned|lost 140 possible/);
      await page.getByRole('combobox', { name: 'Simulation game state', exact: true }).selectOption('official_final');
      await headline.filter({ hasText: 'Lake Lions won. Jordan’s championship pick is out.' }).waitFor();
      assert.match(await page.locator('[data-bracket-implications]').innerText(), /140 points that had been possible/);
      assert.doesNotMatch(await page.locator('[data-bracket-implications]').innerText(), /140 points are still available|If Lake Lions wins/);
      await page.screenshot({ path: `/tmp/bracket-phase1d-aftermath-${width}.png`, fullPage: true });
      await scenario.selectOption('complete');
      await headline.filter({ hasText: 'Harbor Bears are national champions.' }).waitFor();
      await page.screenshot({ path: `/tmp/bracket-phase1d-complete-${width}.png`, fullPage: true });
      assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth));
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
