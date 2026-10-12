/* eslint-disable @typescript-eslint/no-require-imports */
// Real Chromium interactions. All API calls are fulfilled with isolated fixtures, including writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { deriveGameImplications } = require('../lib/bracket/gameImplications.ts');
const captured = require('./fixtures/ncaa-field-401858454.json');
const topology = { games: [
  { id: 'left', roundKey: 'semifinal', roundOrder: 1, gameOrder: 1, sources: [{ type: 'team', teamId: 'A' }, { type: 'team', teamId: 'B' }] },
  { id: 'right', roundKey: 'semifinal', roundOrder: 1, gameOrder: 2, sources: [{ type: 'team', teamId: 'C' }, { type: 'team', teamId: 'D' }] },
  { id: 'final', roundKey: 'championship', roundOrder: 2, gameOrder: 1, sources: [{ type: 'winner', gameId: 'left' }, { type: 'winner', gameId: 'right' }] },
] };
const names = { A: 'Ole Miss', B: 'LSU', C: 'Ohio State', D: 'Texas' };
const subjects = ['Mark', 'Josh', 'Nico', 'Andy'].map((entrantName, index) => ({ contestId: 'fixture', competitionId: 1,
  entryId: index + 1, masterBracketId: `m${index + 1}`, entrantId: entrantName, entrantName, bracketNumber: 1,
  isAccountOwner: index === 0, label: `${entrantName} · Bracket 1`, snapshotStatus: 'frozen' }));
const entries = subjects.map((subject, index) => ({ id: subject.entryId, label: subject.label,
  rules: { semifinal: index + 3, championship: 17 + index },
  picks: [{ left: 'A', right: 'C', final: 'C' }, { left: 'A', right: 'D', final: 'A' }, { left: 'B', right: 'C', final: 'B' }, { left: 'B', right: 'D', final: 'D' }][index] }));
function fixtureResponse(gameId, id, customSubjects = subjects, results = {}, poolState = 'available') {
  const subject = customSubjects.find(subject => subject.entryId === id) ?? null;
  return { contestId: 'fixture', competitionId: 1, groupId: 'group1', subjects: customSubjects, subject,
    contestLock: { scope: 'contest', locked: poolState !== 'pre_lock', status: poolState === 'pre_lock' ? 'open' : 'locked', effectiveLockAt: null, evaluatedAt: '2026-10-12T12:00:00Z' },
    readiness: subject ? 'available' : 'selection_required', poolState,
    game: gameId ? { gameId, officialStatus: results[gameId] ? 'final' : 'scheduled', officialWinner: results[gameId] ?? null } : null,
    teamNames: names, freshness: { readAt: '2026-10-12T12:00:00Z' },
    analysis: subject && gameId ? deriveGameImplications({ topology, gameId, results,
      subject: entries.find(entry => entry.id === id), rivals: poolState === 'available' ? entries : null }) : null };
}
function providerGame(eventId, a, b) {
  const team = id => ({ id, displayName: names[id], abbreviation: names[id], logo: null, rank: null, record: null, conferenceId: null, score: 0, winner: false });
  return { espnEventId: eventId, name: `${names[a]} vs ${names[b]}`, shortName: `${names[a]} vs ${names[b]}`,
    kickoffAt: '2026-12-20T00:00:00Z', awayTeam: team(a), homeTeam: team(b), status: 'post', completed: true, odds: null };
}
const leftGame = providerGame('event-left', 'A', 'B'), rightGame = providerGame('event-right', 'C', 'D');
const live = { contest: { id: 'fixture', status: 'locked', lockAt: null }, competition: { id: 1, name: 'CFP fixture', season: 2026 },
  group: { id: 'group1', name: 'Test Group', slug: 'one' }, provider: { availability: 'available' },
  rounds: [{ key: 'semifinal', label: 'Semifinals', order: 1 }, { key: 'championship', label: 'Championship', order: 2 }],
  games: topology.games.map((game, index) => ({ gameKey: game.id, bracketGameId: index + 1, roundKey: game.roundKey, roundOrder: game.roundOrder,
    gameOrder: game.gameOrder, scheduledAt: null, officialStatus: 'scheduled', participants: {
      a: { status: 'unresolved', sourceLabel: 'Winner of left semifinal' }, b: { status: 'unresolved', sourceLabel: 'Winner of right semifinal' } },
    provider: index < 2 ? { mappingState: 'valid', game: index === 0 ? leftGame : rightGame } : { mappingState: 'unmapped' } })) };
const detail = game => ({ ...captured, eventId: game.espnEventId,
  header: { competitions: [{ ...captured.header.competitions[0], status: { type: { state: 'post', shortDetail: 'Final', completed: true } },
    competitors: [game.awayTeam, game.homeTeam].map((team, index) => ({ id: team.id, team: { ...team, logos: [] }, homeAway: index ? 'home' : 'away', score: '17' })) }] },
  gameStory: { headline: 'Fixture summary', description: 'Captured football details with fixture teams.' } });

async function installFixtureRoutes(page, state) {
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    let body = {};
    if (url.pathname.endsWith('/live')) body = live;
    else if (url.pathname.endsWith('/game-detail')) body = detail(url.searchParams.get('eventId') === 'event-right' ? rightGame : leftGame);
    else if (url.pathname.endsWith('/implications')) {
      const gameId = url.searchParams.get('gameId'), id = Number(url.searchParams.get('entryId'));
      if (state.fail && gameId) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture failure' }) });
      body = fixtureResponse(gameId, id, state.subjects ?? subjects, state.results ?? {}, state.pool ?? 'available');
      if (state.delay && gameId) { state.pending.push({ route, body }); return; }
    } else if (url.pathname === '/api/me') body = { authenticated: true, user: { id: 'viewer', displayName: 'Mark', role: 'player', avatarUrl: null } };
    else if (url.pathname === '/api/groups/context') body = { context: null, groups: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('CFP inline components keep selection, tabs, stale-request guards and error retry at mobile/desktop widths', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE for Chromium interactions',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const root = path.resolve(__dirname, '..');
      const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
        .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
      await page.setContent(`<style>${css.css}</style><header>App navigation fixture</header><div id="center"></div>`);
      await page.addScriptTag({ content: require('./helpers/football-browser-bundle.cjs')({ bracket: true }) });
      await page.evaluate(({ response, leftGame, rightGame, leftDetail, rightDetail }) => {
        window.state = { id: null, tab: 'summary', gameId: 'left' }; window.slow = false; window.pending = []; window.fail = false;
        window.responses = response; window.games = { left: leftGame, right: rightGame };
        window.fetch = async url => {
          if (url.includes('game-detail')) return { ok: true, json: async () => url.includes('event-right') ? rightDetail : leftDetail };
          if (!url.includes('?')) return { ok: true, json: async () => ({ ...responses.left[1], subject: null, analysis: null, game: null }) };
          const p = new URL(url, 'http://fixture').searchParams, id = Number(p.get('entryId')), gameId = p.get('gameId');
          const body = responses[gameId][id];
          if (slow) return new Promise(resolve => pending.push({ resolve, body })); // intentionally ignores AbortSignal
          return { ok: !fail, json: async () => fail ? { error: 'Fixture failure' } : body };
        };
        window.root = ReactDOMClient.createRoot(document.getElementById('center'));
        window.renderCenter = () => root.render(React.createElement(BracketGameCenter, {
          contestId: 'fixture', gameId: state.gameId, game: games[state.gameId], tab: state.tab,
          selection: state.id ? { entryId: state.id } : null, selectionRequested: state.id !== null,
          onSelectionChange: subject => { state.id = subject?.entryId ?? null; renderCenter(); },
          onTabChange: tab => { state.tab = tab; renderCenter(); }, onBack() {},
        }));
        renderCenter();
      }, { response: Object.fromEntries(['left', 'right'].map(gameId => [gameId, Object.fromEntries(subjects.map(subject => [subject.entryId, fixtureResponse(gameId, subject.entryId)]))])),
        leftGame, rightGame, leftDetail: detail(leftGame), rightDetail: detail(rightGame) });
      await page.getByText('Fixture summary', { exact: true }).waitFor();
      assert.equal(await page.getByRole('combobox').count(), 0);
      await page.getByRole('button', { name: 'Implications', exact: true }).click();
      await page.getByText('You need Ole Miss here. Josh has even more riding on them.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('combobox').inputValue(), 'm1');
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.evaluate(() => { slow = true; });
      await page.getByRole('combobox').selectOption('m2');
      await page.getByText('Loading implications…', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-bracket-implications] header h2').count(), 0);
      await page.waitForFunction(() => pending.length === 1);
      await page.getByRole('combobox').selectOption('m3');
      await page.waitForFunction(() => pending.length === 2);
      await page.evaluate(() => pending[1].resolve({ ok: true, json: async () => pending[1].body }));
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Nico' }).waitFor();
      await page.evaluate(() => pending[0].resolve({ ok: true, json: async () => pending[0].body }));
      await page.waitForTimeout(100);
      assert.doesNotMatch(await page.locator('[data-bracket-implications] header h2').innerText(), /Josh/);
      await page.evaluate(() => { state.gameId = 'right'; renderCenter(); });
      await page.waitForFunction(() => pending.length === 3);
      await page.getByText('Loading implications…', { exact: true }).waitFor();
      await page.evaluate(() => { state.gameId = 'left'; renderCenter(); });
      await page.waitForFunction(() => pending.length === 4);
      await page.evaluate(() => pending[3].resolve({ ok: true, json: async () => pending[3].body }));
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Nico' }).waitFor();
      await page.evaluate(() => pending[2].resolve({ ok: true, json: async () => pending[2].body }));
      await page.waitForTimeout(100);
      assert.match(await page.locator('[data-bracket-implications] header h2').innerText(), /Nico/);
      assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth));
      await page.evaluate(() => { slow = false; });
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      await page.getByText('Fixture summary', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByLabel('Selected football play replay', { exact: true }).first().waitFor();
      await page.getByRole('button', { name: 'Player Stats', exact: true }).click();
      await page.getByRole('button', { name: 'Implications', exact: true }).click();
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Nico' }).waitFor();
      await page.evaluate(() => { fail = true; });
      await page.getByRole('combobox').selectOption('m4');
      await page.getByText('Fixture failure', { exact: false }).waitFor();
      await page.evaluate(() => { fail = false; });
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Andy' }).waitFor();
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Next Dev CFP page replaces games inline, preserves header/URL state across browser history and refresh', {
  skip: !(process.env.FOOTBALL_BROWSER_MODULE && process.env.BRACKET_DEV_BROWSER_URL) && 'Set FOOTBALL_BROWSER_MODULE and BRACKET_DEV_BROWSER_URL for real Next routing',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const state = { pending: [] }; await installFixtureRoutes(page, state);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const base = `${process.env.BRACKET_DEV_BROWSER_URL}/bracket-challenge/fixture/live`;
      await page.goto(base);
      await page.getByText('CFP seeds', { exact: false }).count();
      await page.getByText('Ole Miss', { exact: true }).first().waitFor();
      assert.equal(await page.getByRole('combobox', { name: 'Viewing bracket' }).count(), 0);
      await page.getByText('Ole Miss', { exact: true }).first().click();
      await page.getByRole('button', { name: 'Back to games', exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('gameId'), 'left');
      assert.equal(await page.getByRole('heading', { name: 'Semifinals', exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Live Scores', exact: true }).count(), 1);
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: 'Play-by-Play', exact: true }).click();
      await page.getByLabel('Selected football play replay', { exact: true }).first().waitFor();
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(150);
      await page.getByLabel('Selected football play replay', { exact: true }).nth(1).waitFor();
      const compact = page.locator('main .sticky');
      assert.ok(Math.abs((await compact.boundingBox()).y) < 2, JSON.stringify(await compact.evaluate(element => {
        const ancestors = []; for (let node = element; node; node = node.parentElement) { const s = getComputedStyle(node); ancestors.push({ tag: node.tagName, class: node.className, x: s.overflowX, y: s.overflowY, top: node.getBoundingClientRect().top }); }
        return ancestors;
      })));
      if (width < 640) assert.equal(await page.locator('main').evaluate(element => getComputedStyle(element).overflowY), 'visible');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole('button', { name: 'Implications', exact: true }).click();
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'You' }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('entryId'), '1');
      assert.equal(new URL(page.url()).searchParams.get('tab'), 'implications');
      await page.getByRole('combobox', { name: 'Viewing bracket' }).selectOption('m2');
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Josh' }).waitFor();
      await page.getByRole('button', { name: 'Summary', exact: true }).click();
      await page.getByText('Fixture summary', { exact: true }).waitFor();
      await page.goBack();
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Josh' }).waitFor();
      await page.goForward();
      await page.getByText('Fixture summary', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Implications', exact: true }).click();
      await page.reload();
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Josh' }).waitFor();
      await page.getByRole('button', { name: 'Back to games', exact: true }).click();
      await page.getByRole('heading', { name: 'Semifinals', exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('entryId'), '2');
      await page.getByText('Ohio State', { exact: true }).first().click();
      await page.locator('[data-bracket-implications] header h2').filter({ hasText: 'Josh' }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('gameId'), 'right');
      await page.getByRole('button', { name: 'Refresh game center', exact: true }).click();
      await page.getByRole('button', { name: 'Back to games', exact: true }).click();
      await page.getByRole('button', { name: 'View implications →', exact: true }).click();
      await page.getByText('Josh earns 18 points', { exact: true }).count();
      await page.getByText('If they reach this game, a loss would end it.', { exact: false }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('gameId'), 'final');
      await page.goto(`${base}?gameId=missing&tab=implications&entryId=2`);
      await page.getByText('This game is unavailable in this CFP contest.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Back to games', exact: true }).click();
      await page.getByRole('heading', { name: 'Semifinals', exact: true }).waitFor();
      // An ambiguous account default never selects the first personal entry.
      state.subjects = [subjects[0], { ...subjects[1], isAccountOwner: true }];
      await page.goto(`${base}?gameId=left&tab=implications`);
      await page.getByText('Choose whose bracket to explore.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('combobox', { name: 'Viewing bracket' }).inputValue(), '');
      assert.equal(new URL(page.url()).searchParams.has('entryId'), false);
      // An invalid explicit subject also never silently defaults.
      await page.goto(`${base}?gameId=left&tab=implications&entryId=99`);
      await page.getByText('That bracket is unavailable or private.', { exact: false }).waitFor();
      state.subjects = subjects; state.results = { left: 'B' };
      await page.goto(`${base}?gameId=left&tab=implications&entryId=2`);
      await page.locator('[data-story-kind="result_recap"] h2').filter({ hasText: 'LSU won.' }).waitFor();
      assert.equal(await page.getByText('If Ole Miss wins', { exact: true }).count(), 0);
      assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth));
      await page.screenshot({ path: `/tmp/bracket-phase1b-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
