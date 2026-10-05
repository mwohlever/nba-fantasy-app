import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';
import { preservedReplay } from './current-provider.mjs';

const { buildHoleWorld, freezeHoleWorld } = await importTs('lib/shotcast/holeWorld.ts');
const { decodeTerrainGlb, groundNativePoint, surfaceHeight, worldFileUv } = await importTs('lib/shotcast/productionGeometry.ts');
const { resolveDevelopmentShotcast } = await importTs('lib/shotcast/developmentAssetResolver.server.ts');
const { currentPlayerHole, matchesReplayEndpoints } = await importTs('lib/shotcast/shotcast3dView.ts');
const raw = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/scheffler-r2026027-r1-h1.json')).hole;
const replay = JSON.parse(fs.readFileSync('tmp/shotcast-activation/scheffler-st-jude-replay.json'));
const descriptor = JSON.parse(fs.readFileSync('tmp/shotcast-ingestion/packages/pga-71908773-fb52-47d0-bb1e-f44f50b34965/descriptor.json'));
const bytes = id => fs.readFileSync(descriptor.assets.find(asset => asset.id === id).localPath);
const mesh = id => { const buffer = bytes(id); return decodeTerrainGlb(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)); };
const terrain = mesh('terrain'), green = mesh('green'), offset = descriptor.configuration.offset;
const build = (input = raw, greens = green) => buildHoleWorld(input, offset, terrain, greens);
const expected = [
  [-115.68310546875, 378.721435546875, 10.874481308178765],
  [-296.1064453125, 204.69482421875, 10.945296698560316],
  [-304.60595703125, 66.57177734375, 10.939206175918256],
  [-317.108154296875, 69.351318359375, 11.014807185703452],
  [-315.5849609375, 68.565185546875, 11.00063925622532],
];

test('actual raw provider fields normalize to the captured static coordinates, including pinGreen native fields', async () => {
  const capture = 'tests/shotcast-ingestion/fixtures/scheffler-native-h1.json';
  const source = JSON.parse(fs.readFileSync(capture));
  const input = { ...descriptor, selection: { ...descriptor.selection, playerId:'46046' },
    shotSource: { ...descriptor.shotSource, identity: { ...descriptor.shotSource.identity, playerName:'Scottie Scheffler' }, source: { localPath:capture } } };
  const normalized = (await preservedReplay(input)).replay;
  assert.deepEqual(currentPlayerHole(normalized), raw);
  const cup = source.holes[0].pinGreen.bottomToTopCoords;
  assert.deepEqual([cup.tourcastX,cup.tourcastY,cup.tourcastZ], [raw.pin.tourcastX,raw.pin.tourcastY,raw.pin.tourcastZ]);
  assert.equal(cup.x, -1, 'Image sentinel must not be mistaken for a native coordinate');
  assert.deepEqual(normalized.pinWorld, { x:cup.tourcastX,y:cup.tourcastY,z:cup.tourcastZ });
});

test('captured provider semantics: strokeNumber sequence, exact continuation, final endpoint equals live pin', () => {
  assert.deepEqual(currentPlayerHole(replay), raw);
  const numbered = [...raw.shots].sort((a, b) => a.strokeNumber - b.strokeNumber);
  assert.deepEqual(numbered.map(shot => shot.strokeNumber), [1, 2, 3, 4]);
  for (let i = 1; i < numbered.length; i++) assert.deepEqual(numbered[i].from, numbered[i - 1].to);
  assert.deepEqual(numbered.at(-1).to, raw.pin);
  // No assumption about transport order. No fabricated continuation for penalties.
  assert.deepEqual(build({ ...raw, shots: [raw.shots[2], raw.shots[0], raw.shots[3], raw.shots[1]] }), build());
});

test('all starts/ends, tee and cup use the SAME preserved registration and surface lookup', () => {
  const world = build();
  assert.deepEqual([world.tee, ...world.shots.map(shot => shot.endpoint)], expected);
  assert.deepEqual(world.pin, expected.at(-1));
  for (const [i, shot] of world.shots.entries()) {
    assert.deepEqual(shot.from, expected[i]);
    assert.deepEqual(shot.from, groundNativePoint(raw.shots[i].from, offset, terrain, green));
    assert.deepEqual(shot.endpoint, groundNativePoint(raw.shots[i].to, offset, terrain, green));
  }
  const uv = world.shots.map(shot => worldFileUv(bytes('hole-world').toString(), ...shot.endpoint));
  assert.ok(uv.every(point => point.every(value => value >= 0 && value <= 1)));
  const distances = world.shots.map(shot => Math.hypot(...shot.endpoint.map((value, axis) => value - shot.from[axis])) / 0.9144);
  // Independent provider displayed distances: 274 yd, 151 yd, 42 ft, 5 ft 5 in.
  assert.ok(Math.abs(distances[0] - 274) < 1);
  assert.ok(Math.abs(distances[1] - 151) < 1);
  assert.ok(Math.abs(distances[2] * 3 - 42) < 1);
  assert.ok(Math.abs(distances[3] * 3 - (5 + 5 / 12)) < 0.3);
});

test('Scheffler animation boundaries: each start equals prior end, with tee and independent final cup', () => {
  const world = build();
  assert.equal(world.tee, world.shots[0].from, 'Tee and Shot 1 reuse the same frozen point');
  for (let i = 1; i < world.shots.length; i++) {
    const difference = world.shots[i].from.map((value, axis) => value - world.shots[i - 1].endpoint[axis]);
    assert.deepEqual(difference, [0, 0, 0], `Shot ${i + 1} continuity must be exact`);
  }
  assert.deepEqual(world.shots.at(-1).endpoint, world.pin);
  assert.notDeepEqual(world.shots.at(-1).from, world.pin, 'Shot 4 marker starts away from its holed target');
});

test('deeply frozen world survives JSON handoff/remount and rejects mutation', () => {
  const world = build(), wire = freezeHoleWorld(JSON.parse(JSON.stringify(world)));
  assert.deepEqual(wire, world);
  assert.deepEqual(build(), world);
  for (const model of [world, wire]) {
    assert.throws(() => { model.shots[1].endpoint[0] += 1; }, TypeError);
    assert.throws(() => { model.shots.reverse(); }, TypeError);
    assert.throws(() => { model.tee[0] = 0; }, TypeError);
    assert.throws(() => { model.pin[0] = 0; }, TypeError);
  }
});

test('green focus uses authored elevated mesh containing this cup; absent/off-surface green has no 3D focus', () => {
  const world = build();
  assert.ok(world.greenBounds);
  assert.ok(world.greenBounds.max[2] - world.greenBounds.min[2] > 0.6);
  assert.equal(surfaceHeight(green, world.pin[0], world.pin[1]), world.pin[2]);
  assert.equal(build(raw, []).greenBounds, null);
  assert.equal(build({ ...raw, pin: raw.shots[0].from }).greenBounds, null);
  const bad = structuredClone(raw); bad.shots[1].from.tourcastX = 1e9;
  assert.equal(build(bad), null, 'Every start is checked, not only shot 1');
});

test('resolver binds all starts and endpoints and live pin, independently of selection', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  try {
    const view = await resolveDevelopmentShotcast(raw);
    for (const key of ['tee', 'pin', 'shots', 'greenBounds']) assert.deepEqual(view[key], build()[key]);
    assert.equal(matchesReplayEndpoints(view, replay), true);
    for (const field of ['from', 'to']) {
      const changed = structuredClone(replay); changed.shots[1].leftToRight[field].tourcastX += 0.0001;
      assert.equal(matchesReplayEndpoints(view, changed), false);
    }
    const changed = structuredClone(replay); changed.pinWorld.x += 0.0001;
    assert.equal(matchesReplayEndpoints(view, changed), false);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
