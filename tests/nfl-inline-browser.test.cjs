/* Real NFL overview/controller/URL hooks; fixture API/auth boundaries only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const { normalizeNflGame } = require('../lib/providers/nflLiveScores.ts');
const captured = require('./fixtures/play-team-logos.json').nfl;
const { footballPlaysByQuarter } = require('../lib/live-scores/football-plays.ts');
const competition = captured.header.competitions[0];
const game = normalizeNflGame({ ...captured.header, date: competition.date });
const calendar = { season: 2025, seasonType: 2, week: 3 };
const detail = { success: true, eventId: game.espnEventId, game, header: captured.header,
  drives: captured.drives, liveContext: calendar, boxscore: { players: [{ team: { id: game.awayTeam.id, abbreviation: game.awayTeam.abbreviation }, statistics: [{ name: 'passing', labels: ['YDS'], athletes: [{ athlete: { id: '42', displayName: 'Fixture Quarterback With Long Name' }, stats: ['300'] }] }] }] } };

test('NFL real inline controller: 360/390/1024 overview, tabs/replay/logos/ownership and URL/history/Group regression', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to installed Playwright',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/game-center-browser-bundle.cjs')({ nflLive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } }); const errors = [], calls = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.hostname !== 'nfl-inline.test') return route.abort();
        if (url.pathname.startsWith('/api/')) {
          assert.equal(req.method(), 'GET'); calls.push(url.href);
          const body = url.pathname.endsWith('/scores') ? { ...calendar, games: [game], calendar: [{ value: 2, label: 'Regular Season', entries: [{ value: 3, label: 'Week 3' }] }] }
            : url.pathname.endsWith('/favorites') ? { teamIds: [] } : { ...detail, ownership: { groupId: url.searchParams.get('groupId'), leagueId: url.searchParams.get('leagueId'), players: { '42': { name: url.searchParams.get('groupId') === 'a' ? 'Owner A' : 'Owner B', isYou: true } } } };
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.fulfill({ contentType: 'text/html', body: `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}
          for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=(...args)=>{original(...args);dispatchEvent(new PopStateEvent('popstate'))};}
          window.fixtureGroup={isLoading:false,isSwitchingGroup:false,groupContext:{group:{id:'a'},leagues:[{id:'nfl-a',sportKey:'nfl',isEnabled:true,gameMode:'standard'}]}};
          window.root=ReactDOMClient.createRoot(document.getElementById('app'));
          window.renderLive=()=>root.render(React.createElement(GameCenters['nfl-live'],{viewerId:'viewer'}));renderLive();</script></html>` });
      });
      const overview = 'http://nfl-inline.test/live-scores?sport=nfl&season=2025&seasonType=2&week=3';
      await page.goto(overview); const card = page.getByRole('button').filter({ hasText: game.awayTeam.displayName }).filter({ hasText: game.homeTeam.displayName });
      await card.click(); await page.getByRole('button', { name: 'Summary', exact: true }).waitFor();
      assert.ok(page.url().includes(`gameId=${game.espnEventId}`));
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByRole('button', { name: 'Q1', exact: true }).first().click();
      const rows = page.locator('button:has([data-play-team-logo])'); await rows.first().waitFor();
      const plays = footballPlaysByQuarter([...captured.drives.previous]).find(q => q.period === 1).plays;
      assert.equal(await rows.count(), plays.length);
      assert.ok(await rows.locator('[data-play-team-logo] img').count() > 0);
      for (const index of [0, 4]) {
        await rows.nth(index).evaluate(e => e.click());
        await page.waitForFunction(text => [...document.querySelectorAll('[aria-label="Selected football play replay"]')].some(e => e.textContent.includes(text)), plays[index].text);
      }
      await page.evaluate(() => scrollTo(0, 900)); await page.waitForTimeout(150);
      assert.equal(await page.getByLabel('Selected football play replay', { exact: true }).count(), 2);
      assert.equal(await page.locator('main .sticky').evaluate(e => e.getBoundingClientRect().top), 0);
      await page.getByRole('button', { name: 'Q2', exact: true }).first().evaluate(e => e.click());
      await page.waitForURL(/period=2/);
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByRole('button', { name: 'Player Stats', exact: true }).click();
      await page.getByText('Owner A · You', { exact: true }).waitFor();
      const detailUrl = page.url(); await page.reload(); await page.getByText('Owner A · You', { exact: true }).waitFor();
      await page.goto(detailUrl); await page.getByText('Owner A · You', { exact: true }).waitFor();
      await page.evaluate(() => { fixtureGroup.isSwitchingGroup=true;renderLive(); });
      await page.waitForFunction(() => !document.body.textContent.includes('Owner A · You'));
      await page.evaluate(() => { fixtureGroup.isSwitchingGroup=false;fixtureGroup.groupContext.group.id='b';fixtureGroup.groupContext.leagues[0].id='nfl-b';renderLive(); });
      await page.getByText('Owner B · You', { exact: true }).waitFor();
      assert.ok(calls.some(url => url.includes('groupId=b') && url.includes('/game-detail')));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole('button', { name: 'Back to games', exact: true }).click(); await card.waitFor();
      await card.click(); await page.getByRole('button', { name: 'Summary', exact: true }).waitFor();
      await page.goBack(); await card.waitFor(); await page.goForward();
      await page.getByRole('button', { name: 'Summary', exact: true }).waitFor();
      assert.deepEqual(errors, []); console.log(`PASS NFL inline ${width}: tabs, field/quarters/selection/logos, ownership, direct/reload/history/Group`);
      await page.close();
    }
  } finally { await browser.close(); }
});
