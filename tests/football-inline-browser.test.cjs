/* eslint-disable @typescript-eslint/no-require-imports */
/* Optional real-layout regression: set FOOTBALL_BROWSER_MODULE to an installed Playwright module.
 * Uses isolated components/provider fixtures, never an authenticated app or database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const fixture = require('./fixtures/nfl-field-401872948.json');

test('NCAA shared modal shows the full field, selections and container-scrolling compact replay', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE for Chromium layout regression',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setContent(`<style>${css.css}</style><main><div id="center"></div></main>`);
      await page.addScriptTag({ content: require('./helpers/football-browser-bundle.cjs')() });
      await page.evaluate(f => {
        const data = { ...f, gameStory: { headline: 'Fixture story', description: 'Long summary content. '.repeat(1000) } };
        window.fetch = async () => ({ ok: true, json: async () => data });
        window.root = ReactDOMClient.createRoot(document.getElementById('center'));
        root.render(React.createElement(NcaaGameCenter, { onClose() {}, game: {
          espnEventId: f.eventId, status: 'post', kickoffAt: f.header.competitions[0].date,
          awayTeam: { id: '2309', abbreviation: 'KENT' }, homeTeam: { id: '194', abbreviation: 'OSU' },
        } }));
      }, require('./fixtures/ncaa-field-401858454.json'));
      await page.getByText('Fixture story', { exact: true }).waitFor();
      await page.locator('[data-game-center-scroll]').evaluate(e => { e.scrollTop = 900; });
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      const fields = page.getByLabel('Selected football play replay', { exact: true });
      await fields.first().waitFor();
      await page.waitForTimeout(150);
      const fieldBox = await fields.first().boundingBox();
      const scrollBox = await page.locator('[data-game-center-scroll]').boundingBox();
      assert.ok(fieldBox.height > 184);
      assert.ok(fieldBox.y >= scrollBox.y && fieldBox.y < scrollBox.y + scrollBox.height, JSON.stringify({ width, fieldBox, scrollBox }));
      await page.getByRole('button', { name: 'Q1', exact: true }).click();
      const captured = require('./fixtures/ncaa-field-401858454.json');
      const scrimmage = captured.drives.previous.flatMap(d => d.plays).filter(p => p.period.number === 1 && p.type.text === 'Rush' && !p.isTurnover && p.start);
      const homePlay = scrimmage.find(p => p.start.team.id === '194'), awayPlay = scrimmage.find(p => p.start.team.id === '2309');
      await page.getByText(homePlay.text, { exact: true }).evaluate(e => e.click());
      await page.waitForTimeout(50); assert.ok((await fields.first().innerText()).includes(homePlay.text));
      assert.match(await fields.first().innerText(), /← OSU/);
      await page.locator('[data-game-center-scroll]').evaluate(e => { e.scrollTop = 900; });
      await page.waitForTimeout(150);
      assert.equal(await fields.count(), 2);
      assert.ok(Math.abs((await page.locator('.sticky').boundingBox()).y - scrollBox.y) < 1);
      await page.getByText(awayPlay.text, { exact: true }).last().evaluate(e => e.click());
      await page.waitForTimeout(50); assert.match(await fields.last().innerText(), /KENT →/);
      assert.ok((await fields.last().innerText()).includes(awayPlay.clock.displayValue));
      await page.locator('[data-game-center-scroll]').evaluate(e => { e.scrollTop = 0; });
      await page.waitForTimeout(150); assert.equal(await fields.count(), 1);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});

test('inline football compact field follows document scrolling, selections and return to the full field', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to run the real Chromium layout regression',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.setContent(`<style>${css.css}</style><main class="nfl-live-page px-3 py-5"><div style="height:180px">Matchup header fixture</div><div id="pbp"></div></main><nav style="position:fixed;bottom:0;height:80px;width:100%">Bottom navigation fixture</nav>`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: require('./helpers/football-browser-bundle.cjs')() });
      await page.evaluate(f => {
        // Repeat captured plays with fixture IDs to create enough list content to scroll.
        const plays = f.drives.flatMap(d => d.plays);
        window.fixture = { ...f, drives: [{ plays: Array.from({ length: 15 }, (_, i) => plays.map(p => ({ ...p, id: `${p.id}-${i}` }))).flat() }] };
        window.period = 1;
        window.root = ReactDOMClient.createRoot(document.getElementById('pbp'));
        window.renderPbp = () => root.render(React.createElement(FootballPbp, {
          presentation: 'inline', drives: fixture.drives, isLive: false, period,
          onPeriodChange: n => { window.period = n; renderPbp(); }, offenseNames: { '9': 'GB', '1': 'ATL' }, homeTeam: f.homeTeam, awayTeam: f.awayTeam,
        }));
        renderPbp();
      }, fixture);
      const fields = page.getByLabel('Selected football play replay', { exact: true });
      await fields.first().waitFor(); await page.waitForTimeout(100);
      assert.equal(await fields.count(), 1);
      await page.evaluate(() => scrollTo(0, 900)); await page.waitForTimeout(150);
      assert.equal(await fields.count(), 2);
      assert.equal(await page.locator('.sticky').evaluate(e => e.getBoundingClientRect().top), 0);
      const compactBounds = await page.locator('.sticky').boundingBox(), navBounds = await page.locator('nav').boundingBox();
      assert.ok(compactBounds.y + compactBounds.height < navBounds.y);
      // Clicking through the DOM preserves the current scroll position, as when selecting a visible row.
      await page.getByRole('button', { name: /J.Love pass/ }).first().evaluate(e => e.click());
      await page.waitForTimeout(50); assert.match(await page.locator('.sticky').innerText(), /← GB/);
      await page.getByRole('button', { name: 'Q2', exact: true }).evaluate(e => e.click());
      await page.waitForTimeout(100); assert.match(await page.locator('.sticky').innerText(), /Q2/);
      await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
      assert.equal(await fields.count(), 1); assert.equal(await page.locator('.sticky').count(), 0);
      // Reproduce the original mobile scroll ancestor without the NFL exception.
      if (width < 640) {
        await page.evaluate(() => { document.querySelector('main').classList.remove('nfl-live-page'); scrollTo(0, 900); });
        await page.waitForTimeout(150);
        assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).overflowY), 'auto');
        assert.ok(await page.locator('.sticky').evaluate(e => e.getBoundingClientRect().top < 0));
      }
      await page.close();
    }
  } finally { await browser.close(); }
});

// The signed-out framework check complements the loaded-week component test.
// It does not substitute for the user's authenticated NCAA regression QA.
test('NCAA signed-out initial load and navigation from NFL finish the Next render transition', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.NCAA_DEV_BROWSER_URL) && 'Set FOOTBALL_BROWSER_MODULE and NCAA_DEV_BROWSER_URL for the Next Dev lifecycle check',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/api/**', route => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method())
      ? route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }) : route.continue());
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const settled = async () => {
      await page.waitForFunction(() => document.body?.textContent.includes('Login required.'), {}, { timeout: 90000 });
      await page.waitForFunction(() => {
        const root = document.querySelector('nextjs-portal')?.shadowRoot;
        return root?.querySelector('[data-next-badge]')?.getAttribute('data-status') === 'none';
      }, {}, { timeout: 30000 });
      assert.doesNotMatch(await page.locator('body').innerText(), /Loading NCAA Pick/);
    };
    await page.goto(`${process.env.NCAA_DEV_BROWSER_URL}/ncaa-pickem`, { waitUntil: 'commit', timeout: 90000 });
    await settled();
    await page.evaluate(() => window.nd.router.push('/live-scores?sport=nfl'));
    await page.waitForFunction(() => location.pathname === '/live-scores' && document.body?.textContent.includes('Log in to view Live Scores.'), {}, { timeout: 90000 });
    await page.evaluate(() => window.nd.router.push('/ncaa-pickem'));
    await page.waitForFunction(() => location.pathname === '/ncaa-pickem');
    await settled(); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
