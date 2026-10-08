/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: loaded, exports: loaded.exports,
    require(id) { if (id in mocks) return mocks[id]; throw Error(`Unexpected import: ${id}`); },
  });
  return loaded.exports;
}
const games = load('lib/sports.ts', {}).PLATFORM_GAMES;
async function landing(user, contexts = [], activeId = 'a') {
  let contextReads = 0;
  const page = load('app/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/components/platform/InstallAppButton': { default: () => React.createElement('button', {}, 'Install 111 Sports') },
    '@/components/platform/PlatformAccountMenu': { default: props => React.createElement('div', { 'data-account': props.displayName }, JSON.stringify(props.groups)) },
    '@/components/platform/PlatformGroupCard': { default: ({ group }) => React.createElement('a', { href: `/groups/${group.slug}`, 'data-team': group.teamName }, group.name) },
    '@/lib/auth': { getCurrentUser: async () => user },
    '@/lib/groups/context': {
      getGroupContextForUser: async () => { contextReads++; return contexts.find(context => context.group.id === activeId); },
      getAvailableGroupContextsForUser: async () => { contextReads++; return contexts; },
    },
    '@/lib/sports': { PLATFORM_GAMES: games },
  });
  return { markup: renderToStaticMarkup(await page.default()), contextReads };
}

test('public landing describes the private clubhouse and supported games without promotional imagery', async () => {
  const { markup, contextReads } = await landing(null);
  assert.match(markup, /Four friends\.<br\/> <span[^>]*>Too many fantasy games\./);
  assert.match(markup, /private, noncommercial fantasy sports project for Mark, Jon, Josh, and Andy/);
  assert.match(markup, /href="\/login"/);
  assert.match(markup, /Install 111 Sports/);
  for (const game of games) assert.ok(markup.includes(renderToStaticMarkup(React.createElement(React.Fragment, null, game.label))));
  assert.doesNotMatch(markup, /<img|<iframe|shotcast|cloudinary|cdn\.nba|Get Started|create a group|new customers/i);
  assert.equal(contextReads, 0);
});

test('signed-in landing preserves active Group ordering, team identity and account navigation', async () => {
  const context = (id, name, team) => ({ group: { id, name, slug: id }, membership: { role: 'member' }, team: { name: team }, leagues: [{ id: `league-${id}`, sportKey: 'golf', name: 'Golf' }] });
  const { markup, contextReads } = await landing({ displayName: 'Mark', avatarUrl: null }, [context('b', 'Other Group', 'Other Team'), context('a', '111 Group', 'Mark Team')]);
  assert.equal(contextReads, 2);
  assert.match(markup, /data-account="Mark"/);
  assert.match(markup, /href="#your-groups"/);
  assert.ok(markup.indexOf('href="/groups/a"') < markup.indexOf('href="/groups/b"'));
  assert.match(markup, /data-team="Mark Team"/);
  assert.match(markup, /data-team="Other Team"/);
  const empty = await landing({ displayName: 'Jon', avatarUrl: null });
  assert.match(empty.markup, /href="\/profile\?tab=settings"/);
});

test('Dev landing and retired endpoints work at mobile and desktop widths', {
  skip: !(process.env.CLUBHOUSE_DEV_URL && process.env.FOOTBALL_BROWSER_MODULE) && 'Set CLUBHOUSE_DEV_URL and FOOTBALL_BROWSER_MODULE for Dev browser QA',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const requests = [], errors = [];
      page.on('request', request => requests.push(request.url()));
      page.on('pageerror', error => errors.push(error.message));
      // Intercept shared client context/heartbeat requests; no authenticated production access.
      await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Signed out"}' }));
      await page.goto(process.env.CLUBHOUSE_DEV_URL);
      await page.getByRole('heading', { level: 1, name: 'Four friends. Too many fantasy games.' }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Sign in', exact: true }).first().getAttribute('href'), '/login');
      assert.equal(await page.locator('img, iframe').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(!requests.some(url => /shotcast|hole-replay|pgatour|cdn\.nba/i.test(url)));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/111-clubhouse-${width}.png`, fullPage: true });
      await page.close();
    }
    const page = await browser.newPage();
    for (const endpoint of ['/api/golf/hole-replay?slateId=1&playerId=7&round=1&hole=1', '/api/golf/shotcast-manifest?slateId=1&tournamentId=R2026013', '/api/admin/golf/shotcast?slateId=1']) {
      const response = await page.request.get(new URL(endpoint, process.env.CLUBHOUSE_DEV_URL).href);
      assert.equal(response.status(), 410);
      assert.deepEqual(await response.json(), { error: 'ShotCast has been discontinued.' });
    }
    assert.equal((await page.request.post(new URL('/api/admin/golf/shotcast', process.env.CLUBHOUSE_DEV_URL).href, { data: { slateId: 1, tournamentId: 'R2026013' } })).status(), 410);
    for (const endpoint of ['/shotcast/R2026013/manifest.json', '/shotcast/R2026013/holes/hole-01.jpg']) {
      assert.equal((await page.request.get(new URL(endpoint, process.env.CLUBHOUSE_DEV_URL).href)).status(), 404);
    }
    await page.close();
  } finally { await browser.close(); }
});
