import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import { importTs } from './module-loader.mjs';

const identity = await importTs('lib/shotcast/preparation/courseIdentity.ts');
const acquisition = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const preparation = await importTs('lib/shotcast/preparation/prepareCourse.server.ts');
const geometry = await importTs('lib/shotcast/productionGeometry.ts');
const adapter = await importTs('lib/shotcast/developmentAssetResolver.server.ts');
const handoff = await importTs('lib/shotcast/shotcast3dView.ts');
const proofReader = await importTs('lib/shotcast/preparation/developmentProof.server.ts');
const fixture = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/waialae-r2026006-r1-h10.json'));
const directory = `tmp/shotcast-ingestion/packages/${fixture.packageId}`;
const manifest = JSON.parse(fs.readFileSync(`${directory}/descriptor.json`));
const cached = new Map(Object.entries(manifest.inputs).map(([id, evidence]) => [
  evidence.operation ?? evidence.sourceUrl, { evidence, bytes: new Uint8Array(fs.readFileSync(`${directory}/${id}.bin`)) },
]));
const transport = change => async (url, request) => {
  const result = structuredClone(cached.get(request?.operation ?? url));
  assert.ok(result, `Unexpected acquisition ${url}`);
  return change ? change(url, result) : result;
};
const request = { eventId: 'R2026006', holes: [10] };
const event = manifest.eventIdentity;
const inventory = [{ id: '005', name: 'Pebble', host: true, scoringLevel: 'TOURCAST' }, { id: '205', name: 'Spyglass', host: false, scoringLevel: 'TOURCAST' }];
const multi = { ...event, eventId: 'R2026005', courses: inventory };
const teeTimes = (eventId, courseIds, player = '59095', round = 1) => ({ data: { teeTimes: { id: eventId, rounds: [{ roundInt: round, groups: courseIds.map(courseId => ({ courseId, players: [{ id: player }] })) }] } } });
async function development(fn) {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  try { return await fn(); } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
}
async function candidate(acquire = transport()) {
  const result = await preparation.prepareCourseForEvent(request, acquire);
  assert.equal(result.status, 'prepared', JSON.stringify(result)); return result.candidate;
}

test('event identity discovers tournament, leading-zero course ID and published profile/configuration', async () => {
  const c = await candidate();
  assert.equal(c.manifest.identity.eventId, 'R2026006');
  assert.equal(c.manifest.identity.courseId, '006');
  assert.equal(c.manifest.identity.tournamentName, 'Sony Open in Hawaii');
  assert.equal(c.manifest.identity.courseName, 'Waialae Country Club');
  assert.equal(c.manifest.identity.physicalCourseId, null);
  assert.deepEqual(c.manifest.configuration.offset, manifest.configuration.offset);
  assert.equal(c.manifest.configuration.offset.rotate, 0.424586);
  assert.equal(c.manifest.identity.feetToMetres, 0.3048);
  assert.equal(c.manifest.identity.rotationUnit, 'degrees');
  assert.equal(c.manifest.engine.profile, 'pga-f32-z-up-interior-v1');
  assert.equal(c.manifest.shotSource, undefined); assert.equal(c.manifest.selection, undefined);
});

test('multi-course selection is explicit, and alternate roots/offsets replace host configuration', () => {
  assert.throws(() => identity.selectEventCourse(multi), /course_selection_required/);
  assert.equal(identity.selectEventCourse(multi, '205').name, 'Spyglass');
  assert.throws(() => identity.selectEventCourse(multi, '006'), /unknown_or_ambiguous_course/);
  assert.equal(identity.courseIdentity(multi, inventory[0], 'hash').assetRoot, 'https://tourcast.pgatour.com/models/R2026005/3D_Assets/');
  assert.equal(identity.courseIdentity(multi, inventory[1], 'hash').assetRoot, 'https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/');
  const raw = { x: 100, y: 200, z: 3, rotate: 4, courseOffset: [{ courseId: '205', x: 5, y: 6, z: 7, rotate: 8 }] };
  assert.deepEqual(identity.effectiveConfiguration(raw, inventory[1]).offset, { x: 5, y: 6, z: 7, rotate: 8 });
  assert.throws(() => identity.effectiveConfiguration({ x: 100, y: 200, z: 3, rotate: 4 }, inventory[1]), /missing_or_ambiguous_override/);
  assert.throws(() => identity.effectiveConfiguration({ ...raw, courseOffset: [...raw.courseOffset, raw.courseOffset[0]] }, inventory[1]), /missing_or_ambiguous_override/);
  assert.throws(() => identity.effectiveConfiguration({ x: -1, y: -1, z: 0, rotate: -1 }, inventory[0]), /placeholder_transform/);
});

test('player-round assignments reject missing, conflicting, wrong-event and STATS-only courses', () => {
  assert.equal(identity.resolvePlayedCourse(event, teeTimes('R2026006', ['006']), '59095', 1).id, '006');
  for (const ids of [[], ['006', '205'], ['205']]) assert.throws(() => identity.resolvePlayedCourse(event, teeTimes('R2026006', ids), '59095', 1));
  assert.throws(() => identity.resolvePlayedCourse(event, teeTimes('R2026005', ['006']), '59095', 1), /event_mismatch/);
  assert.throws(() => identity.resolvePlayedCourse(event, teeTimes('R2026006', ['006']), '59095', 2));
  const amex = { ...event, courses: [{ id: '704', name: 'Stadium', host: true, scoringLevel: 'TOURCAST' }, { id: '202', name: 'La Quinta', host: false, scoringLevel: 'STATS' }] };
  assert.throws(() => identity.resolvePlayedCourse(amex, teeTimes(event.eventId, ['202']), '59095', 1), /without_tourcast/);
});

test('bootstrap parsing rejects absent/ambiguous configurations and never evaluates scripts', () => {
  assert.throws(() => acquisition.parseBootstrap('<script>throw new Error("execute")</script>'), /ambiguous_config/);
  const row = configData => `<script>self.__next_f.push(${JSON.stringify([1, `1:${JSON.stringify({ configData })}\n`])})</script>`;
  assert.throws(() => acquisition.parseBootstrap(row({ enabled: true }) + row({ enabled: false })), /ambiguous_config/);
});

test('deterministic content preparation recreates the same revision despite new retrieval clocks', async () => {
  const a = await candidate(), b = await candidate(transport((url, r) => { r.evidence.retrievedAt = '2026-10-07T12:00:00Z'; return r; }));
  assert.equal(a.manifest.preparationId, fixture.preparationId);
  assert.equal(a.manifest.packageId, b.manifest.packageId);
  assert.deepEqual(a.manifest.assets, b.manifest.assets);
  assert.deepEqual(a.manifest.configuration, b.manifest.configuration);
  assert.deepEqual(a.manifest.holes, b.manifest.holes);
  assert.equal(a.manifest.holeCapabilities['10'].course3d, false);
  assert.throws(() => preparation.validatePreparedCourse(a.manifest), /registration_not_validated/);
});

test('fresh native Waialae positions independently reproduce retained expectations at 1e-8 m', async () => {
  const c = await candidate();
  const world = preparation.validateRegistration(c, fixture.input, fixture.expected, fixture.reference, fixture.source.sha256);
  assert.deepEqual(world.tee, fixture.expected.tee); assert.deepEqual(world.pin, fixture.expected.pin);
  for (const [i, shot] of world.shots.entries()) { assert.deepEqual(shot.from, fixture.expected.shots[i].from); assert.deepEqual(shot.endpoint, fixture.expected.shots[i].endpoint); }
  assert.equal(c.manifest.registrationProof.maximumResidualMetres, 0);
  const actual = geometry.convertNativePoint(fixture.input.shots[0].from, c.manifest.configuration.offset);
  const unrotated = geometry.convertNativePoint(fixture.input.shots[0].from, { ...c.manifest.configuration.offset, rotate: 0 });
  assert.ok(Math.hypot(actual[0] - unrotated[0], actual[1] - unrotated[1]) > 20, 'Rotation must have a material effect');
  assert.equal(c.manifest.holeCapabilities['10'].registrationValidated, true);
  assert.equal(c.manifest.holeCapabilities['10'].detailedGreen, true);
  assert.equal(c.manifest.holeCapabilities['10'].simulatedPutt, false);
});

test('meaningful reference mismatch stops registration without tuning or activating a candidate', async () => {
  const c = await candidate(), expected = structuredClone(fixture.expected); expected.pin[0] += 0.01;
  assert.throws(() => preparation.validateRegistration(c, fixture.input, expected, fixture.reference, fixture.source.sha256), /registration_mismatch/);
  assert.equal(c.manifest.registrationProof, null); assert.equal(c.manifest.holeCapabilities['10'].course3d, false);
});

test('missing required asset, denied green and changed profile/hash fail closed', async () => {
  for (const [suffix, status] of [['terrain10.jpg', 404], ['Green10.glb', 403]]) {
    const result = await preparation.prepareCourseForEvent(request, transport((url, r) => { if (url.endsWith(suffix)) throw new identity.PreparationError('provider_http_failure', 'acquisition', url, status); return r; }));
    assert.equal(result.status, 'unsupported');
  }
  for (const suffix of ['golfEngine.min.js', 'terrain10.glb']) {
    const result = await preparation.prepareCourseForEvent(request, transport((url, r) => { if (url.endsWith(suffix)) r.bytes[0] ^= 1; return r; }));
    assert.equal(result.status, 'unsupported'); assert.equal(result.reason, 'source_integrity_failure');
  }
  const changed = await preparation.prepareCourseForEvent(request, transport((url, r) => { if (url.endsWith('golfEngine.min.js')) { r.bytes[0] ^= 1; r.evidence.sha256 = acquisition.sha256(r.bytes); } return r; }));
  assert.equal(changed.status, 'unsupported'); assert.equal(changed.reason, 'unsupported_profile');
});

test('missing optional green expresses partial geometry rather than claiming full 3D readiness', async () => {
  const c = await candidate(transport((url, r) => { if (url.endsWith('Green10.glb')) throw new identity.PreparationError('provider_http_failure', 'acquisition', url, 404); return r; }));
  assert.equal(c.manifest.holes[0].green, undefined);
  assert.equal(c.manifest.holeCapabilities['10'].detailedGreen, false);
  assert.equal(c.manifest.holeCapabilities['10'].registrationValidated, false);
});

test('wrong course, duplicate inventory, invalid holes and coordinate sentinels reject', async () => {
  const wrong = await preparation.prepareCourseForEvent({ ...request, courseId: '205' }, transport()); assert.equal(wrong.status, 'unsupported');
  assert.throws(() => identity.declaredCourses([{ id: '006', courseName: 'A', scoringLevel: 'TOURCAST', hostCourse: true }, { id: '006', courseName: 'A', scoringLevel: 'TOURCAST', hostCourse: false }]), /ambiguous_course_inventory/);
  for (const holes of [[], [10, 10], [19]]) assert.equal((await preparation.prepareCourseForEvent({ ...request, holes }, transport())).status, 'unsupported');
  const c = await candidate();
  for (const v of [0, -1]) assert.throws(() => preparation.resolveCandidateWorld(c, { ...fixture.input, pin: { tourcastX: v, tourcastY: v, tourcastZ: v } }), /placeholder_coordinates/);
  assert.throws(() => preparation.resolveCandidateWorld(c, { ...fixture.input, pgaPlayerId: '999999' }), /ambiguous_assignment/);
});

test('prepared manifest rejects altered course/transform, missing proof and failed proof', () => {
  for (const alter of [m => { m.identity.courseId = '205'; }, m => { m.configuration.offset.rotate = 0; }, m => { m.assets[0].sha256 = '0'.repeat(64); }, m => { m.registrationProof = null; }, m => { m.registrationProof.maximumResidualMetres = 0.01; }]) {
    const m = structuredClone(manifest); alter(m); assert.throws(() => preparation.validatePreparedCourse(m));
  }
});

test('actual development adapter resolves the fresh provider hole with no saved-player package read', async () => development(async () => {
  const replay = JSON.parse(fs.readFileSync('tmp/shotcast-phase4b/replay.json'));
  const readFile = fs.promises.readFile, reads = [];
  fs.promises.readFile = async (filename, ...args) => { reads.push(String(filename)); if (String(filename).endsWith('/native.bin')) throw new Error('Saved players prohibited'); return readFile(filename, ...args); };
  syncBuiltinESMExports();
  try {
    const view = await adapter.resolveDevelopmentShotcast(handoff.currentPreparationInput(replay));
    assert.ok(handoff.isShotcast3DView(view)); assert.deepEqual(view.tee, fixture.expected.tee); assert.deepEqual(view.pin, fixture.expected.pin);
    assert.ok(view.flightPaths.some(p => p.strokeNumber === 1)); assert.equal(view.puttPaths.length, 0);
    assert.equal(handoff.matchesReplayEndpoints(view, replay), true);
    assert.ok(reads.some(p => p.endsWith('/h10-terrain.bin'))); assert.equal(reads.some(p => p.endsWith('/native.bin')), false);
  } finally { fs.promises.readFile = readFile; syncBuiltinESMExports(); }
}));

test('production cannot acquire or expose local proof/assets; opt-in is required in development', async () => {
  const previous = process.env.NODE_ENV, optIn = process.env.SHOTCAST_PREPARATION_PROOF;
  try {
    process.env.NODE_ENV = 'production'; process.env.SHOTCAST_PREPARATION_PROOF = '1';
    assert.equal(await proofReader.readDevelopmentProof(), null);
    assert.equal(await adapter.resolveDevelopmentShotcast(fixture.input), null);
    assert.equal(await adapter.readDevelopmentAsset(fixture.packageId, 'h10-terrain'), null);
    await assert.rejects(acquisition.publicPgaAcquisition('https://tourcast.pgatour.com/'), /disabled/);
    process.env.NODE_ENV = 'development'; delete process.env.SHOTCAST_PREPARATION_PROOF;
    assert.equal(await proofReader.readDevelopmentProof(), null);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; if (optIn === undefined) delete process.env.SHOTCAST_PREPARATION_PROOF; else process.env.SHOTCAST_PREPARATION_PROOF = optIn; }
});
