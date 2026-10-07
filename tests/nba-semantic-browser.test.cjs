/* eslint-disable @typescript-eslint/no-require-imports */
/* Real NBA Live, URL hooks and Game Center; fixture navigation/Group/API boundaries only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const { normalizeNbaPlays, nbaBoxscorePlayers } = require('../lib/live-scores/nbaPlays.ts');
const { nbaDisplayTeamId } = require('../lib/live-scores/playTeamLogo.ts');

const team = id => ({ id, abbreviation: id === '5' ? 'CLE' : 'NYK', displayName: `Team ${id}`, logo: `/logos/${id}.svg` });
const playerName = 'A.VeryLongChargedPlayerNameForMobileCoverage';
const boxscore = { players: [{ team: team('5'), statistics: [{ name: 'players', labels: ['PTS'], athletes: [
  { athlete: { id: '42', shortName: playerName, displayName: playerName }, stats: ['10'] },
] }] }] };
const cases = [
  ['made', '92', 'Jump Shot', '5', true, 2],
  ['missed', '92', 'Jump Shot', '18', true, 0],
  ['ft', '97', 'Free Throw - 1 of 2', '5', true, 1],
  ['rebound', '155', 'Defensive Rebound', '18', false, 0],
  ['turnover', '62', 'Bad Pass Turnover', '5', false, 0],
  ['foul', '44', 'Shooting Foul', '5', false, 0],
  ['timeout', '16', 'Full Timeout', '5', false, 0],
  ['substitution', '584', 'Substitution', '18', false, 0],
  ['challenge', '214', "Coach's Challenge (Supported)", '5', false, 0],
  ['review', '278', 'Ref-Initiated Review (Supported)', '5', false, 0],
  ['jump', '615', 'Jumpball', '5', false, 0],
  ['unknown', '999', 'Unknown', '5', false, 0],
];
const raw = [1, 2].flatMap(period => [
  ...Array.from({ length: 10 }, (_, repeat) => cases.map(([kind, typeId, typeText, teamId, shootingPlay, scoreValue]) => ({
    id: `${kind}-${repeat}-q${period}`, text: `${kind} play ${repeat} Q${period}`, type: { id: typeId, text: typeText },
    team: { id: teamId }, period: { number: period }, clock: { displayValue: '8:42' },
    shootingPlay, scoreValue, pointsAttempted: kind === 'ft' ? 1 : 2, coordinate: { x: 25, y: 10 },
    participants: [{ athlete: { id: '42' } }], awayScore: 10, homeScore: 12,
  }))).flat(),
  { id: `end-q${period}`, text: `End of the ${period === 1 ? '1st' : '2nd'} Quarter`, type: { id: '412', text: 'End Period' },
    period: { number: period }, team: { id: '5' }, clock: { displayValue: '0:00' } },
]);
const plays = normalizeNbaPlays(raw, nbaBoxscorePlayers(boxscore));
const game = { espnEventId: '123', name: 'NYK at CLE', shortName: 'NYK @ CLE', status: 'post',
  statusDetail: 'Final', completed: true, startAt: '2026-05-26T01:00:00Z', awayTeam: team('18'), homeTeam: team('5') };
const detail = { eventId: '123', header: { id: '123', name: game.name, shortName: game.shortName,
  competitions: [{ date: game.startAt, status: { type: { state: 'post', completed: true }, period: 2 },
    competitors: [{ homeAway: 'away', team: team('18'), score: '10' }, { homeAway: 'home', team: team('5'), score: '12' }] }] },
  boxscore, plays };

test('NBA semantics, sticky quarters, logos, ownership and inline history at 360/390/1024', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to installed Playwright',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/game-center-browser-bundle.cjs')({ nbaLive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1024]) for (const context of ['nba', 'nba-skins']) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      page.setDefaultTimeout(12000);
      const errors = [], requests = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname !== 'nba-semantic.test') return route.abort();
        if (url.pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="9" fill="teal"/></svg>' });
        if (url.pathname.startsWith('/api/')) {
          assert.equal(request.method(), 'GET', 'Fixture permits read-only application requests');
          requests.push(url.href);
          const groupId = url.searchParams.get('groupId'), leagueId = url.searchParams.get('leagueId');
          const body = url.pathname.endsWith('/scores') ? { games: [game] } : { ...detail,
            ownership: { groupId, leagueId, players: { '42': { name: groupId === 'a' ? 'Mark' : 'Josh', isYou: true } } } };
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.fulfill({ contentType: 'text/html', body: `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><nav aria-label="Fixture bottom navigation" style="position:fixed;bottom:0;width:100%;height:70px;background:#101827;color:white">111 Sports</nav><script>${bundle.replaceAll('</script', '<\\/script')}
          for(const method of ['pushState','replaceState']) {const original=history[method].bind(history);history[method]=(...args)=>{original(...args);dispatchEvent(new PopStateEvent('popstate'))};}
          window.fixtureGroup={isLoading:false,isSwitchingGroup:false,groupContext:{group:{id:'a'},leagues:['nba','nba_skins'].map(sportKey=>({id:sportKey+'-a',sportKey,isEnabled:true,gameMode:'standard'}))}};
          window.root=ReactDOMClient.createRoot(document.getElementById('app'));
          window.renderLive=()=>root.render(React.createElement(GameCenters['nba-live'],{viewerId:'viewer',context:${JSON.stringify(context)}}));renderLive();</script></html>` });
      });
      const overview = context === 'nba' ? '/live-scores?sport=nba&date=2026-05-25' : '/nba-skins/live?date=2026-05-25';
      await page.goto(`http://nba-semantic.test${overview}`);
      await page.getByRole('button', { name: /Team 18.*Team 5/ }).click();
      await page.waitForURL(/gameId=123/);
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.waitForURL(/tab=pbp/);
      await page.getByRole('button', { name: 'Q1', exact: true }).click();
      const normal = page.getByLabel('Selected play court', { exact: true });
      const rows = page.locator('button:has([data-play-team-logo])');
      await rows.first().waitFor();
      assert.ok((await normal.innerText()).includes('unknown play 9 Q1'), 'Automatic latest excludes period ending');
      const q1 = plays.filter(play => play.period === 1).reverse();
      for (const [index, play] of q1.entries()) {
        const image = rows.nth(index).locator('[data-play-team-logo] img');
        assert.equal(await image.count() ? await image.getAttribute('data-team-id') : null,
          nbaDisplayTeamId(play, [game.awayTeam, game.homeTeam]), `${context}/${width}/${play.id} logo`);
      }
      const select = async text => {
        await rows.filter({ hasText: text }).evaluate(element => element.click());
        await page.waitForFunction(text => [...document.querySelectorAll('[aria-label="Selected play court"]')]
          .some(element => element.textContent.includes(text)), text);
      };
      for (const [kind, semantic] of [['turnover', 'turnover'], ['foul', 'foul'], ['timeout', 'timeout'], ['challenge', 'review'], ['review', 'review'], ['jump', 'jump_ball']]) {
        await select(`${kind} play 0 Q1`);
        assert.equal(await normal.locator(`[data-semantic-event="${semantic}"]`).count(), 1);
        assert.equal(await normal.locator('svg [transform^="translate"]').count(), 0, 'Semantic event has no shot marker');
        assert.doesNotMatch(await normal.innerText(), /← CLE|NYK →/);
        if (kind === 'foul' || kind === 'turnover') assert.ok((await normal.innerText()).includes(playerName.toUpperCase()));
      }
      await select('End of the 1st Quarter');
      assert.equal(await normal.locator('[data-semantic-event="period_end"]').count(), 1);
      for (const kind of ['made', 'missed', 'ft']) {
        await select(`${kind} play 0 Q1`);
        assert.equal(await normal.locator('[data-semantic-event]').count(), 0);
        assert.equal(await normal.locator('svg [transform^="translate"]').count(), 1, 'Shot origin survives');
      }
      for (const kind of ['rebound', 'substitution', 'unknown']) {
        await select(`${kind} play 0 Q1`);
        assert.equal(await normal.locator('[data-semantic-event]').count(), 0);
      }
      await select('foul play 0 Q1');
      await page.evaluate(() => scrollTo(0, 950));
      await page.waitForTimeout(200);
      const sticky = page.locator('[data-nba-sticky-replay]');
      if (width < 640) {
        await sticky.waitFor();
        const bounds = await sticky.boundingBox();
        assert.ok(Math.abs(bounds.y) < 1, JSON.stringify(bounds));
        assert.ok(bounds.height < 260 && bounds.width <= width);
        assert.equal(await sticky.getByRole('button', { name: 'Q1', exact: true }).getAttribute('aria-pressed'), 'true');
        await sticky.getByRole('button', { name: 'Q2', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[aria-label="Selected play court"]').textContent.includes('unknown play 9 Q2'));
        assert.ok((await rows.first().innerText()).includes('End of the 2nd Quarter'));
        await select('turnover play 0 Q2');
        assert.ok((await sticky.innerText()).includes('TURNOVER'));
        const before = await page.evaluate(() => scrollY);
        await page.getByRole('button', { name: 'Refresh game center', exact: true }).evaluate(element => element.click());
        await page.waitForTimeout(100);
        assert.ok((await normal.innerText()).includes('turnover play 0 Q2'), 'Refresh preserves manual selection');
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 2, 'Refresh preserves scrolling');
        await page.screenshot({ path: `/tmp/nba-semantic-${context}-${width}.png` });
        await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
        assert.equal(await sticky.count(), 0);
      } else {
        assert.equal(await sticky.count(), 0, 'Existing desktop full-court policy preserved');
        await page.getByRole('button', { name: 'Q2', exact: true }).evaluate(element => element.click());
        await select('foul play 0 Q2');
        await page.screenshot({ path: `/tmp/nba-semantic-${context}-${width}.png` });
        await page.evaluate(() => scrollTo(0, 0));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
      await page.getByRole('button', { name: 'Player Stats', exact: true }).click();
      await page.waitForURL(/tab=stats/);
      await page.getByText(playerName, { exact: true }).waitFor();
      assert.equal(await page.getByText(/^(Mark|Josh) · You$/).count(), context === 'nba' ? 1 : 0);
      await page.reload();
      await page.getByText(playerName, { exact: true }).waitFor();
      assert.equal(await page.getByText(/^(Mark|Josh) · You$/).count(), context === 'nba' ? 1 : 0, 'Reload ownership');
      await page.evaluate(() => {
        fixtureGroup.groupContext.group.id = 'b';
        fixtureGroup.groupContext.leagues.forEach(league => { league.id = `${league.sportKey}-b`; }); renderLive();
      });
      if (context === 'nba') await page.getByText('Josh · You', { exact: true }).waitFor();
      else assert.equal(await page.getByText(/^(Mark|Josh) · You$/).count(), 0);
      assert.ok(requests.some(url => url.includes('groupId=b')), 'New Group resolves its own detail/ownership');
      await page.getByRole('button', { name: /Back to games/ }).click();
      await page.waitForURL(url => !url.searchParams.has('gameId'));
      await page.getByRole('button', { name: /Team 18.*Team 5/ }).click();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.waitForURL(/tab=pbp/);
      await page.goBack();
      await page.waitForURL(url => !url.searchParams.has('gameId'));
      await page.goForward();
      await page.waitForURL(/gameId=123.*tab=pbp/);
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      await page.waitForURL(/tab=summary/);
      await page.goto(`http://nba-semantic.test${overview}&gameId=123&tab=pbp`);
      await normal.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Play-by-Play', exact: true }).getAttribute('aria-current'), 'page');
      // The current compatibility modal shares the same semantic/quarter content.
      await page.evaluate(({ game, context }) => root.render(React.createElement(GameCenters['nba-modal'],
        { game, context, viewerId: 'viewer', onClose() {} })), { game, context });
      await page.getByRole('button', { name: 'Close game center', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByRole('button', { name: 'Q1', exact: true }).click();
      await select('foul play 0 Q1');
      assert.equal(await normal.locator('[data-semantic-event="foul"]').count(), 1);
      if (width < 640) {
        const scroll = page.locator('[data-nba-modal-scroll]');
        await scroll.evaluate(element => { element.scrollTop = 950; });
        await sticky.waitFor();
        const bounds = await sticky.boundingBox(), scrollBounds = await scroll.boundingBox();
        assert.ok(bounds.y >= scrollBounds.y && bounds.y + bounds.height <= scrollBounds.y + scrollBounds.height);
        await sticky.getByRole('button', { name: 'Q2', exact: true }).click();
        await select('turnover play 0 Q2');
        assert.ok((await sticky.innerText()).includes('TURNOVER'));
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
