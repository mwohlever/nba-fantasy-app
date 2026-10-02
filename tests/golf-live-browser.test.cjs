/* eslint-disable @typescript-eslint/no-require-imports */
/* Real Golf Live + scorecard + ShotCast action, synthetic Group/auth/Next adapters. All requests intercepted; no production data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Golf Live mobile/desktop selectors, direct links, reload, history, Group scope, errors and ShotCast context', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE to use installed Playwright',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const root = path.resolve(__dirname, '..');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const bundle = require('./helpers/golf-live-browser-bundle.cjs')();
  const season = 2026;
  const calendar = [{ id: '401850978', label: 'TOUR Championship', startDate: `${season}-08-27`, endDate: `${season}-08-30` },
    { id: '401850915', label: 'Bank of Utah Championship', startDate: `${season}-10-01`, endDate: `${season}-10-04` },
    { id: '200', label: 'BMW Championship', startDate: '2026-08-20', endDate: '2026-08-23' },
    { id: '201', label: 'FedEx St. Jude Championship', startDate: '2026-08-13', endDate: '2026-08-16' },
    { id: '202', label: 'Baycurrent Classic', startDate: '2026-10-08', endDate: '2026-10-11' },
    { id: '401703489', label: 'The Sentry', startDate: '2025-01-02', endDate: '2025-01-05' },
    { id: '203', label: 'Later future fixture', startDate: '2027-02-04', endDate: '2027-02-07' },
    { id: '204', label: 'Earlier future fixture', startDate: '2027-01-07', endDate: '2027-01-10' },
    { id: '401703531', label: 'TOUR Championship', startDate: '2025-08-21', endDate: '2025-08-24' },
    { id: '401850982', label: 'Hero World Challenge', startDate: `${season}-12-03`, endDate: `${season}-12-06` }];
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.addInitScript(() => {
        const NativeDate = Date;
        globalThis.Date = class extends NativeDate {
          constructor(...args) { super(...(args.length ? args : ['2026-10-02T16:00:00Z'])); }
          static now() { return new NativeDate('2026-10-02T16:00:00Z').getTime(); }
        };
      });
      const calls = [], errors = [], refreshedSlates = new Set(); let delayDetails, liveDefault = false;
      const scoreboardEvent = id => {
        const selected = calendar.find(event => event.id === id);
        return { id, name: selected.label, date: selected.startDate, endDate: selected.endDate,
          competitions: [{ status: { period: 4, type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
            competitors: [{ id: '9478', order: 1, score: '-12', athlete: { displayName: 'Scottie Scheffler' },
              linescores: [-4, -2, -2, -4].map((score, index) => ({ period: index + 1, value: 72 + score, displayValue: String(score),
                linescores: Array.from({ length: 18 }, (_, hole) => ({ period: hole + 1, value: hole < -score ? 3 : 4,
                  scoreType: { displayValue: hole < -score ? '-1' : 'E' } })) })) }] }] };
      };
      page.on('pageerror', error => errors.push(error.message));
      const html = `<html class="dark"><meta charset="utf-8"><style>${css.css}</style><div id="app"></div><script>${bundle.replaceAll('</script', '<\\/script')}
        window.fixtureGroup={groupContext:{group:{id:'a'}},isLoading:false,isSwitchingGroup:false};
        window.root=ReactDOMClient.createRoot(document.getElementById('app'));
        window.renderPage=()=>root.render(React.createElement(GolfLivePage));renderPage();</script></html>`;
      const row = owner => ({ playerId: 7, name: 'Scottie Scheffler', shortName: 'S. Scheffler', espnGolfPlayerId: '9478', headshotUrl: null,
        position: 1, positionDisplay: 'T1', score: -12, scoreDisplay: '-12', currentRoundScoreDisplay: '-4', status: 'finished', statusState: 'finished',
        isDrafted: Boolean(owner), isCurrentUser: owner === 'a', draftedBy: owner ? [`Team ${owner.toUpperCase()}`] : [] });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.host === 'golf.test' && !url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
        calls.push(url.toString());
        let result = {}, status = 200;
        if (url.pathname === '/api/home-summary') {
          const eventId = url.searchParams.get('eventId') ?? '401850978';
          const groupId = await page.evaluate(() => fixtureGroup.groupContext.group.id);
          const selected = calendar.find(event => event.id === eventId);
          const slateId = eventId === '401850978' ? 10 : eventId === '401850915' ? (groupId === 'a' ? 20 : 30) : eventId === '401703531' ? 40 : null;
          result = { latestSlate: slateId ? { id: slateId, external_event_id: eventId, label: selected.label, start_date: selected.startDate, end_date: selected.endDate } : null,
            latestGolfTournamentIsFinal: !liveDefault || eventId !== '401850915', tournamentLeaderboard: slateId ? [{ ...row(eventId === '401850978' ? 'a' : groupId === 'b' ? 'b' : null),
              ...(refreshedSlates.has(slateId) ? { score: -13, scoreDisplay: '-13', currentRoundScoreDisplay: '-5' } : {}) }] : [], liveTournamentRound: 4 };
        } else if (url.pathname === '/api/golf/refresh-config') {
          const slateId = Number(url.searchParams.get('slateId'));
          result = { success: true, slateId, eventId: slateId === 10 ? '401850978' : slateId === 40 ? '401703531' : '401850915', year: slateId === 40 ? '2025' : '2026' };
        } else if (url.pathname === '/api/refresh-stats-golf') {
          assert.equal(route.request().method(), 'POST');
          refreshedSlates.add(route.request().postDataJSON().slateId);
          result = { success: true };
        } else if (url.pathname === '/api/player-stats') {
          if (delayDetails) await delayDetails;
          result = { playerStats: [{ player_id: 7, status: 'finished', current_round: 4, rounds_completed: 4, fantasy_points: -12,
            rounds: [{ round_number: 4, score_to_par: -4, strokes: 68, holes_completed: 18, holes: [{ hole_number: 1, par: 4, strokes: 3, relative_to_par: -1 }] }] }] };
        } else if (url.pathname === '/api/golf/hole-replay') result = { replay: null, message: 'Fixture ShotCast unavailable' };
        else if (url.pathname.endsWith('/scoreboard')) result = { season: { year: season }, leagues: [{ calendar: calendar.filter(event => event.startDate.startsWith(url.searchParams.get('dates') ?? String(season))) }], events: url.searchParams.has('dates') ? ['401850978', '401850915', '401703531', '401703489'].map(scoreboardEvent) : liveDefault ? [{ id: '401850915', name: 'Bank of Utah Championship', date: '2026-10-01', endDate: '2026-10-04', competitions: [{ status: { period: 2, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } }, competitors: [] }] }] : [] };
        else if (url.pathname.endsWith('/leaderboard')) result = { events: url.searchParams.get('event') === '401850982' ? [{ id: '401850982', name: 'Hero World Challenge', date: `${season}-12-03`, endDate: `${season}-12-06`, status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } }, competitions: [] }] : url.searchParams.get('event') === '401703489' ? [scoreboardEvent('401703489')] : [] };
        else return route.fulfill({ status: 404, body: '' }); // headshots use existing initials fallback
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
      });
      await page.goto('http://golf.test/golf/live');
      const selector = page.getByLabel('Golf Live tournament');
      await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      await page.getByText('Your golfer', { exact: true }).waitFor();
      await page.getByRole('button', { name: /Refresh/ }).click();
      await page.getByText('-13', { exact: true }).waitFor();
      await page.getByText('-5', { exact: true }).waitFor();
      assert.ok(refreshedSlates.has(10), 'automatic refresh uses the resolved slate');
      assert.equal(await page.getByText('Your golfer', { exact: true }).count(), 1);
      assert.deepEqual(await page.locator('section > div > div').first().locator('span').allTextContents(), ['Pos', 'Golfer', 'Rnd', 'Total']);
      assert.equal(new URL(page.url()).search, '', 'automatic opening leaves URL automatic');
      await page.waitForFunction(() => document.querySelectorAll('[aria-label="Golf Live tournament"] option:not([hidden])').length === 6);
      assert.equal(await selector.locator('option').first().innerText(), 'Latest: TOUR Championship');
      assert.equal(await selector.locator('option:not([hidden])').filter({ hasText: 'TOUR Championship' }).count(), 1);
      assert.deepEqual(await selector.locator('optgroup').evaluateAll(groups => groups.map(group => ({ label: group.label, ids: [...group.children].map(option => option.value) }))), [
        { label: 'Recent tournaments', ids: ['200', '201'] },
        { label: 'In progress', ids: ['401850915'] },
        { label: 'Upcoming tournaments', ids: ['202', '401850982'] },
      ]);
      assert.doesNotMatch(await selector.innerText(), /Current \/ automatic/);
      assert.match(await selector.innerText(), new RegExp(`Bank of Utah Championship · ${season}-10-01`));
      await selector.selectOption('401850915');
      await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      assert.equal(await page.getByText('Your golfer', { exact: true }).count(), 0);
      assert.match(page.url(), /eventId=401850915/);
      const selectedUrl = page.url();
      await page.reload(); await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      assert.equal(page.url(), selectedUrl);
      await selector.selectOption(''); await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      await page.goBack(); await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      await page.goForward(); await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      await selector.selectOption('401850915'); await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      await page.getByRole('button', { name: /Scottie Scheffler/ }).click();
      const modal = page.getByLabel('Scottie Scheffler Golf scorecard'); await modal.waitFor();
      await modal.getByRole('button', { name: /Round 4/ }).click();
      await modal.getByRole('button', { name: /Hole 1/ }).first().click();
      await page.getByText('Fixture ShotCast unavailable').waitFor();
      const replay = new URL(calls.find(call => call.includes('/api/golf/hole-replay')));
      assert.equal(replay.searchParams.get('slateId'), '20'); assert.equal(replay.searchParams.get('playerId'), '7');
      await page.getByLabel('Close Golf scorecard').click();
      // A late detail response must not reopen a modal or populate the next tournament.
      let release; delayDetails = new Promise(resolve => { release = resolve; });
      await selector.selectOption(''); await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      await page.getByRole('button', { name: /Scottie Scheffler/ }).click();
      await page.getByLabel('Close Golf scorecard').click();
      await selector.selectOption('401850915'); await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      release(); delayDetails = null;
      assert.equal(await modal.count(), 0);
      await page.getByRole('button', { name: 'Switch Group' }).click();
      await page.getByText('Team B', { exact: true }).waitFor();
      assert.equal(page.url(), selectedUrl);
      await page.getByRole('button', { name: /Scottie Scheffler/ }).click(); await modal.waitFor();
      await modal.getByRole('button', { name: /Round 4/ }).click();
      await modal.getByRole('button', { name: /Hole 1/ }).first().click(); await page.getByText('Fixture ShotCast unavailable').waitFor();
      assert.ok(calls.some(call => call.includes('/api/golf/hole-replay?slateId=30')));
      await page.getByLabel('Close Golf scorecard').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const selectorBox = await selector.boundingBox(); assert.ok(selectorBox.height <= 40, JSON.stringify(selectorBox));
      const yearBox = await page.getByLabel('Golf tournament season').boundingBox();
      assert.ok(selectorBox.x + selectorBox.width <= yearBox.x && yearBox.x + yearBox.width <= width);
      const label = await selector.locator('option:checked').textContent();
      await selector.evaluate(control => { control.selectedOptions[0].textContent = 'Long tournament-name fixture presented by a championship sponsor · 2026-10-01'; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long tournament names cannot widen the page');
      assert.equal((await selector.boundingBox()).width, selectorBox.width);
      await selector.evaluate((control, text) => { control.selectedOptions[0].textContent = text; }, label);
      await page.screenshot({ path: `/tmp/111-golf-selector-${width}.png` });
      await page.getByRole('button', { name: /Scottie Scheffler/ }).click(); await modal.waitFor();
      await page.evaluate(() => history.pushState(null, '', '/golf/live?eventId=401850982'));
      await page.getByText(/This tournament has not started/).waitFor();
      assert.equal(await modal.count(), 0, 'event history changes clear an open golfer detail');
      assert.equal(await page.getByText('Team B', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /Scottie Scheffler/ }).count(), 0);
      await page.goto('http://golf.test/golf/live?eventId=401703531');
      await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      await page.waitForFunction(() => document.querySelector('[aria-label="Golf tournament season"]').value === '2025');
      assert.match(await page.locator('header').innerText(), /2025-08-21 – 2025-08-24/);
      assert.equal(await page.getByText('Your golfer', { exact: true }).count(), 0);
      await page.reload(); await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      assert.equal(await selector.inputValue(), '401703531');
      await page.getByRole('button', { name: /Scottie Scheffler/ }).click(); await modal.waitFor();
      await modal.getByRole('button', { name: /Round 4/ }).click();
      await modal.getByRole('button', { name: /Hole 1/ }).first().click(); await page.getByText('Fixture ShotCast unavailable').waitFor();
      assert.ok(calls.some(call => call.includes('/api/golf/hole-replay?slateId=40')), 'historical scorecard retains its matching slate');
      await page.getByLabel('Close Golf scorecard').click();
      assert.deepEqual(await selector.locator('optgroup').evaluateAll(groups => groups.map(group => ({ label: group.label, ids: [...group.children].map(option => option.value) }))), [
        { label: '2025 tournaments', ids: ['401703531', '401703489'] },
      ]);
      assert.equal(await selector.locator('option:not([hidden])').filter({ hasText: /Current:|Latest:/ }).count(), 0);
      await selector.selectOption('401703489');
      await page.getByRole('heading', { name: 'The Sentry' }).waitFor();
      assert.equal(await page.getByText('Team B', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Your golfer', { exact: true }).count(), 0);
      await page.getByRole('button', { name: /Scottie Scheffler/ }).click(); await modal.waitFor();
      await page.getByText(/Scorecard and ShotCast details are unavailable for this tournament/).waitFor();
      await page.getByLabel('Close Golf scorecard').click();
      await selector.selectOption('401703531'); await page.getByRole('heading', { name: 'TOUR Championship' }).waitFor();
      await page.getByLabel('Golf tournament season').selectOption('2027');
      await page.waitForFunction(() => document.querySelector('[aria-label="Golf Live tournament"] optgroup')?.children.length === 2);
      assert.deepEqual(await selector.locator('optgroup').evaluateAll(groups => groups.map(group => ({ label: group.label, ids: [...group.children].map(option => option.value) }))), [
        { label: 'Upcoming tournaments', ids: ['204', '203'] },
      ]);
      assert.equal(new URL(page.url()).searchParams.get('eventId'), '401703531');
      await page.getByLabel('Golf tournament season').selectOption(String(season));
      await page.waitForFunction(() => document.querySelectorAll('[aria-label="Golf Live tournament"] option:not([hidden])').length === 6);
      assert.equal(await selector.inputValue(), '401703531', 'browsing another season preserves explicit event');
      await page.goto('http://golf.test/golf/live?eventId=999999999');
      await page.getByText(/could not be found/).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'TOUR Championship' }).count(), 0);
      await page.goto('http://golf.test/golf/live?eventId=invalid');
      await page.getByText(/Invalid Golf event ID/).waitFor();
      await page.goto('http://golf.test/golf/live?eventId=401850915');
      await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      liveDefault = true;
      await page.goto('http://golf.test/golf/live?eventId=401850915');
      await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      await page.waitForFunction(() => document.querySelector('[aria-label="Golf Live tournament"] option')?.textContent.trim() === 'Current: Bank of Utah Championship');
      assert.equal(await selector.locator('option:not([hidden])').filter({ hasText: 'Bank of Utah Championship' }).count(), 1);
      assert.equal(await selector.inputValue(), '401850915', 'explicit current ID remains URL-authoritative');
      await selector.selectOption('');
      await page.waitForFunction(() => !location.search);
      await page.getByRole('heading', { name: 'Bank of Utah Championship' }).waitFor();
      await page.goBack(); await page.waitForFunction(() => location.search === '?eventId=401850915');
      await page.goForward(); await page.waitForFunction(() => !location.search);
      await page.getByRole('button', { name: 'Switch sport' }).click();
      assert.equal(new URL(page.url()).search, '?sport=nba');
      assert.deepEqual(errors, []);
      assert.ok(calls.filter(call => new URL(call).pathname.startsWith('/api/')).every(call => new URL(call).host === 'golf.test'), 'all app requests and refresh writes stay inside the intercepted fixture');
      await page.close();
    }
  } finally { await browser.close(); }
});
