/** Engineering evidence: real Phase 3 components/endpoints; no Scores slate or database mutation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.SHOTCAST_PLAYWRIGHT_MODULE).href);
const base = process.env.SHOTCAST_APP_URL ?? 'http://localhost:3001';
const output = process.env.SHOTCAST_PREPARATION_BROWSER_OUTPUT ?? 'tmp/shotcast-phase4b/browser'; fs.mkdirSync(output, { recursive: true });
const replay = JSON.parse(fs.readFileSync('tmp/shotcast-phase4b/replay.json'));
const numeric = JSON.parse(fs.readFileSync('tmp/shotcast-phase4b/numeric-proof.json'));
const images = new Map();
for (const [key, url] of Object.entries(replay.shotcast).filter(([k, u]) => /imageUrl/i.test(k) && typeof u === 'string')) {
  const file = `tmp/shotcast-phase4b/${key}.bin`;
  if (!fs.existsSync(file)) { const r = await fetch(url); assert.ok(r.ok); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); }
  images.set(url, fs.readFileSync(file));
}
const browser = await chromium.launch({ executablePath: process.env.SHOTCAST_CHROMIUM_BIN, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
const expected = Object.fromEntries([['tee', numeric.world.tee], ['pin', numeric.world.pin], ...numeric.world.shots.flatMap(s => [[`shot-${s.strokeNumber}`, s.from], [`from-${s.strokeNumber}`, s.from], [`to-${s.strokeNumber}`, s.endpoint]])]);
async function setup(viewport, failure) {
  const context = await browser.newContext({ viewport });
  if (failure === 'webgl') await context.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : original.call(this, type, ...args); }; });
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/golf/shotcast-3d-dev') {
      if (failure === 'asset' && url.searchParams.get('asset') === 'h10-terrain') return route.fulfill({ status: 503, body: '' });
      if (failure === 'preparation' && route.request().method() === 'POST') return route.fulfill({ json: null });
      return route.continue();
    }
    // Isolate application-wide account/heartbeat hooks; no mutation reaches any database.
    return route.fulfill({ json: { user: null, activeGroup: null, memberships: [], notifications: [], enabled: false } });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (images.has(url.href)) return route.fulfill({ contentType: 'image/jpeg', body: images.get(url.href) });
    return route.fallback();
  });
  const page = await context.newPage(), errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`${base}/shotcast-3d-proof`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return { context, page, errors, consoleErrors };
}
async function world(page) { return page.locator('[data-shotcast-world]').evaluate(e => JSON.parse(e.dataset.shotcastWorld)); }
async function snapshot(page, name) {
  await page.screenshot({ path: `${output}/${name}-page.png` });
  await page.locator('canvas').screenshot({ path: `${output}/${name}-canvas.png` });
}
try {
  for (const [label, viewport] of [['desktop', { width: 1400, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const s = await setup(viewport), { page } = s;
    await page.locator('[data-shotcast-view="3d"]').waitFor({ timeout: 90000 });
    await page.locator('canvas').scrollIntoViewIfNeeded();
    assert.deepEqual(await world(page), expected);
    assert.equal(await page.locator('[data-shot-marker]').count(), 3);
    const host = page.locator('[data-shotcast-world]');
    const paths = await host.evaluate(e => JSON.parse(e.dataset.shotcastFlightPaths));
    assert.ok(paths.some(p => p.strokeNumber === 1));
    assert.deepEqual(await host.evaluate(e => JSON.parse(e.dataset.shotcastPuttPaths)), []);
    await snapshot(page, `${label}-course`);
    await host.evaluate(e => { e.__frames = []; const observer = new MutationObserver(() => e.__frames.push(JSON.parse(e.dataset.shotcastFlight))); observer.observe(e, { attributes: true, attributeFilter: ['data-shotcast-flight'] }); e.__observer = observer; });
    await page.getByRole('button', { name: 'Replay shot 1', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight).phase === 'playing');
    await snapshot(page, `${label}-flight`);
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight).phase === 'finished', {}, { timeout: 30000 });
    const frames = await host.evaluate(e => { e.__observer.disconnect(); return e.__frames; });
    assert.deepEqual(frames.find(f => f.phase === 'playing').position, expected['from-1']);
    assert.deepEqual(frames.at(-1).position, expected['to-1']);
    assert.deepEqual(await world(page), expected);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('button', { name: 'Green', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-shotcast-flow]') && JSON.parse(document.querySelector('[data-shotcast-flow]').dataset.shotcastFlow).elapsed > 0);
    const topo = await host.evaluate(e => JSON.parse(e.dataset.shotcastTopography));
    const flow1 = await host.evaluate(e => JSON.parse(e.dataset.shotcastFlow));
    await page.waitForTimeout(350);
    const flow2 = await host.evaluate(e => JSON.parse(e.dataset.shotcastFlow));
    assert.ok(topo.elevationRange.high - topo.elevationRange.low > 0.5);
    assert.ok(flow2.elapsed > flow1.elapsed); assert.notDeepEqual(flow1.positions, flow2.positions); assert.equal(flow2.retainedHeads, 28);
    assert.deepEqual(await world(page), expected);
    await snapshot(page, `${label}-green`);
    const rect = await page.locator('canvas').boundingBox();
    await page.mouse.move(rect.x + rect.width * .35, rect.y + rect.height * .65); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .55, rect.y + rect.height * .65, { steps: 6 }); await page.mouse.up(); await page.mouse.wheel(0, -100);
    assert.deepEqual(await world(page), expected); await snapshot(page, `${label}-green-orbit`);
    await page.getByRole('button', { name: 'Course', exact: true }).click();
    await page.getByRole('button', { name: '▶ Play Hole (2D)', exact: true }).click();
    await page.locator('[data-shotcast-view="2d"]').waitFor();
    await page.getByRole('button', { name: 'Course', exact: true }).click();
    await page.locator('[data-shotcast-view="3d"]').waitFor(); assert.deepEqual(await world(page), expected);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(s.errors, []); assert.deepEqual(s.consoleErrors, []);
    report.push({ viewport: label, result: 'PASS', registeredWorld: true, exactFlightBoundaries: true, detailedGreen: topo, flow: { count: flow2.count, retainedHeads: flow2.retainedHeads }, supportedFlights: paths.map(p => p.strokeNumber), suppliedPutts: 0, fallbackEscape: true });
    await s.context.close();
  }
  for (const failure of ['asset', 'preparation', 'webgl']) {
    const s = await setup({ width: 390, height: 844 }, failure);
    await s.page.waitForFunction(() => { const e = document.querySelector('[data-shotcast-view]'); return e && e.dataset.shotcastView === '2d' && !['loading_preparation', 'waiting_first_frame'].includes(e.dataset.shotcastReason); }, {}, { timeout: 90000 });
    report.push({ failure, result: 'PASS', reason: await s.page.locator('[data-shotcast-view]').getAttribute('data-shotcast-reason'), pageErrors: s.errors });
    await s.context.close();
  }
} finally { fs.writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify(report.map(r => ({ viewport: r.viewport, failure: r.failure, result: r.result }))));
