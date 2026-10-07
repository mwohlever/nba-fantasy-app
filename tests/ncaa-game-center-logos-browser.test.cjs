/* eslint-disable @typescript-eslint/no-require-imports */
/* Actual Next route and providers/components, not a separately bundled modal. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const routeData = require('./helpers/ncaa-game-center-route-data.cjs');
const { footballPlaysByQuarter } = require('../lib/live-scores/football-plays.ts');

test('actual NCAA scores route: Week 5 Ohio State @ Iowa logos survive scores → inline → PBP + navigation lifecycle', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.NCAA_DEV_BROWSER_URL)
    && 'Set FOOTBALL_BROWSER_MODULE and NCAA_DEV_BROWSER_URL for the actual Next route',
}, async () => {
  const { chromium, request } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const { scores, detail, secondDetail } = await routeData({ includeSecondGame: true });
  const secondGame = scores.games.find(game => game.espnEventId === secondDetail.eventId);
  const game = scores.games.find(game => game.espnEventId === '401858473');
  const rawTeams = detail.header.competitions[0].competitors;
  const assets = new Map(), http = await request.newContext({ ignoreHTTPSErrors: true });
  for (const competitor of [...rawTeams, ...secondDetail.header.competitions[0].competitors]) {
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
      let activeGroup = group;
      const secondGroup = { ...group, group: { ...group.group, id: 'qa-group-b', slug: 'qa-group-b', name: 'QA Group B' }, membership: { ...group.membership, id: 'qa-member-b' }, leagues: group.leagues.map(league => ({ ...league, id: 'qa-ncaa-b' })) };
      const groups = [group, secondGroup].map(g => ({ id: g.group.id, slug: g.group.slug, name: g.group.name, role: 'member', isActive: true }));
      // All app API traffic is intercepted, including heartbeat writes. Score
      // and detail bodies come from the real GET handlers, never summary-derived games.
      await page.route('**/api/**', route => {
        const url = new URL(route.request().url()); calls.push({ path: url.pathname, search: url.search, method: route.request().method() });
        if (url.pathname === '/api/groups/active') activeGroup = route.request().postDataJSON().groupSlug === secondGroup.group.slug ? secondGroup : group;
        const body = url.pathname === '/api/ncaa-pickem/scores' ? { ...scores, season: Number(url.searchParams.get('season') || 2026), week: Number(url.searchParams.get('week') || 5), games: url.searchParams.get('week') === '6' || url.searchParams.get('season') === '2025' ? [] : scores.games }
          : url.pathname === '/api/ncaa-pickem/game-detail' ? (url.searchParams.get('eventId') === secondDetail.eventId ? secondDetail : detail)
          : url.pathname === '/api/groups/context' ? { context: activeGroup, groups }
          : url.pathname === '/api/me' ? { success: true, authenticated: true, user: { id: 'qa-user', teamId: 1, displayName: 'QA', role: 'player', avatarUrl: null }, groupContext: activeGroup }
          : url.pathname === '/api/ncaa-pickem/favorites' ? { teamIds: [] }
          : { success: true, preferences: { notificationsEnabled: false } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.route('https://a.espncdn.com/**', route => assets.has(route.request().url())
        ? route.fulfill({ contentType: 'image/png', body: assets.get(route.request().url()) }) : route.abort());
      const url = `${process.env.NCAA_DEV_BROWSER_URL.replace(/\/$/, '')}/ncaa-pickem/scores?season=2026&week=5`;
      await page.goto(url);
      const card = page.getByRole('button').filter({ hasText: 'Ohio State' }).filter({ hasText: 'Iowa' });
      await card.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Back to games', exact: true }).count(), 0);
      await card.click();
      await page.getByRole('button', { name: 'Back to games', exact: true }).waitFor();
      assert.equal(await page.locator('[data-game-center-scroll]').count(), 0, 'No modal scroll container');
      assert.equal(await page.getByRole('button', { name: 'Close game center' }).count(), 0);
      assert.ok(page.url().includes('gameId=401858473'));
      assert.ok((await page.locator('main').innerText()).includes(game.shortName || game.name));
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByRole('button', { name: 'Q4', exact: true }).first().click();
      const rows = page.locator('button:has([data-play-team-logo])'), root = page.locator('main.ncaa-live-page');
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
      await page.evaluate(() => scrollTo(0, 900));
      await page.waitForTimeout(150);
      assert.equal(await page.getByLabel('Selected football play replay', { exact: true }).count(), 2);
      const sticky = await page.locator('main.ncaa-live-page .sticky').boundingBox();
      assert.ok(Math.abs(sticky.y) < 1, JSON.stringify({ sticky, layout: await page.evaluate(() => ({ scrollY, height: document.documentElement.scrollHeight, nodes: [...document.querySelectorAll('html,body,main')].map(e => [e.tagName, getComputedStyle(e).overflowX, getComputedStyle(e).overflowY]) })) }));
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
          const sticky = document.querySelector('main.ncaa-live-page .sticky');
          const target = (sticky?.getBoundingClientRect().height || 0) + 12;
          scrollBy(0, row.getBoundingClientRect().top - target);
        });
        await page.screenshot({ path: path.join(process.env.PLAY_LOGO_SCREENSHOT_DIR, `ncaa-week5-iowa-${width}.png`) });
      }
      // Settle the quarter's selected-play effect before resetting its scroll anchor.
      await page.waitForFunction(() => [...document.querySelectorAll('button:has([data-play-team-logo])')].some(row => row.classList.contains('bg-sky-50')));
      await page.evaluate(async () => {
        scrollTo(0, 0);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        scrollTo(0, 0);
      });
      await page.waitForFunction(() => document.querySelectorAll('[aria-label="Selected football play replay"]').length === 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await root.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.waitForFunction(() => [...document.querySelectorAll('[data-play-team-logo] img')].every(image => image.complete && image.naturalWidth > 0));
      assert.ok(calls.some(call => call.path === '/api/ncaa-pickem/scores' && call.search === '?season=2026&week=5'));
      const detailCalls = calls.filter(call => call.path === '/api/ncaa-pickem/game-detail');
      // Next Dev Strict Mode may issue an aborted mount probe before the real GET.
      assert.ok(detailCalls.length >= 1 && detailCalls.length <= 3);
      assert.ok(detailCalls.every(call => call.search === '?eventId=401858473'));
      assert.ok(page.url().includes('/ncaa-pickem/scores?season=2026&week=5&gameId=401858473'));
      // Actual Next URL controller: tab changes replace the detail history entry.
      await page.getByRole('button', { name: 'Player Stats', exact: true }).click();
      await page.waitForURL(/tab=stats/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Stats fits mobile');
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      await page.getByRole('button', { name: 'Refresh game center' }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh game center"]').disabled);
      assert.ok(page.url().includes('gameId=401858473'), 'Refresh retains inline detail');
      console.log(`NCAA ${width}: replay/logos/tabs/refresh verified; starting history`);
      const detailUrl = page.url();
      await page.getByRole('button', { name: 'Back to games', exact: true }).click();
      await card.waitFor(); assert.equal(new URL(page.url()).searchParams.has('gameId'), false);
      const secondCard = page.getByRole('button').filter({ hasText: secondGame.awayTeam.displayName }).filter({ hasText: secondGame.homeTeam.displayName });
      await secondCard.click(); await page.getByRole('button', { name: 'Summary', exact: true }).waitFor();
      assert.ok(page.url().includes(`gameId=${secondDetail.eventId}`));
      assert.ok((await page.locator('main').innerText()).includes(secondGame.shortName || secondGame.name));
      await page.goBack(); await card.waitFor();
      await page.goForward(); await page.getByRole('button', { name: 'Back to games', exact: true }).waitFor();
      console.log(`NCAA ${width}: Back/Forward verified; starting reload`);
      await page.reload(); await page.getByRole('button', { name: 'Play-by-Play', exact: true }).waitFor();
      assert.ok(page.url().includes(`gameId=${secondDetail.eventId}`));
      await page.goto(detailUrl); await page.getByRole('button', { name: 'Play-by-Play', exact: true }).waitFor();
      console.log(`NCAA ${width}: reload/direct verified; starting Group switch`);
      // Real GroupProvider switch through AppNav, with all writes intercepted.
      await page.getByRole('button', { name: 'Active Group: QA Group', exact: true }).filter({ visible: true }).click();
      await page.getByRole('menuitem', { name: 'QA Group B', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: 'Active Group: QA Group B', exact: true }).filter({ visible: true }).waitFor();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).waitFor();
      assert.ok(page.url().includes('gameId=401858473'), 'Public game preserved in new Group');
      console.log(`NCAA ${width}: Group switch verified; starting invalid/calendar`);
      for (const gameId of ['999999999', 'invalid', '']) {
        await page.goto(`${url}&gameId=${gameId}`);
        await card.waitFor(); assert.equal(new URL(page.url()).searchParams.has('gameId'), false, gameId);
      }
      await page.goto(`${url}&gameId=401858473&tab=pbp&period=4`);
      await page.getByRole('button', { name: 'Q4', exact: true }).first().waitFor();
      // A different explicit URL calendar cannot display the old week's game.
      await page.evaluate(() => history.pushState(null, '', '?season=2026&week=6&gameId=401858473'));
      await page.waitForFunction(() => !new URLSearchParams(location.search).has('gameId'));
      assert.equal(await page.getByRole('button', { name: 'Back to games', exact: true }).count(), 0);
      assert.ok((await page.locator('main').innerText()).includes('Week 6'));
      await page.getByRole('combobox', { name: 'Week', exact: true }).selectOption('5');
      await card.waitFor(); assert.ok(page.url().includes('season=2026&week=5'));
      await card.click(); await page.getByRole('button', { name: 'Back to games', exact: true }).waitFor();
      await page.evaluate(() => history.pushState(null, '', '?season=2025&week=5&gameId=401858473'));
      await page.waitForFunction(() => !new URLSearchParams(location.search).has('gameId'));
      assert.ok(page.url().includes('season=2025&week=5'));

      assert.deepEqual(errors, []);
      console.log(`PASS actual Next NCAA Week 5 ${width}: OSU/Iowa logos, exclusions, possession changes, selection, quarters, inline/sticky scrolling, tabs, refresh, history, reload/direct/invalid, calendar, real Group switch`);
      await page.close();
    }
  } finally { await browser.close(); }
});
