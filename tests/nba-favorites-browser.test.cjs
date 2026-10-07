/* Real NBA overview/URL/Game Center in Chromium; all writes go to local fixture state. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const team = (id, name, score) => ({ id, displayName: name, abbreviation: id === '9' ? 'GSW' : 'LAL', logo: `/logos/${id}.svg`, record: '40-20', score });
const away = team('9', 'Golden State Warriors', 103), home = team('13', 'Los Angeles Lakers', 104);
const game = { espnEventId: '123', name: 'Warriors at Lakers', status: 'in', startAt: '2026-05-25T23:00Z', statusDetail: 'Q4 2:00', awayTeam: away, homeTeam: home, broadcast: { network: 'ABC' } };
const detail = { eventId: '123', header: { id: '123', name: game.name, competitions: [{ date: game.startAt, status: { type: { state: 'in' }, period: 4 }, competitors: [
  { homeAway: 'away', team: away, score: '103' }, { homeAway: 'home', team: home, score: '104' },
] }] }, plays: [], boxscore: { players: [{ team: away, statistics: [{ labels: ['PTS'], athletes: [{ athlete: { id: '42', displayName: 'Owned NBA Player' }, stats: ['20'] }] }] }] } };
test('NBA favorites: 360/390/1024 layout, click/keyboard isolation, reload, shared Fantasy/Skins and ownership separation', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to installed Playwright',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/game-center-browser-bundle.cjs')({ nbaLive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      page.setDefaultTimeout(12000);
      const saved = new Set(), errors = [], writes = []; let failNext = false;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.hostname !== 'nba-favorites.test') return route.abort();
        if (url.pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="teal"/></svg>' });
        if (url.pathname.startsWith('/api/')) {
          let body;
          if (url.pathname.endsWith('/favorites')) {
            assert.equal(url.pathname, '/api/live-scores/nba/favorites');
            if (req.method() === 'GET') body = { teamIds: [...saved] };
            else {
              assert.ok(['POST', 'DELETE'].includes(req.method()));
              const { teamId } = req.postDataJSON(); assert.ok(['9', '13'].includes(teamId));
              writes.push([req.method(), teamId]);
              if (failNext) { failNext = false; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Fixture save error"}' }); }
              if (req.method() === 'POST') saved.add(teamId); else saved.delete(teamId);
              body = { success: true };
            }
          } else {
            assert.equal(req.method(), 'GET');
            body = url.pathname.endsWith('/scores') ? { games: [game] } : { ...detail,
              ownership: { groupId: url.searchParams.get('groupId'), leagueId: url.searchParams.get('leagueId'), players: { '42': { name: 'Fantasy Owner', isYou: true } } } };
          }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        }
        const mode = url.pathname.startsWith('/nba-skins') ? 'nba-skins' : 'nba';
        return route.fulfill({ contentType: 'text/html', body: `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}
          for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=(...args)=>{original(...args);dispatchEvent(new PopStateEvent('popstate'))};}
          window.fixtureGroup={isLoading:false,isSwitchingGroup:false,groupContext:{group:{id:'a'},leagues:['nba','nba_skins'].map(sportKey=>({id:sportKey+'-a',sportKey,isEnabled:true,gameMode:'standard'}))}};
          window.root=ReactDOMClient.createRoot(document.getElementById('app'));root.render(React.createElement(GameCenters['nba-live'],{viewerId:'viewer',context:${JSON.stringify(mode)}}));</script></html>` });
      });
      for (const mode of ['nba', 'nba-skins']) {
        const overview = `http://nba-favorites.test${mode === 'nba' ? '/live-scores?sport=nba&' : '/nba-skins/live?'}date=2026-05-25`;
        await page.goto(overview);
        const schedule = page.getByRole('region', { name: 'NBA schedule' });
        const card = schedule.locator('article'); await card.waitFor();
        const gsw = card.getByRole('button', { name: /Golden State Warriors/ });
        const lal = card.getByRole('button', { name: /Los Angeles Lakers/ });
        await page.waitForFunction(() => !document.querySelector('article button').disabled);
        assert.equal(await gsw.getAttribute('aria-pressed'), mode === 'nba' ? 'false' : 'true');
        assert.equal(await lal.getAttribute('aria-pressed'), mode === 'nba' ? 'false' : 'true');
        if (mode === 'nba') {
          await gsw.click(); await page.waitForFunction(() => document.querySelector('article button').getAttribute('aria-pressed') === 'true');
          assert.equal(page.url(), overview, 'Star click does not navigate');
          assert.equal(await page.getByRole('button', { name: 'Summary', exact: true }).count(), 0);
          await lal.click();
          await page.waitForFunction(() => [...document.querySelectorAll('article button')].every(button => button.getAttribute('aria-pressed') === 'true'));
        }
        const favorites = page.getByRole('region', { name: 'Favorite NBA games' });
        assert.equal(await favorites.locator('article').count(), 1, 'Both teams produce one favorite game');
        assert.equal(await card.count(), 1, 'Game remains in regular schedule');
        assert.ok(await favorites.evaluate(e => e.getBoundingClientRect().top) < await schedule.evaluate(e => e.getBoundingClientRect().top));
        const metrics = await card.evaluate(e => {
          const rows = [...e.children].slice(0, 2);
          return rows.map(row => {
            const logo = row.querySelector('img').getBoundingClientRect();
            const name = row.querySelector('p').getBoundingClientRect();
            const record = row.querySelectorAll('p')[1].getBoundingClientRect();
            const star = row.querySelector('button').getBoundingClientRect();
            const score = row.lastElementChild.getBoundingClientRect();
            return { logoX: logo.x, nameX: name.x, nameRight: name.right, recordX: record.x, starX: star.x, starRight: star.right, starWidth: star.width, starHeight: star.height, scoreX: score.x, scoreRight: score.right };
          });
        });
        for (const row of metrics) {
          assert.ok(row.nameRight <= row.starX && row.starRight <= row.scoreX);
          assert.ok(row.starWidth >= 36 && row.starHeight >= 36);
          assert.equal(row.nameX, row.recordX);
        }
        assert.equal(metrics[0].scoreRight, metrics[1].scoreRight); assert.equal(metrics[0].logoX, metrics[1].logoX);
        assert.ok((await card.innerText()).includes('Q4 2:00 · ABC'));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `/tmp/nba-favorites-${mode}-${width}.png` });
        await page.reload(); await card.waitFor();
        await page.waitForFunction(() => !document.querySelector('article button').disabled);
        assert.equal(await gsw.getAttribute('aria-pressed'), 'true');
        failNext = true; await gsw.click();
        await page.getByRole('status').filter({ hasText: /could not be saved/ }).waitFor();
        assert.equal(await gsw.getAttribute('aria-pressed'), 'true', 'Failed delete rolls back');
        assert.equal(page.url(), overview);
        await gsw.focus(); await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('article button').getAttribute('aria-pressed') === 'false' && !document.querySelector('article button').disabled);
        assert.equal(page.url(), overview, 'Keyboard star does not navigate');
        await gsw.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('article button').getAttribute('aria-pressed') === 'true');
        assert.equal(page.url(), overview);
        // Clicking the team text opens detail; favorites have no control inside it.
        await card.getByText('Golden State Warriors', { exact: true }).click();
        await page.waitForURL(/gameId=123/);
        await page.getByRole('button', { name: 'Player Stats', exact: true }).click();
        await page.getByText('Owned NBA Player', { exact: true }).waitFor();
        assert.equal(await page.getByText('Fantasy Owner · You', { exact: true }).count(), mode === 'nba' ? 1 : 0);
        assert.equal(await page.getByRole('button', { name: /from favorites|to favorites/ }).count(), 0);
        await page.getByRole('button', { name: /Back to games/ }).click(); await card.waitFor();
        await card.focus(); await page.keyboard.press('Enter');
        await page.waitForURL(/gameId=123/);
        await page.getByRole('button', { name: 'Summary', exact: true }).waitFor();
        await page.goBack(); await card.waitFor();
        await page.goForward(); await page.getByRole('button', { name: 'Summary', exact: true }).waitFor();
      }
      assert.ok(writes.length >= 8); assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});
