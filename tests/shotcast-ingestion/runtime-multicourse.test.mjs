import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';

const acquisition = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const preparation = await importTs('lib/shotcast/preparation/prepareCourse.server.ts');
const playerRound = await importTs('lib/shotcast/preparation/playerRoundCourse.server.ts');
const geometry = await importTs('lib/shotcast/productionGeometry.ts');
const adapter = await importTs('lib/shotcast/developmentAssetResolver.server.ts');
const handoff = await importTs('lib/shotcast/shotcast3dView.ts');
const proofReader = await importTs('lib/shotcast/preparation/developmentProof.server.ts');
const capture = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/pga-runtime-multicourse.json'));
const cases = capture.cases;
const manifests = Object.fromEntries(cases.map(c => [c.proofId, JSON.parse(fs.readFileSync(`tmp/shotcast-phase4c/proofs/${c.proofId}/candidate.json`))]));
const cache = new Map();
for (const c of cases.filter(c => c.courseId !== '006')) {
  const m = manifests[c.proofId], directory = `tmp/shotcast-ingestion/packages/${m.packageId}`;
  for (const [id, evidence] of Object.entries(m.inputs)) cache.set(evidence.operation ? evidence.operation + JSON.stringify(evidence.variables) : evidence.sourceUrl, { evidence, bytes: new Uint8Array(fs.readFileSync(`${directory}/${id}.bin`)) });
}
const transport = alter => async (url, request) => {
  const key = request?.operation ? request.operation + JSON.stringify(request.variables) : url;
  const r = structuredClone(cache.get(key)); assert.ok(r, `Unexpected provider input ${key}`);
  return alter ? alter(url, r, request) : r;
};
const requestFor = c => ({ eventId: c.eventId, playerId: c.playerId, roundNumber: c.roundNumber, holes: [c.holeNumber] });
async function prepare(c, acquire = transport()) {
  const result = await playerRound.prepareCourseForPlayerRound(requestFor(c), acquire);
  assert.equal(result.status, 'prepared', JSON.stringify(result)); return result;
}
const near = (a, b) => assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) <= 1e-8);
async function development(fn) { const old = process.env.NODE_ENV; process.env.NODE_ENV = 'development'; try { return await fn(); } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; } }

for (const c of cases) test(`${c.courseId}: actual published PGA functions independently match registration/grounding`, () => {
  const directory = `tmp/shotcast-phase4c/discovery-${c.eventId}`;
  const mesh = name => { const b = fs.readFileSync(`${directory}/c${c.courseId}-${name}${String(c.holeNumber).padStart(2, '0')}.glb.bin`); return geometry.decodeTerrainGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const terrain = mesh('terrain'), green = mesh('Green');
  const offset = manifests[c.proofId].configuration.offset;
  for (const row of c.provider.registered) {
    assert.deepEqual(geometry.convertNativePoint(row.raw, offset), row.converted);
    near(geometry.groundNativePoint(row.raw, offset, terrain), c.provider.coarse.find(p => p.label === row.label).world);
    near(geometry.groundNativePoint(row.raw, offset, terrain, green), c.provider.detailed.find(p => p.label === row.label).world);
  }
  assert.equal(c.provider.detailed.some(p => p.xyWasNudged), false);
  assert.deepEqual(c.provider.coarse, c.provider.strictCoarse, 'SDK nudging/nearest fallback is unnecessary');
  assert.deepEqual(c.provider.detailed, c.provider.strictDetailed, 'SDK strict green/terrain intersections must agree');
  assert.equal(c.provider.detailed.find(p => p.label === 'pin').onGreen, true);
  assert.ok(c.maximumError < 1e-8);
});

test('oracle runs original provider functions and never imports our registration or donor placement', () => {
  const source = fs.readFileSync('scripts/pga-runtime-oracle.mjs', 'utf8');
  for (const forbidden of ['productionGeometry', 'fixturePlacement', 'groundNativePoint', 'convertNativePoint', 'buildHoleWorld']) assert.equal(source.includes(forbidden), false);
  assert.ok(source.includes('ground:Ia')); assert.ok(source.includes('getTourcastOffset'));
  assert.ok(source.includes("flag:'wx'"));
});

test('Waialae uses the same float32 native-origin degree rotation despite nonzero configuration', () => {
  const c = cases[0], offset = manifests[c.proofId].configuration.offset;
  assert.equal(offset.rotate, 0.424586);
  assert.deepEqual(c.provider.offset.translation, Array.from(new Float32Array([offset.x, offset.y, offset.z])));
  const raw = c.input.shots[0].from;
  const positive = geometry.convertNativePoint(raw, offset), negative = geometry.convertNativePoint(raw, { ...offset, rotate: -offset.rotate });
  assert.ok(Math.hypot(positive[0] - negative[0], positive[1] - negative[1]) > 40);
  near(positive, c.provider.registered.find(p => p.label === 'from-1').converted);
});

test('fresh actual tee times override current leaderboard course for historical player-round resolution', async () => {
  const first = cases[1], resolved = await playerRound.resolveCourseForPlayerRound(first.eventId, first.playerId, 1, transport());
  const leaderboard = acquisition.json(resolved.discovery.resources.leaderboard);
  assert.equal(leaderboard.players.find(p => p.id === first.playerId).scoringData.courseId, '005');
  assert.equal(resolved.assignment.course.id, '205');
  assert.equal(resolved.assignment.method, 'tee-time-player-round-course');
  assert.equal(resolved.assignment.physicalCourseId, null);
  assert.ok(resolved.assignment.provenance.groups.length);
  for (const r of [2, 3, 4]) {
    const assignment = playerRound.assignmentFromTeeTimes(resolved.discovery.identity, resolved.teeTimes, first.playerId, r);
    assert.equal(assignment.course.id, '005');
  }
});

for (const c of cases.slice(1)) test(`${c.courseId}: player-round pipeline automatically selects assets/frame and is deterministic`, async () => {
  const a = await prepare(c), b = await prepare(c);
  assert.equal(a.assignment.course.id, c.courseId);
  assert.equal(a.candidate.manifest.packageId, c.packageId);
  assert.equal(a.candidate.manifest.preparationId, b.candidate.manifest.preparationId);
  assert.equal(a.candidate.manifest.identity.relationship, c.courseId === '205' ? 'alternate' : 'host');
  assert.equal(a.candidate.manifest.configuration.selection, c.courseId === '205' ? 'course-override' : 'base');
  assert.equal(a.candidate.manifest.holeCapabilities['1'].course3d, false);
  const world = preparation.resolveCandidateWorld(a.candidate, c.input);
  near(world.pin, c.provider.detailed.find(p => p.label === 'pin').world);
});

test('unknown application profiles reject; specifically reviewed old/new profiles both remain supported', () => {
  assert.equal(acquisition.supportedApplicationProfile(acquisition.PROFILE.applicationSha256), true);
  assert.equal(acquisition.supportedApplicationProfile(cases[0].provider.appSha256), true);
  assert.equal(acquisition.supportedApplicationProfile('0'.repeat(64)), false);
});

test('missing/ambiguous/wrong query assignments fail rather than choosing host', async () => {
  const resolved = await playerRound.resolveCourseForPlayerRound(cases[1].eventId, cases[1].playerId, 1, transport());
  const change = ids => {
    const resource = structuredClone(resolved.teeTimes), body = acquisition.json(resource);
    body.data.teeTimes.rounds = [{ roundInt: 1, groups: ids.map(courseId => ({ courseId, players: [{ id: cases[1].playerId }] })) }];
    resource.bytes = new TextEncoder().encode(JSON.stringify(body)); resource.evidence.sha256 = acquisition.sha256(resource.bytes); return resource;
  };
  for (const ids of [[], ['005', '205'], ['999']]) assert.throws(() => playerRound.assignmentFromTeeTimes(resolved.discovery.identity, change(ids), cases[1].playerId, 1));
  const wrongQuery = change(['205']); wrongQuery.evidence.variables.id = 'R2026006';
  assert.throws(() => playerRound.assignmentFromTeeTimes(resolved.discovery.identity, wrongQuery, cases[1].playerId, 1), /assignment_query_mismatch/);
});

test('course changes during acquisition reject the prepared candidate', async () => {
  let teeReads = 0;
  const result = await playerRound.prepareCourseForPlayerRound(requestFor(cases[1]), transport((url, r, request) => {
    if (request?.operation === 'GetTeeTimes' && ++teeReads > 1) {
      const body = acquisition.json(r); body.data.teeTimes.rounds = [{ roundInt: 1, groups: [{ courseId: '005', players: [{ id: cases[1].playerId }] }] }];
      r.bytes = new TextEncoder().encode(JSON.stringify(body)); r.evidence.sha256 = acquisition.sha256(r.bytes);
    }
    return r;
  }));
  assert.equal(result.status, 'unsupported'); assert.equal(result.reason, 'course_assignment_changed');
});

test('wrong rotation/offset, missing/nonfinite transform and descriptor spoofing reject before rendering', async () => {
  const { candidate } = await prepare(cases[1]);
  for (const edit of [m => { m.configuration.offset.rotate = 90; }, m => { m.configuration.offset.x += 100; }, m => { delete m.configuration.rawConfig.x; }, m => { m.configuration.offset.y = NaN; }, m => { m.identity.courseId = '005'; }]) {
    const bad = structuredClone(candidate.manifest); edit(bad);
    assert.throws(() => preparation.resolveCandidateWorld({ ...candidate, manifest: bad }, cases[1].input));
  }
});

for (const role of ['terrain', 'green']) test(`swapped ${role} from Pebble cannot validate as Spyglass`, async () => {
  const a = await prepare(cases[1]), b = await prepare(cases[2]);
  const aId = a.candidate.manifest.assets.find(p => p.role === role).id, bId = b.candidate.manifest.assets.find(p => p.role === role).id;
  a.candidate.resources[aId] = b.candidate.resources[bId];
  assert.throws(() => preparation.resolveCandidateWorld(a.candidate, cases[1].input), /source_integrity_failure/);
});

test('wrong course, far pin and wrong hole do not become 3D merely because a mesh exists', async () => {
  const a = await prepare(cases[1]);
  assert.throws(() => preparation.resolveCandidateWorld(a.candidate, { ...cases[1].input, roundNumber: 2 }), /wrong_played_course/);
  assert.throws(() => preparation.resolveCandidateWorld(a.candidate, { ...cases[1].input, holeNumber: 2 }), /unprepared_hole/);
  assert.throws(() => preparation.resolveCandidateWorld(a.candidate, { ...cases[1].input, pin: { tourcastX: 1e9, tourcastY: 1e9, tourcastZ: 1 } }), /unregistered_shots_or_pin/);
});

test('runtime resolves both same-event courses at round scope, with truthful optional replay capabilities', async () => development(async () => {
  for (const c of cases.slice(1)) {
    const replay = JSON.parse(fs.readFileSync(`tmp/shotcast-phase4c/proofs/${c.proofId}/replay.json`));
    const view = await adapter.resolveDevelopmentShotcast(handoff.currentPreparationInput(replay));
    assert.ok(handoff.isShotcast3DView(view)); assert.equal(view.prepared.course.pgaCourseId, c.courseId);
    assert.equal(view.packageId, c.packageId); near(view.pin, c.provider.detailed.find(p => p.label === 'pin').world);
    assert.equal(handoff.matchesReplayEndpoints(view, replay), true); assert.equal(view.puttPaths.length, 0);
    assert.ok(view.greenBounds);
  }
}));

test('proof selectors preserve Waialae and reject traversal/unknown identities; production remains closed', async () => development(async () => {
  const optIn = process.env.SHOTCAST_PREPARATION_PROOF; process.env.SHOTCAST_PREPARATION_PROOF = '1';
  try {
    const legacy = await proofReader.readDevelopmentProof(); assert.equal(legacy.tournamentId, 'R2026006');
    for (const id of ['../spyglass-r1', 'unknown', 'waialae-runtime']) assert.equal(await proofReader.readDevelopmentProof(id), null);
    for (const c of cases.slice(1)) assert.equal((await proofReader.readDevelopmentProof(c.proofId)).roundNumber, c.roundNumber);
    process.env.NODE_ENV = 'production'; assert.equal(await proofReader.readDevelopmentProof('spyglass-r1'), null); assert.deepEqual(await proofReader.readDevelopmentProofChoices(), []);
  } finally { process.env.NODE_ENV = 'development'; if (optIn === undefined) delete process.env.SHOTCAST_PREPARATION_PROOF; else process.env.SHOTCAST_PREPARATION_PROOF = optIn; }
}));
