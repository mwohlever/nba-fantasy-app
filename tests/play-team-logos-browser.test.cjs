/* eslint-disable @typescript-eslint/no-require-imports */
/* Chromium exercises real components with captured public ESPN data and mocked API responses. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const captured = require('./fixtures/play-team-logos.json');
const { normalizeNflGame } = require('../lib/providers/nflLiveScores.ts');
const { normalizeNcaaEspnEvent } = require('../lib/providers/ncaa.ts');
const { normalizeNbaGame } = require('../lib/providers/nbaLiveScores.ts');
const { normalizeNbaPlays } = require('../lib/live-scores/nbaPlays.ts');
const { footballPlaysByQuarter } = require('../lib/live-scores/football-plays.ts');
const { footballDisplayTeamId, nbaDisplayTeamId } = require('../lib/live-scores/playTeamLogo.ts');

function providerDetail(sport) {
  const data = captured[sport], competition = data.header.competitions[0];
  // The NCAA modal receives a normalized scoreboard event from the scores page.
  // Normalizing its summary header instead fabricates logos[] that runtime lacks.
  const event = sport === 'ncaa' ? data.scoreboardEvent : { ...data.header, date: competition.date };
  const game = sport === 'nfl' ? normalizeNflGame(event) : sport === 'ncaa' ? normalizeNcaaEspnEvent(event) : normalizeNbaGame(event);
  return { success: true, eventId: event.id, header: data.header, game, drives: data.drives,
    plays: sport === 'nba' ? normalizeNbaPlays(data.plays) : undefined,
    liveContext: { season: 2025, seasonType: 2, week: 3 }, boxscore: null };
}

test('PBP team logos: 360/390/desktop, original offense, neutral alignment, selection, refresh and shared consumers', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to the installed Playwright module',
}, async () => {
  const { chromium, request } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/game-center-browser-bundle.cjs')();
  const details = Object.fromEntries(['nfl', 'ncaa', 'nba'].map(sport => [sport, providerDetail(sport)]));
  // Use the supplied, real logo assets in screenshots. Application requests are
  // still intercepted; this test never authenticates or contacts app data services.
  const assets = new Map(), http = await request.newContext({ ignoreHTTPSErrors: true });
  for (const detail of Object.values(details)) for (const team of [detail.game.awayTeam, detail.game.homeTeam]) {
    if (process.env.PLAY_LOGO_ASSET_DIR) {
      const sport = detail === details.nfl ? 'nfl' : detail === details.ncaa ? 'ncaa' : 'nba';
      assets.set(team.logo, fs.readFileSync(path.join(process.env.PLAY_LOGO_ASSET_DIR, `${sport}-${team.id}.png`)));
    } else {
      const response = await http.get(team.logo);
      assert.ok(response.ok(), team.logo); assets.set(team.logo, await response.body());
    }
  }
  await http.dispose();
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1024]) for (const consumer of ['nfl', 'ncaa', 'nba', 'nba-skins', 'nfl-modal', 'bracket', 'nba-modal']) {
      const sport = consumer.startsWith('nba') ? 'nba' : ['ncaa', 'bracket'].includes(consumer) ? 'ncaa' : 'nfl';
      const detail = structuredClone(details[sport]), teams = [detail.game.awayTeam, detail.game.homeTeam];
      const checkPolling = width === 360 && (consumer === 'nfl' || consumer === 'nba');
      if (checkPolling) {
        detail.header.competitions[0].status.type.state = 'in';
        detail.header.competitions[0].status.type.completed = false;
        detail.game.status = 'in';
      }
      const modal = ['ncaa', 'nfl-modal', 'bracket', 'nba-modal'].includes(consumer);
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [], calls = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://a.espncdn.com/**', route => {
        const body = assets.get(route.request().url());
        return body ? route.fulfill({ contentType: 'image/png', body }) : route.abort();
      });
      await page.route('http://play-logos.test/**', route => {
        if (route.request().url().includes('/api/')) {
          calls.push(route.request().url());
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(detail) });
        }
        return route.fulfill({ contentType: 'text/html', body: `<style>${css.css}</style><main class="px-3 pb-24"><div id="app"></div></main><nav aria-label="Fixture bottom navigation" style="position:fixed;bottom:0;left:0;height:80px;width:100%;background:#101827;color:white">111 Sports</nav>` });
      });
      await page.goto('http://play-logos.test/game-center');
      await page.addScriptTag({ content: bundle });
      await page.evaluate(({ consumer, detail }) => {
        window.fixtureGroup = { isLoading: false, isSwitchingGroup: false, groupContext: {
          group: { id: 'fixture-group' }, leagues: ['nfl', 'nba', 'nba_skins'].map(sportKey => ({
            id: `fixture-${sportKey}`, sportKey, gameMode: 'standard', isEnabled: true,
          })),
        } };
        window.fixturePolls = [];
        const realSetInterval = window.setInterval.bind(window);
        window.setInterval = (callback, delay, ...args) => {
          if (delay === 15000) window.fixturePolls.push(callback);
          return realSetInterval(callback, delay, ...args);
        };
        window.centerRoot = ReactDOMClient.createRoot(document.getElementById('app'));
        window.centerState = { tab: 'pbp', period: 1 };
        const name = consumer === 'nba-skins' ? 'nba' : consumer;
        window.renderCenter = () => {
          const props = { game: detail.game, eventId: detail.eventId, viewerId: 'fixture-viewer',
            context: consumer === 'nba-skins' ? 'nba-skins' : 'nba',
            ...(consumer === 'nfl' || consumer === 'nba' || consumer === 'nba-skins' ? window.centerState : {}),
            onClose() {}, onBack() {}, onCalendar() {}, contestId: 'fixture-contest',
          };
          if (consumer === 'nfl') props.onDetailChange = change => { Object.assign(window.centerState, change); window.renderCenter(); };
          if (consumer === 'nba' || consumer === 'nba-skins') props.onTabChange = tab => { window.centerState.tab = tab; window.renderCenter(); };
          centerRoot.render(React.createElement(GameCenters[name], props));
        };
        renderCenter();
      }, { consumer, detail });
      if (modal) await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByRole('button', { name: 'Q1', exact: true }).first().click();
      const rows = page.locator('button:has([data-play-team-logo])');
      const expected = sport === 'nba' ? detail.plays.filter(p => p.period === 1).reverse()
        : footballPlaysByQuarter(detail.drives.previous).find(q => q.period === 1).plays;
      await rows.first().waitFor();
      assert.equal(await rows.count(), expected.length, `${consumer} ${width}: play count`);
      for (const [index, play] of expected.entries()) {
        const row = rows.nth(index);
        assert.ok((await row.innerText()).includes(play.text), `${consumer} ${index}: order`);
        const id = sport === 'nba' ? nbaDisplayTeamId(play, teams) : footballDisplayTeamId(play, teams);
        const image = row.locator('[data-play-team-logo] img');
        assert.equal(await image.count() ? await image.getAttribute('data-team-id') : null, id);
      }
      await page.waitForFunction(() => [...document.querySelectorAll('[data-play-team-logo] img')].every(img => img.complete && img.naturalWidth > 0));
      const geometry = await rows.evaluateAll(elements => elements.map(row => {
        const slot = row.querySelector('[data-play-team-logo]'), rail = row.querySelector('.w-14');
        const rect = slot.getBoundingClientRect();
        return { width: rect.width, height: rect.height, railWidth: rail?.getBoundingClientRect().width,
          overflow: row.scrollWidth > row.clientWidth + 1 };
      }));
      assert.ok(geometry.every(g => g.width === 20 && g.height === 20 && !g.overflow), `${consumer} ${width}: geometry`);
      if (sport !== 'nba') assert.ok(geometry.every(g => g.railWidth === 56), 'Original clock/down-distance rail');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal document overflow');
      const known = expected.findIndex(p => sport === 'nba' ? nbaDisplayTeamId(p, teams) : footballDisplayTeamId(p, teams));
      await rows.nth(known).evaluate(element => element.click());
      const replay = page.getByLabel(sport === 'nba' ? 'Selected play court' : 'Selected football play replay', { exact: true }).first();
      const selectedText = expected[known].text;
      await page.waitForFunction(text => document.querySelector('button.bg-sky-50:has([data-play-team-logo])')?.innerText.includes(text), selectedText);
      const selectedBefore = await page.locator('button.bg-sky-50:has([data-play-team-logo])').innerText();
      const refreshed = page.waitForResponse(response => response.url().includes('/game-detail?'));
      await page.getByRole('button', { name: 'Refresh game center', exact: true }).click();
      await refreshed;
      await page.waitForFunction(() => !document.querySelector('button[aria-label="Refresh game center"]')?.disabled);
      assert.equal(await page.locator('button.bg-sky-50:has([data-play-team-logo])').innerText(), selectedBefore);
      assert.equal(await rows.count(), expected.length);
      assert.equal(calls.length, 2, 'Initial detail + explicit refresh only');
      if (checkPolling) {
        assert.equal(await page.evaluate(() => window.fixturePolls.length), 1, 'Existing single 15s poll');
        const polled = page.waitForResponse(response => response.url().includes('/game-detail?'));
        await page.evaluate(() => window.fixturePolls[0]());
        await polled;
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Refresh game center"]')?.disabled);
        assert.equal(calls.length, 3, 'Existing automatic polling refresh');
        assert.equal(await page.locator('button.bg-sky-50:has([data-play-team-logo])').innerText(), selectedBefore);
        assert.equal(await rows.count(), expected.length);
      }
      assert.ok(calls.every(url => url.includes('/game-detail?')), 'No added team/provider request');
      assert.ok((await replay.innerText()).includes(selectedText));
      if (sport !== 'nba') {
        const interception = expected.findIndex(p => p.type.text === 'Pass Interception Return' || p.type.text === 'Interception Return Touchdown');
        if (interception >= 0) {
          const p = expected[interception];
          assert.notEqual(p.start.team.id, p.end.team.id);
          assert.equal(await rows.nth(interception).locator('[data-play-team-logo] img').getAttribute('data-team-id'), p.start.team.id);
        }
      }
      // Photograph the selected row with surrounding possession cues at its real width.
      if (process.env.PLAY_LOGO_SCREENSHOT_DIR && ['nfl', 'ncaa', 'nba', 'nba-skins'].includes(consumer)) {
        await rows.nth(known).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.PLAY_LOGO_SCREENSHOT_DIR, `${consumer}-${width}.png`) });
        const run = expected.findIndex((p, i) => i > 3 && i + 2 < expected.length &&
          (sport === 'nba' ? nbaDisplayTeamId(p, teams) : footballDisplayTeamId(p, teams)) &&
          [p, expected[i + 1], expected[i + 2]].every(next => (sport === 'nba' ? nbaDisplayTeamId(next, teams) : footballDisplayTeamId(next, teams)) ===
            (sport === 'nba' ? nbaDisplayTeamId(p, teams) : footballDisplayTeamId(p, teams))));
        assert.ok(run >= 0, 'Captured sequence of repeated team cues');
        await rows.nth(run).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.PLAY_LOGO_SCREENSHOT_DIR, `${consumer}-sequence-${width}.png`) });
      }
      const image = rows.nth(known).locator('[data-play-team-logo] img');
      const before = await rows.nth(known).boundingBox();
      await image.evaluate(img => img.dispatchEvent(new Event('error')));
      assert.equal(await image.evaluate(img => getComputedStyle(img).visibility), 'hidden');
      const after = await rows.nth(known).boundingBox();
      assert.equal(after.width, before.width); assert.equal(after.height, before.height);
      // Quarter filtering remains independent of logo eligibility.
      await page.getByRole('button', { name: 'Q2', exact: true }).first().evaluate(button => button.click());
      const second = sport === 'nba' ? detail.plays.filter(p => p.period === 2).reverse()
        : footballPlaysByQuarter(detail.drives.previous).find(q => q.period === 2).plays;
      await page.waitForFunction(count => document.querySelectorAll('button:has([data-play-team-logo])').length === count, second.length);
      for (const [index, play] of second.entries()) {
        assert.ok((await rows.nth(index).innerText()).includes(play.text), 'Second-quarter order');
        const image = rows.nth(index).locator('[data-play-team-logo] img');
        const id = sport === 'nba' ? nbaDisplayTeamId(play, teams) : footballDisplayTeamId(play, teams);
        assert.equal(await image.count() ? await image.getAttribute('data-team-id') : null, id);
      }
      if (sport !== 'nba') {
        const index = second.findIndex(play => play.type.text === 'Pass Interception Return' || play.type.text === 'Interception');
        if (index >= 0) {
          const play = second[index];
          assert.notEqual(play.start.team.id, play.end.team.id);
          assert.equal(await rows.nth(index).locator('[data-play-team-logo] img').getAttribute('data-team-id'), play.start.team.id);
          await rows.nth(index).evaluate(element => element.click());
          assert.ok((await replay.innerText()).includes(play.text));
          if (consumer === 'ncaa' && process.env.PLAY_LOGO_SCREENSHOT_DIR) {
            await rows.nth(index).scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(process.env.PLAY_LOGO_SCREENSHOT_DIR, `ncaa-interception-${width}.png`) });
          }
        }
      }
      await page.getByRole('button', { name: 'Q1', exact: true }).first().evaluate(button => button.click());
      await page.waitForFunction(count => document.querySelectorAll('button:has([data-play-team-logo])').length === count, expected.length);
      const scrollRoot = modal ? page.locator(sport === 'nba' ? '[data-nba-modal-scroll]' : '[data-game-center-scroll]') : null;
      if (scrollRoot) await scrollRoot.evaluate(element => { element.scrollTop = element.scrollHeight; });
      else await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);
      if (sport !== 'nba' || width < 640) {
        assert.ok(await page.locator('.sticky').count(), `${consumer}: compact replay still activates`);
        const sticky = await page.locator('.sticky').first().boundingBox();
        if (width < 640) assert.ok(sticky.y + sticky.height < 764, 'Sticky replay clears bottom navigation');
      } else assert.equal(await page.locator('.sticky').count(), 0, 'NBA desktop keeps its existing full court');
      if (width < 640) {
        const lastRow = await rows.last().boundingBox();
        assert.ok(lastRow.y + lastRow.height <= 764, `${consumer}: last row clears bottom navigation`);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${consumer} ${width}: ${expected.length} Q1 rows, 20px logos, original rail, order/filter/selection/refresh/scroll`);
      await page.close();
    }
  } finally { await browser.close(); }
});
