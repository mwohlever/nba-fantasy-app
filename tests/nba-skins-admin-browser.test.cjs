/* Actual React page and API handlers in Chromium; every request stays in fixtures. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createFixture } = require('./helpers/nba-skins-admin-fixture.cjs');

test('Skins admin mobile/desktop: initialize, reorder, reload, explicit year and duplicate handling', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to the installed Playwright module',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/nba-skins-admin-browser-bundle.cjs')();
  const browser = await chromium.launch(process.env.NBA_SKINS_CHROMIUM_PATH ? { executablePath: process.env.NBA_SKINS_CHROMIUM_PATH } : {});
  try {
    for (const width of [390, 1024]) {
      const f = createFixture(), calls = [], errors = [];
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      let failSave = false, hideNewSeason = false;
      page.on('pageerror', error => errors.push(error.message));
      const document = `<html class="dark"><meta charset="utf-8"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`;
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        assert.equal(url.hostname, 'nba-skins-admin.test', 'No external requests');
        if (!url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: document });
        assert.equal(url.pathname, '/api/admin/nba-skins');
        calls.push({ method: request.method(), body: request.postData() && request.postDataJSON() });
        let response;
        if (request.method() === 'GET') {
          const data = await (await f.admin.GET()).json();
          if (hideNewSeason) data.seasons = data.seasons.filter(s => s.season !== 2028);
          response = Response.json(data);
        } else if (request.method() === 'PATCH') {
          response = failSave ? Response.json({ error: 'Fixture save failed.' }, { status: 500 })
            : await f.admin.PATCH(new Request(request.url(), { method: 'PATCH', body: request.postData() }));
        } else if (request.method() === 'POST') {
          hideNewSeason = false;
          response = await f.admin.POST(new Request(request.url(), { method: 'POST', body: request.postData() }));
        } else assert.fail('Unexpected mutation');
        return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      });
      await page.goto('http://nba-skins-admin.test/admin/nba-skins');
      const season = page.getByRole('combobox', { name: 'Selected NBA Skins season' });
      await season.waitFor();
      assert.equal(await page.getByRole('spinbutton').inputValue(), '');
      assert.equal(await page.getByRole('button', { name: 'Create Season', exact: true }).isDisabled(), true);
      await season.selectOption('7');
      await page.getByText('Not initialized.', { exact: true }).waitFor();
      await page.getByText('Proposed order (not saved):', { exact: false }).waitFor();
      const picks = page.locator('select:not([aria-label])');
      assert.equal(await picks.count(), 4);
      assert.equal(await picks.first().locator('option:not([disabled])').count(), 4);
      await picks.first().selectOption('4');
      await page.getByRole('spinbutton').fill('2026');
      await page.getByRole('button', { name: 'Initialize 2026-27 Draft Order', exact: true }).click();
      await page.getByText('2026-27 draft order saved and participants initialized.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('spinbutton').inputValue(), '2026');
      assert.equal(calls.find(c => c.method === 'PATCH').body.seasonId, 7);
      assert.equal(calls.find(c => c.method === 'PATCH').body.season, 2026);
      assert.deepEqual(await picks.evaluateAll(elements => elements.map(e => Number(e.value))), [4, 2, 3, 1]);
      await picks.first().selectOption('3');
      await page.getByRole('button', { name: 'Save 2026-27 Draft Order', exact: true }).click();
      await page.getByText('2026-27 draft order saved.', { exact: true }).waitFor();
      await page.reload();
      await season.waitFor(); await season.selectOption('7');
      assert.deepEqual(await picks.evaluateAll(elements => elements.map(e => Number(e.value))), [3, 2, 4, 1]);
      assert.equal(await page.getByRole('spinbutton').inputValue(), '');
      await page.getByRole('spinbutton').fill('2026');
      await page.getByRole('button', { name: 'Open 2026-27 Season', exact: true }).click();
      await page.getByText('2026-27 already exists. Configure its draft order above.', { exact: true }).waitFor();
      assert.equal(calls.filter(c => c.method === 'POST').length, 0);
      failSave = true;
      await page.getByRole('button', { name: 'Save 2026-27 Draft Order', exact: true }).click();
      await page.getByText('2026-27: Fixture save failed.', { exact: true }).waitFor();
      assert.equal(await season.inputValue(), '7');
      failSave = false;
      // Another admin creates a year after this page loaded. Its 409 must open that year.
      assert.equal((await f.create(2028)).status, 200);
      hideNewSeason = true;
      await page.getByRole('spinbutton').fill('2028');
      await page.getByRole('button', { name: 'Create 2028-29 Season', exact: true }).click();
      await page.getByText('2028-29 already exists. Configure its draft order above.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('spinbutton').inputValue(), '2028');
      assert.equal(calls.filter(c => c.method === 'POST').length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await season.selectOption('7');
      await page.getByRole('spinbutton').fill('2026');
      await page.screenshot({ path: `/tmp/nba-skins-admin-${width}.png`, fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});
