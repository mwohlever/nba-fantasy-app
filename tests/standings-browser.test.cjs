/* eslint-disable @typescript-eslint/no-require-imports */
/* Real Chromium layout/history tests with intercepted fixtures, no authenticated writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const { normalizeNbaStandings, normalizeNflStandings } = require('../lib/providers/proStandings.ts');
const { normalizeNcaaStandings } = require('../lib/providers/ncaaStandings.ts');
const fixture = name => require(`./fixtures/standings/${name}.json`);

test('standings mobile layout, Games navigation, history, reload, Group switching, errors and CFP distinctions', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to use the installed Playwright module',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/standings-browser-bundle.cjs')();
  const data = { nba: normalizeNbaStandings(fixture('nba-history')), nfl: normalizeNflStandings(fixture('nfl-current')),
    ncaa: normalizeNcaaStandings(fixture('ncaa-conferences'), fixture('ncaa-ap')) };
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1024]) for (const context of ['nba', 'nba-skins', 'nfl', 'ncaa']) {
      const sport = context === 'nba-skins' ? 'nba' : context;
      const pathname = context === 'nba-skins' ? '/nba-skins/live' : context === 'ncaa' ? '/ncaa-pickem/scores' : '/live-scores';
      const query = sport === 'nba' ? 'date=2026-05-25' : 'season=2025&seasonType=2&week=4';
      const initial = `http://standings.test${pathname}?${context === 'nba' || context === 'nfl' ? `sport=${sport}&` : ''}${query}&view=standings`;
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [], calls = []; let providerError = false;
      page.on('pageerror', e => errors.push(e.message));
      const html = `<html class="dark"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}
        window.fixtureGroup={groupContext:{group:{id:'a'},membership:{id:'membership-a',isActive:true},leagues:[{id:'league-a',sportKey:'${context === 'nba-skins' ? 'nba_skins' : sport === 'ncaa' ? 'ncaa_pickem' : sport}',gameMode:'standard',isEnabled:true}]},isLoading:false,isSwitchingGroup:false};
        window.root=ReactDOMClient.createRoot(document.getElementById('app')); window.renderPage=()=>root.render(React.createElement(LivePages['${sport}'],{viewerId:'viewer',context:'${context}'})); renderPage();</script></html>`;
      await page.route('http://standings.test/**', async route => {
        const url = route.request().url();
        if (url.includes('/api/')) {
          calls.push(url); const isStandings = url.includes('/standings') || url.includes('/live-standings');
          await route.fulfill({ status: isStandings && providerError ? 502 : 200, contentType: 'application/json', body: JSON.stringify(isStandings ? providerError ? { error: 'Provider unavailable' } : data[sport]
            : url.includes('/favorites') ? { teamIds: [] } : { season: 2025, seasonType: 2, week: 4, games: [], calendar: [] }) });
        } else await route.fulfill({ contentType: 'text/html', body: html });
      });
      await page.goto(initial);
      await page.getByRole('table').first().waitFor({ timeout: 10000 }).catch(e => { throw new Error(`${width}/${context}: ${errors.join('; ')}; ${e.message}`); });
      assert.equal(calls.filter(u => /\/scores[?]|\/game|ownership/.test(u)).length, 0);
      assert.equal(await page.locator('table tbody tr').count(), sport === 'nba' ? 15 : sport === 'nfl' ? 16 : 25);
      if (sport === 'ncaa') {
        await page.getByLabel('NCAA standings view').selectOption('conference:37');
        assert.equal(await page.getByRole('table').count(), 2);
        await page.getByLabel('NCAA standings view').selectOption('cfp');
        await page.getByText(/not been released/).waitFor(); assert.equal(await page.getByRole('table').count(), 0);
        await page.getByLabel('NCAA standings view').selectOption('conference:5');
      } else {
        await page.getByRole('button', { name: sport === 'nba' ? 'West' : 'NFC', exact: true }).click();
        if (sport === 'nfl') {
          await page.getByRole('button', { name: 'Playoffs', exact: true }).click();
          assert.equal(await page.locator('table tbody tr').count(), 32);
        }
      }
      const selectedUrl = page.url();
      assert.equal(calls.filter(u => /\/standings\?|\/live-standings\?/.test(u)).length, 1);
      await page.reload(); await page.getByRole('table').first().waitFor(); assert.equal(page.url(), selectedUrl);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).overflowY), 'visible');
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const lastRow = await page.locator('table tbody tr').last().boundingBox();
      if (width < 640) { const nav = await page.getByRole('navigation').boundingBox(); assert.ok(lastRow.y + lastRow.height < nav.y, JSON.stringify({ width, context, lastRow, nav })); }
      await page.getByRole('button', { name: 'Games', exact: true }).click(); await page.getByRole('button', { name: 'Standings', exact: true }).waitFor();
      assert.doesNotMatch(page.url(), /view=standings|standingsView|conference=/);
      await page.goBack(); await page.getByRole('table').first().waitFor(); assert.equal(page.url(), selectedUrl);
      await page.goForward(); assert.doesNotMatch(page.url(), /view=standings/);
      await page.getByRole('button', { name: 'Standings', exact: true }).click(); await page.getByRole('table').first().waitFor();
      await page.evaluate(() => { fixtureGroup.groupContext.group.id='b';fixtureGroup.groupContext.leagues[0].id='league-b';fixtureGroup.groupContext.membership.id='membership-b';renderPage(); });
      await page.waitForFunction(() => document.querySelector('table'));
      await page.waitForTimeout(50); assert.ok(calls.some(u => u.includes('groupId=b')));
      providerError = true;
      await page.getByRole('button', { name: 'Refresh standings', exact: true }).click(); await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /Showing the last loaded standings/);
      assert.deepEqual(errors, []);
      if (width === 390) await page.screenshot({ path: `/tmp/111-standings-${context}.png`, fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});
