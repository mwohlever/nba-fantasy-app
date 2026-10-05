import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';
import { preservedReplay } from './current-provider.mjs';

const geometry = await importTs('lib/shotcast/productionGeometry.ts');
const reference = await importTs('lib/shotcast/fixturePlacement.ts');
const assets = await importTs('lib/shotcast/developmentAssetResolver.server.ts');
const prepared = await importTs('lib/shotcast/ingestion/prepared.ts');
const handoff = await importTs('lib/shotcast/shotcast3dView.ts');
const { planShotcastVisualization } = await importTs('lib/shotcast/visualizationCapabilities.ts');
const descriptors = ['pga-71908773-fb52-47d0-bb1e-f44f50b34965', 'pga-6dd7c507-1e90-4bbc-a90e-8cbff49b24b3']
  .map(id => JSON.parse(fs.readFileSync(`tmp/shotcast-ingestion/packages/${id}/descriptor.json`, 'utf8')));
const bytes = ref => fs.readFileSync(ref.localPath);
const context = d => ({ tournamentId: d.event.id, pgaPlayerId: d.selection.playerId, roundNumber: d.selection.round, holeNumber: d.selection.hole });
const near = (a, b) => assert.ok(Math.hypot(...a.map((value, i) => value - b[i])) <= 1e-8);

for (const [index, descriptor] of descriptors.entries()) {
  test(`${descriptor.event.course.name}: unchanged geometry agrees with frozen/independent PGA observations`, () => {
    const native = JSON.parse(fs.readFileSync(descriptor.shotSource.source.localPath, 'utf8'));
    const hole = native.holes.find(h => h.holeNumber === descriptor.selection.hole);
    const meshBuffer = bytes(descriptor.assets.find(a => a.id === 'terrain'));
    const array = meshBuffer.buffer.slice(meshBuffer.byteOffset, meshBuffer.byteOffset + meshBuffer.byteLength);
    const terrain = geometry.decodeTerrainGlb(array), original = reference.decodeGlb(array);
    assert.deepEqual(terrain, original);
    const greenBuffer = bytes(descriptor.assets.find(a => a.id === 'green'));
    const green = geometry.decodeTerrainGlb(greenBuffer.buffer.slice(greenBuffer.byteOffset, greenBuffer.byteOffset + greenBuffer.byteLength));
    const tfw = bytes(descriptor.assets.find(a => a.id === 'hole-world')).toString();
    for (const shot of hole.strokes) {
      const endpoint = shot.overview.leftToRightCoords.toCoords;
      assert.deepEqual(geometry.convertNativePoint(endpoint, descriptor.configuration.offset), reference.convertNative(endpoint, descriptor.configuration.offset));
      const grounded = geometry.groundNativePoint(endpoint, descriptor.configuration.offset, terrain, green);
      assert.deepEqual(grounded, reference.groundPoint(endpoint, original, green, true, descriptor.configuration.offset).surfaceAnchor);
      assert.deepEqual(geometry.worldFileUv(tfw, grounded[0], grounded[1]), reference.worldFileUv(tfw, grounded[0], grounded[1]));
    }
    const first = hole.strokes[0].overview.leftToRightCoords.toCoords;
    const observed = JSON.parse(fs.readFileSync(index === 0 ? 'tmp/placement-validation/live-runtime-3.3.1.json' : 'tmp/placement-validation/nonzero-rotation/live-runtime-3.3.1.json', 'utf8'));
    near(geometry.groundNativePoint(first, descriptor.configuration.offset, terrain), observed.grounded);
    if (index === 0) {
      const detailed = JSON.parse(fs.readFileSync('tmp/placement-validation/green-live-runtime-3.3.1.json', 'utf8'));
      near(geometry.groundNativePoint(hole.strokes[2].overview.leftToRightCoords.toCoords, descriptor.configuration.offset, terrain, green), detailed.grounded);
    } else {
      const frozenBytes = fs.readFileSync('tmp/placement-validation/nonzero-rotation/frozen-prediction.json');
      assert.equal(createHash('sha256').update(frozenBytes).digest('hex'), '56094e00f5f7958718c35ac89e4e6de9af3684af79a90a312ce7e3fad961997f');
      const frozen = JSON.parse(frozenBytes);
      for (const [i, shot] of hole.strokes.entries()) assert.deepEqual(geometry.groundNativePoint(shot.overview.leftToRightCoords.toCoords, descriptor.configuration.offset, terrain), frozen.coarse[i].surfaceAnchor);
    }
  });

  test(`${descriptor.event.course.name}: preserved transport through the current provider matches the selected-player handoff`, async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { replay, requests } = await preservedReplay(descriptor);
      const playerHole = handoff.currentPlayerHole(replay);
      const view = await assets.resolveDevelopmentShotcast(playerHole);
      assert.ok(handoff.isShotcast3DView(view));
      assert.ok(view.tee); assert.ok(view.pin);
      assert.equal(requests.length, 3);
      assert.equal(handoff.matchesReplayEndpoints(view, replay), true);
      assert.notEqual(planShotcastVisualization(replay, view.prepared, 1).mode, '2d_fallback');
      assert.equal(handoff.matchesReplayEndpoints(view, { ...replay, shots: [] }), false);
      assert.equal(handoff.matchesReplayEndpoints(view, { ...replay, shots: [...replay.shots, { ...replay.shots[0], strokeNumber: 99 }] }), false);
      assert.equal(await assets.resolveDevelopmentShotcast({ ...playerHole, holeNumber: 2 }), null);
      assert.equal(await assets.readDevelopmentAsset(descriptor.packageId, 'missing'), null);
    } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  });
}

test('course assignment and prepared selection reject ambiguous or mismatched identities', () => {
  const d = descriptors[0], teeTimes = JSON.parse(fs.readFileSync(`tmp/shotcast-ingestion/packages/${d.packageId}/tee-times.bin`, 'utf8'));
  assert.equal(assets.isVerifiedPlayedCourse(teeTimes, d.selection.playerId, d.selection.round, d.event.course.id), true);
  assert.equal(assets.isVerifiedPlayedCourse(teeTimes, d.selection.playerId, d.selection.round, 'wrong'), false);
  assert.equal(assets.matchingPreparedDescriptor([d, d], context(d), d.event.course.id), null);
  assert.ok(assets.matchingPreparedDescriptor(descriptors, { ...context(d), pgaPlayerId: '46046', roundNumber: 2 }, d.event.course.id));
  assert.equal(assets.matchingPreparedDescriptor(descriptors, context(d), 'wrong'), null);
});

test('production cannot resolve or serve local assets, and malformed handoffs fail closed', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    assert.equal(await assets.resolveDevelopmentShotcast(context(descriptors[0])), null);
    assert.equal(await assets.readDevelopmentAsset(descriptors[0].packageId, 'terrain'), null);
    assert.equal(handoff.isShotcast3DView({ assets: {} }), false);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('preserved independent observations and frozen predictions remain byte-identical', () => {
  const hashes = JSON.parse(fs.readFileSync('tmp/shotcast-take2/evidence-hashes.json', 'utf8'));
  for (const [file, hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash);
});

// Captured actual PGA coordinates; an engineering regression input, not UI acceptance.
const scheffler = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/scheffler-r2026027-r1-h1.json')).hole;
const asReplay = input => ({ ...input, pinWorld: { x: input.pin.tourcastX, y: input.pin.tourcastY, z: input.pin.tourcastZ },
  shots: input.shots.map(s => ({ strokeNumber: s.strokeNumber, leftToRight: { from: s.from, to: s.to }, bottomToTop: null, ballPath: null })) });
async function development(fn) {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  try { await fn(); } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
}

test('course projection contains no research player, strokes or selection', async () => {
  const d = await prepared.readPreparedCourseDescriptor(descriptors[0].packageId);
  assert.equal(d.shotSource, undefined); assert.equal(d.selection, undefined); assert.equal(d.validation, undefined);
  assert.equal(d.event.course.id, '513');
});

test('Scheffler uses the SAME Southwind assets with his own endpoints, tee and pin', async () => development(async () => {
  const d = descriptors[0];
  const { replay: henley } = await preservedReplay(d);
  const henleyView = await assets.resolveDevelopmentShotcast(handoff.currentPlayerHole(henley));
  const replay = asReplay(scheffler), input = handoff.currentPlayerHole(replay);
  assert.deepEqual(input, scheffler);
  const view = await assets.resolveDevelopmentShotcast(input);
  assert.ok(handoff.isShotcast3DView(view));
  assert.equal(view.packageId, d.packageId); assert.deepEqual(view.assets, henleyView.assets);
  assert.equal(view.prepared.pgaPlayerId, '46046'); assert.equal(view.prepared.course.pgaCourseId, '513');
  assert.equal(view.shots.length, 4);
  const mesh = id => { const b = bytes(d.assets.find(a => a.id === id)); return geometry.decodeTerrainGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const terrain = mesh('terrain'), green = mesh('green');
  assert.deepEqual(view.tee, geometry.groundNativePoint(input.shots[0].from, d.configuration.offset, terrain, green));
  assert.deepEqual(view.pin, geometry.groundNativePoint(input.pin, d.configuration.offset, terrain, green));
  for (let i = 0; i < input.shots.length; i++) {
    assert.deepEqual(view.shots[i].nativeEndpoint, Object.values(input.shots[i].to));
    assert.deepEqual(view.shots[i].endpoint, geometry.groundNativePoint(input.shots[i].to, d.configuration.offset, terrain, green));
  }
  assert.notDeepEqual(view.shots[0].nativeEndpoint, henleyView.shots[0].nativeEndpoint);
  assert.equal(handoff.matchesReplayEndpoints(view, replay), true);
  assert.equal(handoff.matchesReplayEndpoints(henleyView, replay), false);
  for (const stroke of [1, 2, 3, 4]) {
    const plan = planShotcastVisualization(replay, view.prepared, stroke);
    assert.equal(plan.mode, 'endpoint'); assert.equal(plan.selectedStrokeNumber, stroke);
  }
}));

test('runtime course preparation never reads research native.bin, even for Henley', async () => development(async () => {
  const { replay } = await preservedReplay(descriptors[0]);
  const readFile = fs.promises.readFile, reads = [];
  fs.promises.readFile = async (filename, ...args) => {
    reads.push(String(filename));
    if (String(filename).endsWith('/native.bin')) throw new Error('Player research must not enter runtime');
    return readFile(filename, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.ok(await assets.resolveDevelopmentShotcast(handoff.currentPlayerHole(replay)));
    assert.ok(await assets.resolveDevelopmentShotcast(scheffler));
    assert.ok(reads.some(file => file.endsWith('/terrain.bin')), 'Reader spy must intercept actual asset reads');
    assert.equal(reads.some(file => file.endsWith('/native.bin')), false);
  } finally { fs.promises.readFile = readFile; syncBuiltinESMExports(); }
}));

test('other event/player assignment and missing hole preparation fail closed', async () => development(async () => {
  for (const input of [
    { ...scheffler, tournamentId: 'R2026060' },
    { ...scheffler, pgaPlayerId: '999999999' }, // no independently recorded assignment
    { ...scheffler, holeNumber: 2 },
    { ...scheffler, roundNumber: 0 },
    { ...scheffler, roundNumber: 5 },
  ]) assert.equal(await assets.resolveDevelopmentShotcast(input), null);
}));

test('ambiguous, wrong or absent selected-player course assignment is rejected', () => {
  const times = courses => ({ data: { teeTimes: { rounds: [{ roundInt: 1, groups: courses.map(courseId => ({ courseId, players: [{ id: '46046' }] })) }] } } });
  assert.equal(assets.isVerifiedPlayedCourse(times(['513']), '46046', 1, '513'), true);
  for (const courses of [['513', '752'], ['752'], [], ['513', undefined]]) {
    assert.equal(assets.isVerifiedPlayedCourse(times(courses), '46046', 1, '513'), false);
  }
  assert.equal(assets.isVerifiedPlayedCourse(times(['513']), '34098', 1, '513'), false);
  assert.equal(assets.isVerifiedPlayedCourse(times(['513']), '46046', 2, '513'), false);
});

test('missing pin/tee, malformed strokes and ungroundable endpoints fall back without substitution', async () => development(async () => {
  for (const input of [
    { ...scheffler, pin: null },
    { ...scheffler, shots: [] },
    { ...scheffler, shots: [scheffler.shots[0], scheffler.shots[0]] },
    { ...scheffler, shots: [{ ...scheffler.shots[0], from: null }] },
    { ...scheffler, shots: [{ ...scheffler.shots[0], to: { tourcastX: 1e9, tourcastY: 1e9, tourcastZ: 1 } }] },
  ]) assert.equal(await assets.resolveDevelopmentShotcast(input), null);
  assert.equal(handoff.currentPlayerHole({ ...asReplay(scheffler), pinWorld: null }), null);
}));

test('resolver rejects wrong/ambiguous course and wrong tee-times event without changing preserved packages', async () => development(async () => {
  const directory = `tmp/shotcast-ingestion/packages/${descriptors[0].packageId}`;
  const original = JSON.parse(fs.readFileSync(`${directory}/tee-times.bin`));
  const provenance = JSON.parse(fs.readFileSync(`${directory}/provenance.json`));
  const readFile = fs.promises.readFile;
  for (const [event, courses] of [['R2026027', ['752']], ['R2026027', ['513', '752']], ['R2026060', ['513']]]) {
    // Simulated source boundary for negative engineering cases only, no disk writes.
    const times = { data: { teeTimes: { ...original.data.teeTimes, id: event, rounds: [{ roundInt: 1, groups: courses.map(courseId => ({ courseId, players: [{ id: scheffler.pgaPlayerId }] })) }] } } };
    const bytes = Buffer.from(JSON.stringify(times));
    const refs = structuredClone(provenance);
    refs.inputs['tee-times'].sha256 = createHash('sha256').update(bytes).digest('hex');
    fs.promises.readFile = async (filename, ...args) => {
      if (String(filename).endsWith(`${descriptors[0].packageId}/tee-times.bin`)) return bytes;
      if (String(filename).endsWith(`${descriptors[0].packageId}/provenance.json`)) return JSON.stringify(refs);
      return readFile(filename, ...args);
    };
    syncBuiltinESMExports();
    try { assert.equal(await assets.resolveDevelopmentShotcast(scheffler), null); }
    finally { fs.promises.readFile = readFile; syncBuiltinESMExports(); }
  }
}));

test('course asset integrity still rejects changed terrain bytes', async () => development(async () => {
  const readFile = fs.promises.readFile;
  fs.promises.readFile = async (filename, ...args) => {
    const bytes = await readFile(filename, ...args);
    if (String(filename).endsWith('/terrain.bin')) { const changed = Buffer.from(bytes); changed[0] ^= 1; return changed; }
    return bytes;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(assets.resolveDevelopmentShotcast(scheffler), /Preserved source changed/); }
  finally { fs.promises.readFile = readFile; syncBuiltinESMExports(); }
}));

test('production GET and POST stop before importing the development resolver', async () => {
  const api = await importTs('app/api/golf/shotcast-3d-dev/route.ts');
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    assert.equal((await api.GET(new Request('http://localhost:3001/api/golf/shotcast-3d-dev'))).status, 404);
    assert.equal((await api.POST(new Request('http://localhost:3001/api/golf/shotcast-3d-dev', { method: 'POST', body: JSON.stringify(scheffler) }))).status, 404);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
