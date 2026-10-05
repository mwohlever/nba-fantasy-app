/** ENGINEERING harness: current components, captured DB snapshot and intercepted replay.
 * This is not authenticated normal Scores/Live acceptance. No app preview route. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { preservedReplay } from './current-provider.mjs';
import { importTs } from './module-loader.mjs';
const { createFlightReveal } = await importTs('lib/shotcast/flightReplay.ts');
const testFlights = process.env.SHOTCAST_TEST_FLIGHTS === '1';
const visualPass = process.env.SHOTCAST_GREEN_VISUAL_PASS;
const { decodeTerrainGlb } = await importTs('lib/shotcast/productionGeometry.ts');
const { createGreenTopography } = await importTs('lib/shotcast/greenTopography.ts');
const { createPuttReplay } = await importTs('lib/shotcast/puttReplay.ts');

const tooling = process.env.SHOTCAST_PLAYWRIGHT_MODULE;
if (!tooling || !process.env.SHOTCAST_CHROMIUM_BIN) throw new Error('Set SHOTCAST_PLAYWRIGHT_MODULE and SHOTCAST_CHROMIUM_BIN; see Take 2 documentation.');
const { chromium } = await import(pathToFileURL(tooling).href);
const base = process.env.SHOTCAST_APP_URL ?? 'http://localhost:3002';
const history = process.env.SHOTCAST_HISTORY_URL ?? 'http://127.0.0.1:54329';
const output = process.env.SHOTCAST_BROWSER_OUTPUT ?? 'tmp/shotcast-take2/browser';
fs.mkdirSync(output, { recursive: true });
const replays = new Map(), images = new Map();
const cases = [
  { packageId: 'pga-71908773-fb52-47d0-bb1e-f44f50b34965', player: '34098', name: 'Russell Henley', slate: 163, course: 'southwind' },
  { packageId: 'pga-71908773-fb52-47d0-bb1e-f44f50b34965', player: '46046', name: 'Scottie Scheffler', slate: 163, course: 'southwind-scheffler', path: 'Scores', team: 'Jon' },
  { packageId: 'pga-6dd7c507-1e90-4bbc-a90e-8cbff49b24b3', player: '61522', name: 'Michael Brennan', slate: 162, course: 'sedgefield' },
];
for (const fixture of cases) {
  const descriptor = JSON.parse(fs.readFileSync(`tmp/shotcast-ingestion/packages/${fixture.packageId}/descriptor.json`, 'utf8'));
  for (const hole of [1, 2]) {
    const schefflerDescriptor = { ...descriptor, selection: { ...descriptor.selection, playerId:'46046' },
      shotSource: { ...descriptor.shotSource, identity: { ...descriptor.shotSource.identity, playerName:'Scottie Scheffler' }, source: { localPath:'tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json' } } };
    const replay = testFlights && fixture.player === '46046' && hole === 1
      ? (await preservedReplay(schefflerDescriptor, hole)).replay
      : fixture.player === '46046'
      ? JSON.parse(fs.readFileSync(`tmp/shotcast-activation/scheffler-st-jude-replay${hole === 2 ? '-h2' : ''}.json`))
      : (await preservedReplay(descriptor, hole)).replay;
    replays.set(`${fixture.player}/${hole}`, replay);
    for (const role of ['imageUrl', 'greenImageUrl']) {
      const filename = `tmp/shotcast-take2/${fixture.player}-hole${hole}-${role}.bin`;
      if (!fs.existsSync(filename)) {
        const response = await fetch(replay.shotcast[role]);
        assert.ok(response.ok, 'Current 2D imagery must be available for fallback validation');
        fs.writeFileSync(filename, new Uint8Array(await response.arrayBuffer()));
      }
      images.set(replay.shotcast[role], fs.readFileSync(filename));
    }
  }
}
const browser = await chromium.launch({ executablePath: process.env.SHOTCAST_CHROMIUM_BIN,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
const worldByIdentity = new Map();
async function sceneSnapshot(page) {
  return page.locator('[data-shotcast-world]').evaluate(element => ({
    world: JSON.parse(element.dataset.shotcastWorld),
    terrain: JSON.parse(element.dataset.shotcastTerrain),
    camera: JSON.parse(element.dataset.shotcastCamera),
    projections: JSON.parse(element.dataset.shotcastProjections),
    mode: element.dataset.shotcastMode,
    labels: [...element.querySelectorAll('[data-shot-marker], [data-shot-pin], [data-shot-tee]')].map(label => ({
      key: label.hasAttribute('data-shot-marker') ? `shot-${label.dataset.shotMarker}` : label.hasAttribute('data-shot-pin') ? 'pin' : 'tee',
      x: parseFloat(label.style.left), y: parseFloat(label.style.top), visible: label.style.display !== 'none',
    })),
  }));
}
function assertRegistered(snapshot, baseline) {
  assert.deepEqual(snapshot.world, baseline.world, 'EXACT world positions changed');
  assert.deepEqual(snapshot.terrain, baseline.terrain, 'Terrain world matrices changed');
  for (const key of Object.keys(snapshot.world).filter(key => key.startsWith('shot-'))) {
    assert.deepEqual(snapshot.world[key], snapshot.world[key.replace('shot-', 'from-')], 'Numbered marker must equal animation START');
  }
  for (const label of snapshot.labels) {
    const projection = snapshot.projections[label.key];
    assert.equal(label.visible, projection.visible);
    if (!label.visible) continue;
    assert.ok(Math.abs(label.x - projection.x) < 0.001, `${label.key} moved off its world projection in x`);
    assert.ok(Math.abs(label.y - projection.y) < 0.001, `${label.key} moved off its world projection in y`);
  }
}

async function setup(viewport, fixture, failure = null) {
  await fetch(`${history}/__select?slateId=${fixture.slate}`);
  const context = await browser.newContext({ viewport });
  await context.addCookies([{ name: 'nba_fantasy_session', value: 'shotcast-take2-local-validation', url: base }]);
  if (failure === 'webgl-unavailable') await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    };
  });
  let failedAssets = 0;
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/golf/hole-replay') {
      // Preserve real historical strokes and current provider normalization;
      // bypass only the production route's scoring reconciliation side effect.
      return route.fulfill({ json: { replay: replays.get(`${fixture.player}/${url.searchParams.get('hole')}`) ?? null } });
    }
    if (url.pathname === '/api/golf/shotcast-manifest') return route.fulfill({ json: { tournamentId: replays.get(`${fixture.player}/1`).tournamentId, holes: [] } });
    if (failure === 'asset' && url.pathname === '/api/golf/shotcast-3d-dev' && url.searchParams.get('asset') === 'terrain') {
      failedAssets++; return route.fulfill({ status: 503, body: '' });
    }
    if (failure === 'preparation' && url.pathname === '/api/golf/shotcast-3d-dev' && route.request().method() === 'POST') {
      failedAssets++; return route.fulfill({ json: null });
    }
    if (url.pathname === '/api/golf/shotcast-3d-dev' && route.request().method() === 'POST') return route.continue();
    if (route.request().method() !== 'GET' || !/^\/api\/(golf\/(fantasy|shotcast-3d-dev)|groups\/context|me|home-summary|lineups|team-results|slate-availability|player-stats)/.test(url.pathname)) {
      return route.fulfill({ json: { ok: true, enabled: false, preferences: [], notifications: [] } });
    }
    return route.continue();
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (images.has(url.href)) return route.fulfill({ contentType: 'image/jpeg', body: images.get(url.href) });
    if (url.origin !== new URL(base).origin) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"/>' });
    return route.fallback();
  });
  const page = await context.newPage(), errors = [], consoleErrors = [];
  page.on('response', response => { if (response.status() >= 400) console.log('HTTP', response.status(), response.url()); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  return { context, page, errors, consoleErrors, failedAssets: () => failedAssets };
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), 'Page horizontal overflow');
  const modal = page.getByRole('dialog');
  if (await modal.count()) assert.ok(await modal.evaluate(e => e.scrollWidth <= e.clientWidth), 'Modal horizontal overflow');
}
async function openCurrentReplay(page, fixture) {
  await page.goto(`${base}${fixture.path === 'Scores' ? '/lineups/scores?sport=golf' : '/golf/live'}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (fixture.path === 'Scores') await page.getByText(fixture.team, { exact: true }).first().click({ timeout: 60000 });
  await page.getByText(fixture.name, { exact: true }).first().click({ timeout: 60000 });
  const modal = page.getByRole('dialog', { name: `${fixture.name} Golf scorecard` });
  const round = modal.getByRole('button', { name: /Round 1/ });
  if (await round.getAttribute('aria-expanded') !== 'true') await round.click({ timeout: 60000 });
  await modal.getByRole('button', { name: /Round 1/ }).locator('..').getByRole('button', { name: /^Hole 1 ·/ }).click();
  return modal;
}
async function await3d(page) {
  await page.locator('[data-shotcast-view="3d"]').waitFor({ timeout: 90000 });
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}
async function fallback(page) {
  await page.locator('[data-shotcast-view="2d"]').waitFor({ timeout: 30000 });
  await page.locator('[data-shotcast-view="2d"] img').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-shotcast-view="2d"] img')].some(e => e.complete && e.naturalWidth > 0));
  assert.equal(await page.locator('canvas').count(), 0);
}
try {
  if (visualPass) await captureGreenVisuals();
  else {
  for (const [label, viewport] of [['desktop', { width: 1400, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    // Current Scores UI and its actual fantasy golfer/hole interaction.
    const state = await setup(viewport, cases[0]);
    const { page } = state;
    await page.goto(`${base}/lineups/scores?sport=golf`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByText('Josh', { exact: true }).first().waitFor({ timeout: 60000 });
    for (const team of ['Jon', 'Mark', 'Andy', 'Josh']) assert.ok(await page.getByText(team, { exact: true }).count());
    for (const round of [1, 2, 3, 4]) await page.getByRole('button', { name: `Select round ${round}`, exact: true }).click();
    await page.getByRole('button', { name: 'Select round 1', exact: true }).click();
    await page.getByText('Josh', { exact: true }).first().click();
    await page.getByText('Sam Burns', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'League', exact: true }).count(), 0);
    await noOverflow(page);
    await page.screenshot({ path: `${output}/scores-${label}.png` });
    await page.getByText('Sam Burns', { exact: true }).first().click();
    const scorecard = page.getByRole('dialog', { name: 'Sam Burns Golf scorecard' });
    const round1 = scorecard.getByRole('button', { name: /Round 1/ });
    if (await round1.getAttribute('aria-expanded') !== 'true') await round1.click();
    assert.equal(await round1.locator('..').getByRole('button', { name: /^Hole \d+ ·/ }).count(), 18);
    // The golfer is really drafted; no fabricated 3D preparation for his identity.
    await contextNullReplay(state, round1.locator('..'));
    await noOverflow(page);
    assert.equal(state.errors.length, 0);
    report.push({ path: 'Scores → Josh → Sam Burns → R1 → H1', viewport: label, scoreGrid: 18, errors: state.errors, consoleErrors: state.consoleErrors });
    await state.context.close();
    for (const fixture of cases) {
      const s = await setup(viewport, fixture), p = s.page;
      const modal = await openCurrentReplay(p, fixture);
      await await3d(p);
      const baseline = await sceneSnapshot(p);
      const identity = `${fixture.player}/1`;
      if (worldByIdentity.has(identity)) assert.deepEqual(baseline.world, worldByIdentity.get(identity), 'Viewport changed world geometry');
      else worldByIdentity.set(identity, baseline.world);
      if (fixture.player === '46046') {
        assert.deepEqual(baseline.world.tee, [-115.68310546875,378.721435546875,10.874481308178765]);
        assert.deepEqual(baseline.world['shot-1'], baseline.world.tee);
        assert.deepEqual(baseline.world['shot-2'], [-296.1064453125,204.69482421875,10.945296698560316]);
        assert.deepEqual(baseline.world['shot-3'], [-304.60595703125,66.57177734375,10.939206175918256]);
        assert.deepEqual(baseline.world['shot-4'], [-317.108154296875,69.351318359375,11.014807185703452]);
        assert.deepEqual(baseline.world.pin, [-315.5849609375,68.565185546875,11.00063925622532]);
        assert.deepEqual(baseline.world.pin, baseline.world['to-4']);
        assert.notDeepEqual(baseline.world.pin, baseline.world['shot-4']);
        assert.deepEqual(baseline.world.tee, baseline.world['from-1']);
        for (let n=2; n<=4; n++) assert.deepEqual(baseline.world[`from-${n}`], baseline.world[`to-${n-1}`]);
      }
      const evidence = [{ action:'initial', ...baseline }];
      assertRegistered(baseline, baseline);
      const canvasIdentity = await p.locator('canvas').elementHandle();
      const count = replays.get(`${fixture.player}/1`).shots.length;
      const markers = p.locator('[data-shot-marker]');
      assert.equal(await markers.count(), count);
      for (const marker of await markers.all()) assert.ok(await marker.isVisible(), 'Hidden starting marker in course view');
      assert.equal(await p.getByLabel('Hole tee', { exact: true }).count(), 0);
      const pin = await p.locator('[data-shotcast-pin-presentation]').evaluate(e=>JSON.parse(e.dataset.shotcastPinPresentation));
      assert.deepEqual(pin.anchor,baseline.world.pin);
      assert.equal(await modal.getByRole('button',{name:/Replay shot .*\(3D\)/}).count(),0);
      if (testFlights && ['46046','61522'].includes(fixture.player)) {
        await verifyUnifiedReplay(p, modal, baseline, fixture, label);
      }
      await modal.getByRole('button',{name:'Course',exact:true}).click();
      await await3d(p);
      await noOverflow(p);
      await p.screenshot({ path: `${output}/${fixture.course}-${label}.png` });
      const canvas = p.locator('canvas'), before = await canvas.screenshot();
      const rect = await canvas.boundingBox();
      await p.mouse.move(rect.x + rect.width * .3, rect.y + rect.height * .65);
      await p.mouse.down(); await p.mouse.move(rect.x + rect.width * .4, rect.y + rect.height * .65, { steps: 8 }); await p.mouse.up();
      await p.waitForTimeout(400);
      assert.notDeepEqual(await canvas.screenshot(), before, 'Orbit must change the rendered view');
      const orbitSnapshot = await sceneSnapshot(p); assertRegistered(orbitSnapshot, baseline);
      assert.notDeepEqual(orbitSnapshot.projections, baseline.projections, 'Orbit should change SCREEN coordinates');
      evidence.push({ action:'orbit', ...orbitSnapshot });
      const orbited = await canvas.screenshot();
      await p.mouse.wheel(0, -120); await p.waitForTimeout(400);
      assert.notDeepEqual(await canvas.screenshot(), orbited, 'Zoom must change the rendered view');
      const zoomSnapshot = await sceneSnapshot(p); assertRegistered(zoomSnapshot, baseline);
      assert.notDeepEqual(zoomSnapshot.projections, orbitSnapshot.projections, 'Zoom should change SCREEN coordinates');
      evidence.push({ action:'zoom', ...zoomSnapshot });
      await modal.getByRole('button', { name: 'Reset', exact: true }).click();
      await await3d(p);
      const resetSnapshot = await sceneSnapshot(p); assertRegistered(resetSnapshot, baseline);
      evidence.push({ action: "reset", ...resetSnapshot });
      for (const marker of await markers.all()) assert.ok(await marker.isVisible());
      await modal.getByRole('button', { name: 'Green', exact: true }).click();
      await await3d(p);
      const greenSnapshot = await sceneSnapshot(p); assertRegistered(greenSnapshot, baseline);
      assert.equal(greenSnapshot.mode, 'green');
      assert.notDeepEqual(greenSnapshot.camera, baseline.camera);
      assert.ok(await canvasIdentity.evaluate(e=>e===document.querySelector('canvas')), 'Course/Green remounted renderer');
      evidence.push({ action:'green', ...greenSnapshot });
      await p.screenshot({ path: `${output}/${fixture.course}-${label}-green.png` });
      await modal.getByRole('button', {name:'Reset',exact:true}).click();
      await p.waitForTimeout(100); assertRegistered(await sceneSnapshot(p), baseline);
      await modal.getByRole('button', { name: 'Course', exact: true }).click();
      await await3d(p);
      const returned = await sceneSnapshot(p); assertRegistered(returned, baseline);
      evidence.push({ action:'course-return', ...returned });
      // Existing replay is deliberately retained as explicitly named 2D playback.
      await modal.getByRole('button', { name:'▶ Play Hole (2D)',exact:true }).click();
      await p.locator('[data-shotcast-view="2d"]').waitFor();
      assert.equal(await p.locator('canvas').isVisible(), false);
      assertRegistered(await sceneSnapshot(p), baseline);
      await modal.getByRole('button', {name:'Course',exact:true}).click();
      await await3d(p); assertRegistered(await sceneSnapshot(p), baseline);
      await modal.getByRole('button', { name: 'Close hole replay' }).click();
      await modal.getByRole('button', { name: /Round 1/ }).locator('..').getByRole('button', { name: /^Hole 2 ·/ }).click();
      await fallback(p); await noOverflow(p);
      await p.screenshot({ path: `${output}/${fixture.course}-${label}-unsupported.png` });
      await modal.getByRole('button', { name: 'Close hole replay' }).click();
      await modal.getByRole('button', { name: /Round 1/ }).locator('..').getByRole('button', { name: /^Hole 1 ·/ }).click();
      await await3d(p); await noOverflow(p);
      const remounted = await sceneSnapshot(p); assertRegistered(remounted, baseline);
      evidence.push({ action:'remount', ...remounted });
      fs.writeFileSync(`${output}/${fixture.course}-${label}-world.json`, JSON.stringify(evidence,null,2));
      assert.equal(s.errors.length, 0); assert.equal(s.consoleErrors.length, 0);
      report.push({ path: `${fixture.path ?? 'Live'} → ${fixture.name} → R1 → H1`, viewport: label, supported: '3D', unsupportedH2: '2D', markerSelection: true, orbit: true, zoom: true, reset: true, greenView: '3D-same-scene', worldInvariance: true, projectionAnchors: true, remount: true, overflow: false, errors: s.errors, consoleErrors: s.consoleErrors });
      await s.context.close();
    }
  }
  for (const failure of ['preparation', 'asset', 'webgl-unavailable', 'webgl-loss']) {
    const s = await setup({ width: 390, height: 844 }, cases[0], failure);
    await openCurrentReplay(s.page, cases[0]);
    if (failure === 'webgl-loss') {
      await await3d(s.page);
      await s.page.locator('canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    } else if (failure === 'asset' || failure === 'preparation') {
      for (let i = 0; i < 100 && s.failedAssets() === 0; i++) await s.page.waitForTimeout(100);
      assert.ok(s.failedAssets() > 0);
    } else await s.page.waitForTimeout(2500);
    await s.page.waitForTimeout(300);
    await fallback(s.page); await noOverflow(s.page);
    assert.equal(s.errors.length, 0);
    await s.page.screenshot({ path: `${output}/fallback-${failure}.png` });
    report.push({ failure, fallback: '2D', overflow: false, errors: s.errors, expectedInjectedConsoleErrors: s.consoleErrors });
    await s.context.close();
  }
  }
  const boundary = await (await fetch(`${history}/__report`)).json();
  assert.deepEqual(boundary.errors, []);
  assert.ok(boundary.mutations.every(mutation => mutation.table === 'user_sessions'));
  fs.writeFileSync(`${output}/results.json`, JSON.stringify({ validationKind: 'engineering-harness-not-normal-user-acceptance', report, boundary }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }

async function contextNullReplay(state, scorecard) {
  // Test Scores' real modal/panel opening without attributing Henley's strokes to Burns.
  await state.context.route('**/api/golf/hole-replay?**', route => route.fulfill({ json: { replay: null } }));
  await scorecard.getByRole('button', { name: /^Hole 1 ·/ }).click();
  await scorecard.getByText('Shot tracking unavailable', { exact: true }).waitFor();
  await scorecard.getByRole('button', { name: 'Close hole replay' }).click();
}

async function verifyUnifiedReplay(page, modal, baseline, fixture, viewport) {
  const host = page.locator('[data-shotcast-flight-paths]');
  const paths = await host.evaluate(e => JSON.parse(e.dataset.shotcastFlightPaths));
  assert.ok(paths.some(path => path.strokeNumber === 1));
  const frozenPaths = JSON.stringify(paths);
  const putts = await host.evaluate(e => JSON.parse(e.dataset.shotcastPuttPaths));
  const source = replays.get(`${fixture.player}/1`);
  const descriptor=JSON.parse(fs.readFileSync(`tmp/shotcast-ingestion/packages/${fixture.packageId}/descriptor.json`));
  const asset=descriptor.assets.find(a=>a.id==='green'),bytes=fs.readFileSync(asset.localPath);
  const topography=createGreenTopography(decodeTerrainGlb(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
  if(fixture.player==='46046')assert.deepEqual(putts.map(p=>p.samples.length),[46,14]);
  for (const path of [...paths,...putts].filter(path=>fixture.player==='46046'||path.strokeNumber===1)) {
    const stroke=path.strokeNumber;
    const reveal=path.samples?createPuttReplay(path,topography):{...createFlightReveal(path.points),duration:3};
    if(path.samples)path.samples.forEach((sample,i)=>{
      const raw=source.shots.find(s=>s.strokeNumber===stroke).ballPath.path[i];assert.deepEqual(sample.native,[raw.x,raw.y,raw.z]);assert.equal(sample.secondsSinceStart,raw.secondsSinceStart);
    });
    for(let cycle=0;cycle<2;cycle++) {
      // Use the existing navigator and the actual map marker; observe before click
      // so the exact first-frame anchor is verified, including same-shot re-click.
      if(stroke===2&&cycle===0)await modal.getByRole('button',{name:'Course',exact:true}).click();
      await host.evaluate(e=>{e.__replayFrames=[];e.__replayObserver?.disconnect();e.__replayObserver=new MutationObserver(()=>e.__replayFrames.push({state:JSON.parse(e.dataset.shotcastFlight),world:JSON.parse(e.dataset.shotcastWorld)}));e.__replayObserver.observe(e,{attributes:true,attributeFilter:['data-shotcast-flight']});});
      const control=stroke===2&&cycle===0?page.locator(`[data-shot-marker="${stroke}"]`):modal.getByRole('button',{name:`Replay shot ${stroke}`,exact:true});
      await control.click();
      await page.waitForFunction(n=>{const s=JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight);return s.selected===n&&s.phase==='playing';},stroke);
      await page.locator(`[data-shot-marker="${stroke}"][aria-pressed="true"]`).waitFor({state:'attached'});
      assert.ok(await page.getByText(`Shot ${stroke}`,{exact:true}).count(),'Details synchronize with selection');
      if(cycle===0){const rect=await page.locator('canvas').boundingBox();await page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.65);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height*.65,{steps:4});await page.mouse.up();await page.mouse.wheel(0,-80);assertRegistered(await sceneSnapshot(page),baseline);}
      await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight).phase==='finished',{},{timeout:30000});
      const frames=await host.evaluate(e=>{e.__replayObserver.disconnect();return e.__replayFrames;});
      const first=frames.find(f=>f.state.phase==='playing');assert.equal(first.state.elapsed,0);assert.deepEqual(first.state.position,baseline.world[`from-${stroke}`]);
      assert.ok(frames.some(f=>f.state.elapsed>0&&f.state.elapsed<reveal.duration));
      for(const frame of frames){assert.deepEqual(frame.world,baseline.world);if(frame.state.position)reveal.sample(frame.state.elapsed).position.forEach((v,a)=>assert.ok(Math.abs(v-frame.state.position[a])<=1e-8));}
      const last=frames.at(-1).state;assert.equal(last.elapsed,reveal.duration);assert.deepEqual(last.position,baseline.world[`to-${stroke}`]);
      assert.equal(await host.evaluate(e=>e.dataset.shotcastFlightPaths),frozenPaths);assertRegistered(await sceneSnapshot(page),baseline);
      await page.screenshot({path:`${output}/${fixture.course}-${viewport}-replay-${stroke}-${cycle}.png`});
      // Re-click finished selection (cycle 1) without a reset or a second button.
    }
    await modal.getByRole('button',{name:'Reset',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight).phase==='idle');
  }
  if(fixture.player==='46046') {
    await modal.getByRole('button',{name:'Replay shot 1',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight).phase==='playing');
    await modal.getByRole('button',{name:'Next shot',exact:true}).click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight);return s.selected===2&&s.phase==='playing';});
    await modal.getByRole('button',{name:'Previous shot',exact:true}).click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight);return s.selected===1&&s.phase==='playing';});
    await modal.getByRole('button',{name:'Replay shot 3',exact:true}).click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight);return s.selected===3&&s.kind==='putt'&&s.phase==='playing';});
    assert.equal((await sceneSnapshot(page)).mode,'green');
    const flowBefore=await host.evaluate(e=>JSON.parse(e.dataset.shotcastFlow));
    await page.waitForTimeout(400);const flowAfter=await host.evaluate(e=>JSON.parse(e.dataset.shotcastFlow));
    assert.ok(flowAfter.count>0);assert.ok(flowAfter.elapsed>flowBefore.elapsed);assert.notDeepEqual(flowAfter.positions,flowBefore.positions);
    assert.equal(flowAfter.retainedHeads,28);assert.equal(flowAfter.corridorStroke,3);
    assert.ok(flowAfter.displayAlpha.some(v=>v>0));assert.ok(flowAfter.displayAlpha.every(v=>v>=0&&v<=.580001));
    for(let i=0;i<flowAfter.positions.length;i+=3){if(!flowAfter.weights[i/3])continue;const p=flowAfter.positions.slice(i,i+3),s=topography.sample(p[0],p[1]);assert.ok(s);assert.ok(Math.abs(p[2]-s.elevation-.012)<5e-5);}
    await modal.getByRole('button',{name:'Course',exact:true}).click();
    assertRegistered(await sceneSnapshot(page),baseline);
    await modal.getByRole('button',{name:'Green',exact:true}).click();
    await page.locator('[data-shot-marker="4"]').click();
    await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight);return s.selected===4&&s.phase==='playing';});
    await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-shotcast-flow]').dataset.shotcastFlow).corridorStroke===4);
    assertRegistered(await sceneSnapshot(page),baseline);
    await modal.getByRole('button',{name:'Reset',exact:true}).click();
  }
  report.push({path:`${fixture.name} unified replay`,viewport,exactStart:true,exactEnd:true,markersFixed:true,pinFixed:true,pathIndependentOfCamera:true,reclickReplay:true,safeSwitch:true,suppliedPutts:fixture.player==='46046',noExtraControl:true});
}


// Current product UI only. No preview route or runtime camera/test controls.
async function captureGreenVisuals() {
  const fixture=cases.find(c=>c.player==='46046');
  for (const [label,viewport] of [['desktop',{width:1400,height:900}],['mobile390',{width:390,height:844}],['mobile486',{width:486,height:900}]]) {
    const state=await setup(viewport,fixture),page=state.page;
    await state.context.addInitScript(() => {
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => original(function captureFrame(time) {
        if (window.__holdShotcastScreenshot) { original(captureFrame); return; }
        callback(time);
      });
    });
    const modal=await openCurrentReplay(page,fixture);await await3d(page);
    const host=page.locator('[data-shotcast-world]'),baseline=await sceneSnapshot(page);
    await modal.getByRole('button',{name:'Green',exact:true}).click();
    await await3d(page);
    for(const stroke of [3,4])for(const angle of ['default','low']) {
      await modal.getByRole('button',{name:'Reset',exact:true}).click();
      await modal.getByRole('button',{name:`Replay shot ${stroke}`,exact:true}).click();
      await page.waitForFunction(n=>{const e=document.querySelector('[data-shotcast-flight]');return e&&JSON.parse(e.dataset.shotcastFlight).selected===n&&e.dataset.shotcastMode==='green';},stroke);
      await page.locator('canvas').scrollIntoViewIfNeeded();
      if(angle==='low') {
        const rect=await page.locator('canvas').boundingBox();
        // Orbit the actual controls toward a lower viewing elevation, then zoom.
        await page.mouse.move(rect.x+rect.width*.65,rect.y+rect.height*.65);
        await page.mouse.down();await page.mouse.move(rect.x+rect.width*.65,rect.y+rect.height*.57,{steps:10});await page.mouse.up();
        await page.mouse.wheel(0,-70);await page.waitForTimeout(250);
      }
      // Re-click restarts while preserving this view's camera. Capture a live ball.
      await modal.getByRole('button',{name:`Replay shot ${stroke}`,exact:true}).click();
      await page.waitForFunction(n=>{const s=JSON.parse(document.querySelector('[data-shotcast-flight]').dataset.shotcastFlight);return s.selected===n&&s.phase==='playing'&&s.elapsed>(n===3?2:0.8);},stroke,{timeout:30000});
      await page.evaluate(() => { window.__holdShotcastScreenshot = true; });
      const capture=await host.evaluate(e=>({world:JSON.parse(e.dataset.shotcastWorld),camera:JSON.parse(e.dataset.shotcastCamera),flow:JSON.parse(e.dataset.shotcastFlow),replay:JSON.parse(e.dataset.shotcastFlight),paths:JSON.parse(e.dataset.shotcastPuttPaths)}));
      assertRegistered(await sceneSnapshot(page),baseline);await noOverflow(page);
      const name=`${visualPass}-${label}-shot${stroke}-${angle}`;
      await page.locator('canvas').screenshot({path:`${output}/${name}-canvas.png`});
      await page.screenshot({path:`${output}/${name}.png`});
      fs.writeFileSync(`${output}/${name}.json`,JSON.stringify(capture,null,2));
      report.push({name,viewport,stroke,angle,worldFixed:true,overflow:false,visibleDensity:capture.flow.retainedHeads??capture.flow.count});
      console.log(`Captured ${name}`);
      await page.evaluate(() => { window.__holdShotcastScreenshot = false; });
    }
    assert.deepEqual(state.errors,[]);assert.deepEqual(state.consoleErrors,[]);
    await state.context.close();
  }
}
