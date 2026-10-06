/* eslint-disable @typescript-eslint/no-require-imports */
/* Actual Next route and providers/components, not a separately bundled modal. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const routeData = require('./helpers/ncaa-game-center-route-data.cjs');
const { footballPlaysByQuarter } = require('../lib/live-scores/football-plays.ts');

test('actual NCAA scores route: Week 5 Ohio State @ Iowa logos survive scores → modal → PBP', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.NCAA_DEV_BROWSER_URL)
    && 'Set FOOTBALL_BROWSER_MODULE and NCAA_DEV_BROWSER_URL for the actual Next route',
}, async () => {
  const { chromium, request } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const { scores, detail } = await routeData();
  const game = scores.games.find(game => game.espnEventId === '401858473');
  const rawTeams = detail.header.competitions[0].competitors;
  const assets = new Map(), http = await request.newContext({ ignoreHTTPSErrors: true });
  for (const competitor of rawTeams) {
    const logo = competitor.team.logos[0].href;
    const response = await http.get(logo);
    assert.ok(response.ok()); assets.set(logo, await response.body());
  }
  await http.dispose();
  const group = { group: { id: 'qa-group', slug: 'qa-group', name: 'QA Group', isActive: true },
    membership: { id: 'qa-membership', role: 'member', isActive: true },
    team: { id: 1, name: 'QA Team', displayOrder: 1 },
    leagues: [{ id: 'qa-ncaa', sportKey: 'ncaa_pickem', gameMode: 'standard', name: 'NCAA', slug: 'ncaa', isEnabled: true, settingsVersion: 1, settings: {} }],
    isGroupAdmin: false, isSuperAdmin: false, canAdministerGroup: false,
  };
  const drives = [...detail.drives.previous, ...(detail.drives.current ? [detail.drives.current] : [])];
  const quarters = footballPlaysByQuarter(drives);
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [], calls = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('111-fantasy-sport', 'ncaa');
        localStorage.setItem('111-fantasy-theme', 'light');
        localStorage.setItem('111-push-reminder-dismissed', 'true');
      });
      // All app API traffic is intercepted, including heartbeat writes. Score
      // and detail bodies come from the real GET handlers, never summary-derived games.
      await page.route('**/api/**', route => {
        const url = new URL(route.request().url()); calls.push({ path: url.pathname, search: url.search, method: route.request().method() });
        const body = url.pathname === '/api/ncaa-pickem/scores' ? scores
          : url.pathname === '/api/ncaa-pickem/game-detail' ? detail
          : url.pathname === '/api/groups/context' ? { context: group, groups: [{ id: group.group.id, slug: group.group.slug, name: group.group.name, role: 'member', isActive: true }] }
          : url.pathname === '/api/me' ? { success: true, authenticated: true, user: { id: 'qa-user', teamId: 1, displayName: 'QA', role: 'player', avatarUrl: null }, groupContext: group }
          : url.pathname === '/api/ncaa-pickem/favorites' ? { teamIds: [] }
          : { success: true, preferences: { notificationsEnabled: false } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.route('https://a.espncdn.com/**', route => assets.has(route.request().url())
        ? route.fulfill({ contentType: 'image/png', body: assets.get(route.request().url()) }) : route.abort());
      const url = `${process.env.NCAA_DEV_BROWSER_URL.replace(/\/$/, '')}/ncaa-pickem/scores?season=2026&week=5`;
      await page.goto(url);
      const card = page.getByRole('button').filter({ hasText: 'Ohio State' }).filter({ hasText: 'Iowa' });
      await card.waitFor(); await card.click();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByRole('button', { name: 'Q4', exact: true }).first().click();
      const rows = page.locator('button:has([data-play-team-logo])'), root = page.locator('[data-game-center-scroll]');
      const fourth = quarters.find(quarter => quarter.period === 4).plays;
      await page.waitForFunction(count => document.querySelectorAll('button:has([data-play-team-logo])').length === count, fourth.length);
      if (process.env.PLAY_LOGO_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.PLAY_LOGO_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.PLAY_LOGO_SCREENSHOT_DIR, `ncaa-week5-q4-${width}.png`) });
      }
      // Positive, independent expectations: never accept 'all blank' just because
      // the helper or a fabricated summary-derived team says the same thing.
      for (const team of [game.awayTeam, game.homeTeam]) {
        const indices = fourth.flatMap((play, index) => play.start?.team?.id === team.id &&
          ['Rush', 'Pass Reception', 'Pass Incompletion', 'Sack'].includes(play.type.text) ? [index] : []);
        assert.ok(indices.length, `Captured Q4 offensive plays for ${team.id}`);
        for (const index of indices) {
          const row = rows.nth(index);
          assert.equal(await row.locator('[data-play-team-logo] img').count(), 1, `Missing ${team.id} logo on ${fourth[index].id}`);
          assert.equal(await row.locator('[data-play-team-logo] img').getAttribute('data-team-id'), team.id);
          assert.equal(await row.locator('[data-play-team-logo] img').getAttribute('src'), rawTeams.find(c => c.team.id === team.id).team.logos[0].href);
        }
      }
      for (const [index, play] of fourth.entries()) {
        assert.ok((await rows.nth(index).innerText()).includes(play.text), 'Provider ordering retained');
        if (['Timeout', 'Kickoff', 'Penalty', 'End Period', 'End of Game'].includes(play.type.text)) {
          assert.equal(await rows.nth(index).locator('[data-play-team-logo] img').count(), 0, play.type.text);
        }
      }
      assert.ok(fourth.some(play => play.type.text === 'Timeout'));
      const offense = fourth.findIndex(play => play.type.text === 'Rush' && play.start.team.id === '194');
      await rows.nth(offense).evaluate(row => row.click());
      await page.waitForFunction(text => document.querySelector('button.bg-sky-50:has([data-play-team-logo])')?.innerText.includes(text), fourth[offense].text);
      assert.ok((await page.getByLabel('Selected football play replay', { exact: true }).first().innerText()).includes(fourth[offense].text));
      await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(150);
      assert.equal(await page.getByLabel('Selected football play replay', { exact: true }).count(), 2);
      const sticky = await page.locator('[data-game-center-scroll] .sticky').boundingBox();
      const scroll = await root.boundingBox();
      assert.ok(Math.abs(sticky.y - scroll.y) < 1, 'Modal sticky replay');
      await page.getByRole('button', { name: 'Q1', exact: true }).first().evaluate(button => button.click());
      const first = quarters.find(quarter => quarter.period === 1).plays;
      await page.waitForFunction(count => document.querySelectorAll('button:has([data-play-team-logo])').length === count, first.length);
      const ordinary = first.flatMap((play, index) => ['Rush', 'Pass Reception', 'Pass Incompletion'].includes(play.type.text) ? [{ play, index }] : []);
      assert.ok(ordinary.some((entry, index) => index && entry.play.start.team.id !== ordinary[index - 1].play.start.team.id), 'Captured possession changes');
      for (const { play, index } of ordinary) assert.equal(await rows.nth(index).locator('[data-play-team-logo] img').getAttribute('data-team-id'), play.start.team.id);
      if (process.env.PLAY_LOGO_SCREENSHOT_DIR) {
        const iowa = ordinary.find(entry => entry.play.start.team.id === '2294');
        await rows.nth(iowa.index).evaluate(row => row.click());
        await page.waitForFunction(text => document.querySelector('button.bg-sky-50:has([data-play-team-logo])')?.innerText.includes(text), iowa.play.text);
        assert.ok((await page.getByLabel('Selected football play replay', { exact: true }).first().innerText()).includes(iowa.play.text));
        await rows.nth(iowa.index).scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        await rows.nth(iowa.index).evaluate(row => {
          const root = row.closest('[data-game-center-scroll]');
          const sticky = root.querySelector('.sticky');
          const target = root.getBoundingClientRect().top + (sticky?.getBoundingClientRect().height || 0) + 12;
          root.scrollTop += row.getBoundingClientRect().top - target;
        });
        await page.screenshot({ path: path.join(process.env.PLAY_LOGO_SCREENSHOT_DIR, `ncaa-week5-iowa-${width}.png`) });
      }
      // Settle the quarter's selected-play effect before resetting its scroll anchor.
      await page.waitForFunction(() => [...document.querySelectorAll('button:has([data-play-team-logo])')].some(row => row.classList.contains('bg-sky-50')));
      await root.evaluate(async element => {
        element.scrollTop = 0;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        element.scrollTop = 0;
      });
      await page.waitForFunction(() => document.querySelectorAll('[aria-label="Selected football play replay"]').length === 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await root.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.waitForFunction(() => [...document.querySelectorAll('[data-play-team-logo] img')].every(image => image.complete && image.naturalWidth > 0));
      assert.ok(calls.some(call => call.path === '/api/ncaa-pickem/scores' && call.search === '?season=2026&week=5'));
      const detailCalls = calls.filter(call => call.path === '/api/ncaa-pickem/game-detail');
      // Next Dev Strict Mode may issue an aborted mount probe before the real GET.
      assert.ok(detailCalls.length >= 1 && detailCalls.length <= 2);
      assert.ok(detailCalls.every(call => call.search === '?eventId=401858473'));
      assert.ok(page.url().includes('/ncaa-pickem/scores?season=2026&week=5'), 'Navigation unchanged');
      assert.deepEqual(errors, []);
      console.log(`PASS actual Next NCAA Week 5 ${width}: OSU/Iowa logos, exclusions, possession changes, selection, quarters, modal/sticky scrolling`);
      await page.close();
    }
  } finally { await browser.close(); }
});
