/* Actual admin component and handlers over local HTTP with an in-memory database. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const { startPreview } = require('./helpers/nba-skins-admin-preview.cjs');

test('reverse lottery: mobile/desktop, no leaks or writes, sequential reveal, secure draw, persistence and reduced motion', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to the installed Playwright module',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch(process.env.NBA_SKINS_CHROMIUM_PATH ? { executablePath: process.env.NBA_SKINS_CHROMIUM_PATH } : {});
  try {
    for (const [width, motion] of [[360, 'no-preference'], [390, 'no-preference'], [390, 'reduce'], [1024, 'no-preference']]) {
      const preview = await startPreview(), page = await browser.newPage({ viewport: { width, height: width === 360 ? 800 : 844 }, reducedMotion: motion });
      const f = preview.fixture, errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        if (!route.request().url().startsWith(new URL(preview.url).origin)) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      await page.addInitScript(() => {
        window.lotteryRandomDraws = 0;
        const original = Crypto.prototype.getRandomValues;
        Crypto.prototype.getRandomValues = function (array) { window.lotteryRandomDraws++; return original.call(this, array); };
      });
      try {
        await page.goto(preview.url);
        await page.getByRole('button', { name: 'Initialize 2026-27 Draft Order', exact: true }).waitFor();
        assert.equal(await page.getByRole('combobox', { name: 'Selected NBA Skins season' }).inputValue(), '7');
        await page.getByRole('button', { name: 'Clear Draft Order', exact: true }).click();
        assert.deepEqual(await page.locator('select:not([aria-label])').evaluateAll(elements => elements.map(e => e.value)), ['', '', '', '']);
        await page.getByRole('button', { name: /Randomize Order/ }).click();
        await page.getByText('Order randomized! Ready for the reveal.', { exact: true }).waitFor();
        const main = page.locator('main'), rows = main.locator('li'), save = page.getByRole('button', { name: 'Initialize 2026-27 Draft Order', exact: true });
        const drawCount = await page.evaluate(() => window.lotteryRandomDraws);
        assert.ok(drawCount >= 3);
        const snapshot = await main.ariaSnapshot();
        for (const name of ['Andy', 'Josh', 'Jon', 'Mark']) {
          assert.doesNotMatch(await main.innerHTML(), new RegExp(`\\b${name}\\b`));
          assert.doesNotMatch(snapshot, new RegExp(`\\b${name}\\b`));
        }
        assert.equal(await page.locator('select,input').count(), 0);
        assert.equal(await save.isDisabled(), true);
        const randomize = page.getByRole('button', { name: /Randomize Order/ });
        assert.equal(await randomize.isDisabled(), true);
        assert.equal(await randomize.evaluate(el => getComputedStyle(el).animationName === 'none'), motion === 'reduce');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const bounds = await rows.last().boundingBox();
        assert.ok(bounds.y + bounds.height <= (width === 360 ? 800 : 844), 'all four slots fit in portrait');
        assert.ok((await page.getByRole('button', { name: 'Show Pick #4', exact: true }).boundingBox()).height >= 44);
        await page.getByRole('button', { name: 'Show Pick #1', exact: true }).evaluate(el => el.click());
        assert.equal(await main.getByText('???', { exact: true }).count(), 4);
        await page.screenshot({ path: `/tmp/nba-skins-lottery-${width}-${motion}-hidden.png` });
        assert.deepEqual(f.writes, []);
        for (const [index, pick] of [4, 3, 2, 1].entries()) {
          for (const other of [4, 3, 2, 1]) assert.equal(await page.getByRole('button', { name: `Show Pick #${other}`, exact: true }).isDisabled(), other !== pick);
          await page.getByRole('button', { name: `Show Pick #${pick}`, exact: true }).click();
          assert.equal(await main.getByText('???', { exact: true }).count(), 3 - index);
          const revealed = await rows.nth(index).locator('.lotteryName').innerText();
          assert.ok(['Andy', 'Josh', 'Jon', 'Mark'].includes(revealed));
          const visibleNames = await rows.locator('.lotteryName').allTextContents();
          for (const name of ['Andy', 'Josh', 'Jon', 'Mark'].filter(name => !visibleNames.includes(name))) {
            assert.doesNotMatch(await main.innerHTML(), new RegExp(`\\b${name}\\b`));
            assert.doesNotMatch(await main.ariaSnapshot(), new RegExp(`\\b${name}\\b`));
          }
          assert.equal(await rows.nth(index).locator('.lotteryName').evaluate(el => getComputedStyle(el).animationName === 'none'), motion === 'reduce');
          assert.deepEqual(f.writes, []);
          assert.equal(preview.requests.filter(r => r.method === 'PATCH').length, 0);
          if (pick > 1) {
            assert.equal(await save.isDisabled(), true);
            await save.evaluate(el => el.click());
          }
          if (pick === 4) {
            page.once('dialog', dialog => dialog.dismiss());
            await page.getByRole('button', { name: 'Restart lottery', exact: true }).click();
            assert.equal(await main.getByText('???', { exact: true }).count(), 3);
            assert.equal(await page.evaluate(() => window.lotteryRandomDraws), drawCount);
          }
        }
        await page.getByText('Draft order revealed!', { exact: true }).waitFor();
        const revealedNames = await rows.locator('.lotteryName').allTextContents();
        assert.equal(new Set(revealedNames).size, 4);
        const namesToId = new Map(f.tables.teams.map(t => [t.name, t.id]));
        const expected = [...revealedNames].reverse().map(name => namesToId.get(name));
        assert.equal(await page.evaluate(() => window.lotteryRandomDraws), drawCount, 'reveals never redraw');
        // An intervening lock must be rejected by the actual server guards, preserving the reveal.
        f.tables.nba_skins_seasons.find(s => s.id === 7).status = 'locked';
        await save.click();
        await page.getByRole('alert').waitFor();
        assert.deepEqual(f.writes, []);
        assert.deepEqual(await rows.locator('.lotteryName').allTextContents(), revealedNames);
        f.tables.nba_skins_seasons.find(s => s.id === 7).status = 'open';
        await save.click();
        await page.getByText('Saved order · verified after reload.', { exact: true }).waitFor();
        assert.deepEqual(await rows.locator('.lotteryName').allTextContents(), revealedNames);
        assert.deepEqual(preview.requests.filter(r => r.method === 'PATCH').at(-1).body.order.map(e => e.teamId), expected);
        assert.deepEqual(f.tables.nba_skins_draft_order.filter(o => o.season_id === 7).sort((a, b) => a.draft_position - b.draft_position).map(o => o.team_id), expected);
        assert.equal(await page.getByRole('button', { name: 'Clear Draft Order', exact: true }).isDisabled(), true);
        await page.screenshot({ path: `/tmp/nba-skins-lottery-${width}-${motion}-saved.png` });
        await page.reload();
        await page.getByRole('button', { name: 'Save 2026-27 Draft Order', exact: true }).waitFor();
        assert.deepEqual(await page.locator('select:not([aria-label])').evaluateAll(elements => elements.map(e => Number(e.value))), expected);
        assert.equal(await page.getByRole('button', { name: 'Clear Draft Order', exact: true }).isDisabled(), true);
        const before = structuredClone(f.tables), writes = f.writes.length;
        await page.getByRole('button', { name: /Randomize Order/ }).click();
        await page.getByText('Order randomized! Ready for the reveal.', { exact: true }).waitFor();
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Restart lottery', exact: true }).click();
        assert.equal(await page.locator('.lotteryName').filter({ hasText: '???' }).count(), 4);
        await page.getByRole('button', { name: 'Clear Draft Order', exact: true }).click();
        assert.deepEqual(await page.locator('select:not([aria-label])').evaluateAll(elements => elements.map(e => e.value)), ['', '', '', '']);
        assert.deepEqual(f.tables, before); assert.equal(f.writes.length, writes);
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
      } finally { await page.close(); await preview.close(); }
    }
  } finally { await browser.close(); }
});
