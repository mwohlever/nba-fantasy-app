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
function load(file, mocks = {}, globals = {}, extra = '') {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + extra, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: loaded, exports: loaded.exports, console, ...globals,
    require(id) { if (id in mocks) return mocks[id]; if (id === 'react/jsx-runtime') return require(id); throw Error(`Unexpected import: ${id}`); },
  });
  return loaded.exports;
}
const sports = load('lib/sports.ts');
const GameCard = load('components/platform/GameCard.tsx', {
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/image': { default: props => React.createElement('img', props) }, '@/lib/sports': sports,
}).default;
const calls = [], navigations = [];
const PlatformGroupCard = load('components/platform/PlatformGroupCard.tsx', {
  react: { useState: initial => [initial, () => {}] },
  '@/components/platform/GameCard': { default: GameCard }, '@/lib/sports': sports,
}, { fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: true }; },
  window: { location: { assign: href => navigations.push(href) }, alert() { throw Error('Unexpected navigation error'); } },
}).default;
const leagues = [
  ['nba', 'NBA', '/home?sport=nba'], ['nfl', 'NFL', '/home?sport=nfl'], ['golf', 'Golf', '/home?sport=golf'],
  ['ncaa_pickem', "College Football Pick'em", '/ncaa-pickem'], ['nba_skins', 'NBA Skins', '/nba-skins'],
  ['bracket_challenge', 'Bracket Challenge', '/bracket-challenge'],
];
const groups = ['111', 'Test Group'].map((name, index) => ({ name, slug: index ? 'test' : '111', role: 'admin', teamName: 'Mark', isActive: !index,
  leagues: leagues.map(([sportKey, name], i) => ({ id: `${index}-${i}`, sportKey, name })) }));
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}

test('111 and Test Group keep full shortcut names, sport icons, links and Group activation', async () => {
  calls.length = 0; navigations.length = 0;
  for (const group of groups) {
    const tree = PlatformGroupCard({ group });
    const cards = nodes(tree).filter(node => node.type === GameCard);
    assert.equal(cards.length, leagues.length);
    for (const [i, card] of cards.entries()) {
      assert.equal(card.props.name, leagues[i][1]); assert.equal(card.props.href, leagues[i][2]);
      const shortcut = GameCard(card.props);
      const label = nodes(shortcut).find(node => node.props?.children === card.props.name);
      assert.match(label.props.className, /whitespace-normal/);
      assert.doesNotMatch(label.props.className, /truncate|line-clamp/);
      const image = nodes(shortcut).find(node => node.props?.width === 36);
      assert.equal(image.props.src, sports.getSportConfig(card.props.sportKey).logo);
      let prevented = false;
      card.props.onClick({ preventDefault() { prevented = true; } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(prevented, true);
      assert.equal(JSON.parse(calls.at(-1).body).groupSlug, group.slug);
      assert.equal(calls.at(-1).url, '/api/groups/active'); assert.equal(calls.at(-1).method, 'POST');
      assert.equal(navigations.at(-1), leagues[i][2]);
    }
    nodes(tree).find(node => node.type === 'button').props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(navigations.at(-1), `/groups/${group.slug}`);
  }
});

const presentation = load('lib/golf/scorePresentation.ts');
const { RoundScorecard } = load('components/lineups/GolfPlayerModal.tsx', {
  react: React, '@/components/ui/PlayerHeadshot': { default: () => null }, '@/lib/golf/scorePresentation': presentation,
}, {}, '\nexports.RoundScorecard = RoundScorecard;');
const relatives = [-2, -1, 0, 1, 2, ...Array(13).fill(0)];
const round = { round_number: 2, holes_completed: 18, score_to_par: 0, strokes: 72,
  holes: relatives.map((relative_to_par, i) => ({ hole_number: i + 1, par: 3 + i % 3,
    strokes: 3 + i % 3 + relative_to_par, relative_to_par, yards: 400 + i })) };
const roundProps = { round, contextLabel: 'Most recent round', isExpanded: true, onToggle() {} };

test('scorecard keeps all 18 scores, pars, colors and totals with only a round toggle', () => {
  let toggles = 0;
  const tree = RoundScorecard({ ...roundProps, onToggle() { toggles++; } });
  const elements = nodes(tree);
  const holes = elements.filter(node => String(node.props?.['aria-label'] ?? '').startsWith('Hole '));
  assert.equal(holes.length, 18);
  assert.equal(elements.filter(node => node.key?.startsWith('par-')).length, 18);
  holes.forEach((hole, i) => {
    assert.equal(hole.type, 'div'); assert.equal(hole.props.onClick, undefined); assert.equal(hole.props.tabIndex, undefined);
    assert.match(hole.props['aria-label'], new RegExp(`Hole ${i + 1} · Par ${round.holes[i].par}`));
    assert.equal(hole.props.children, relatives[i] === 0 ? 'E' : relatives[i] > 0 ? `+${relatives[i]}` : String(relatives[i]));
    assert.ok(hole.props.className.includes(presentation.golfHoleResultClass(relatives[i])));
  });
  const buttons = elements.filter(node => node.type === 'button');
  assert.equal(buttons.length, 1); assert.equal(buttons[0].props['aria-expanded'], true);
  buttons[0].props.onClick(); assert.equal(toggles, 1);
  const markup = renderToStaticMarkup(tree);
  assert.match(markup, /72 strokes/); assert.match(markup, />E<\/strong>/);
  assert.doesNotMatch(markup, /Close hole details/);
  const collapsed = RoundScorecard({ ...roundProps, isExpanded: false });
  assert.equal(nodes(collapsed).filter(node => node.props?.['aria-label']).length, 0);
  assert.equal(nodes(collapsed).find(node => node.type === 'button').props['aria-expanded'], false);
});

test('both Group cards and the 18-hole scorecard fit at mobile and desktop widths', {
  skip: !process.env.FOOTBALL_BROWSER_MODULE && 'Set FOOTBALL_BROWSER_MODULE for browser layout QA',
}, async () => {
  const { chromium } = require(process.env.FOOTBALL_BROWSER_MODULE);
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: true })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  const markup = renderToStaticMarkup(React.createElement('main', { className: 'mx-auto max-w-4xl px-5 py-8 sm:px-8 text-white' },
    React.createElement('div', { id: 'groups', className: 'grid gap-4 lg:grid-cols-2' }, groups.map(group => React.createElement(PlatformGroupCard, { key: group.slug, group }))),
    React.createElement('div', { id: 'scorecard', className: 'mt-8' }, React.createElement(RoundScorecard, roundProps))));
  const browser = await chromium.launch();
  try {
    for (const width of [360, 390, 768, 1024, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.route('**/*', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body class="bg-slate-950">${markup}</body></html>` });
        if (pathname.startsWith('/logos/')) return route.fulfill({ path: path.join(root, 'public', pathname) });
        return route.fulfill({ status: 404, body: '' });
      });
      await page.goto('http://clubhouse.test/');
      for (const [i, group] of groups.entries()) {
        const card = page.locator('#groups > section').nth(i);
        assert.equal(await card.locator('h3').innerText(), group.name);
        for (const [sportKey, name, href] of leagues) {
          const shortcut = card.locator(`a[href="${href}"]`);
          assert.equal(await shortcut.getAttribute('href'), href);
          const label = shortcut.locator('span').first();
          assert.equal(await label.innerText(), name);
          const visible = await label.evaluate(el => {
            const style = getComputedStyle(el), range = document.createRange(); range.selectNodeContents(el);
            const parent = el.closest('a').getBoundingClientRect();
            return style.textOverflow !== 'ellipsis' && style.whiteSpace !== 'nowrap' && [...range.getClientRects()].every(rect => rect.left >= parent.left && rect.right <= parent.right);
          });
          assert.ok(visible, `${group.name}: ${name} must be fully visible at ${width}px`);
          assert.equal(await shortcut.locator('img').getAttribute('src'), sports.getSportConfig(sports.sportKeyFromLeagueSportKey(sportKey)).logo);
        }
      }
      const scorecard = page.locator('#scorecard');
      const holes = scorecard.locator('[aria-label^="Hole "]');
      assert.equal(await holes.count(), 18);
      assert.equal(await scorecard.getByRole('button').count(), 1);
      await holes.first().click();
      assert.equal(await scorecard.getByLabel('Close hole details').count(), 0);
      assert.equal(await scorecard.getByText('72 strokes', { exact: true }).count(), 1);
      const scroller = scorecard.locator('.overflow-x-auto');
      await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      await holes.last().click();
      assert.equal(await scorecard.getByLabel('Close hole details').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `/tmp/111-ui-polish-${width}.png`, fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});
