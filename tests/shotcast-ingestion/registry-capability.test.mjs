import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';

const { resolveShotcast3DCapability } = await importTs('lib/shotcast/registry/capability.server.ts');
const adapter = await importTs('lib/shotcast/registry/supabaseReader.server.ts');
const projection = await importTs('lib/shotcast/registry/preparationProjection.server.ts');
const { sha256 } = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const fixture = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-assignments.json')).events[1];
const prepared = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-prepared-spyglass.json'));
const request = { eventId: 'R2026005', playerId: '50525', round: 1, hole: 1 };
const recordedAt = '2026-10-07T12:00:00.000Z';

function setup(round = 1) {
  const bytes = new TextEncoder().encode(JSON.stringify({ data: { teeTimes: { id: fixture.event.eventId, rounds: fixture.rounds } } }));
  const batch = projection.registryRecordsFromTeeTimes(fixture.event,
    { bytes, evidence: { ...fixture.teeTimesEvidence, sha256: sha256(bytes) } }, fixture.playerId, round);
  const projected = projection.registryRecordsFromPreparedCourse(structuredClone(prepared), recordedAt);
  const spyglass = { ...projected.revision, ...projected.validation, is_current: true };
  // Synthetic metadata-only selector fixture for Pebble; not a new geometry validation claim.
  const pebbleId = 'a'.repeat(64), pebbleRoot = 'https://tourcast.pgatour.com/models/R2026005/3D_Assets/';
  const pebble = { ...structuredClone(spyglass), preparation_id: pebbleId, pga_course_id: '005',
    package_id: 'pga-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', asset_root: pebbleRoot,
    validation_proof: { ...structuredClone(spyglass.validation_proof), preparationId: pebbleId } };
  const store = { ...batch, assignments: [batch.assignment], revisions: [spyglass, pebble],
    assets: [...projected.assets, ...projected.assets.map(a => ({ ...a, preparation_id: pebbleId,
      source_url: a.source_url.replace(spyglass.asset_root, pebbleRoot) }))] };
  const calls = [];
  const reader = {
    readEvent: async eventId => { calls.push(['event', eventId]); return store.event; },
    readCourses: async eventId => { calls.push(['courses', eventId]); return store.courses; },
    readAssignments: async (...args) => { calls.push(['assignments', ...args]); return store.assignments; },
    readPreparedRevisions: async (eventId, courseId) => {
      calls.push(['revisions', eventId, courseId]);
      return store.revisions.filter(r => r.pga_event_id === eventId && r.pga_course_id === courseId);
    },
    readRevisionAssets: async id => { calls.push(['assets', id]); return store.assets.filter(a => a.preparation_id === id); },
  };
  return { store, reader, calls, spyglass, pebble, resolve: () => resolveShotcast3DCapability(reader, { ...request, round }) };
}

test('approved validated Spyglass R1/H1 returns identity, revision and static geometry', async () => {
  const s = setup(), result = await s.resolve();
  assert.equal(result.status, 'available');
  assert.deepEqual(result.request, request);
  assert.equal(result.event.pga_event_id, request.eventId);
  assert.equal(result.player.pgaPlayerId, request.playerId);
  assert.equal(result.round, 1); assert.equal(result.hole, 1);
  assert.equal(result.eventCourse.pga_course_id, '205');
  assert.equal(result.preparationId, prepared.preparationId);
  assert.equal(result.preparationVersion, '1');
  assert.equal(result.revision.is_current, true); assert.equal(result.revision.state, 'validated');
  assert.equal(result.assignment.source, 'tee-time-player-round-course');
  assert.equal(result.capabilities.staticCourse.status, 'available');
  assert.equal(result.capabilities.staticCourse.assets.length, 7);
});

test('historical R1 Spyglass and R2–R4 Pebble select their own revision without host/leaderboard leakage', async () => {
  assert.equal(fixture.finalLeaderboardCourseId, '005');
  for (const round of [1, 2, 3, 4]) {
    const s = setup(round), result = await s.resolve();
    assert.equal(result.status, 'available');
    assert.equal(result.eventCourse.pga_course_id, round === 1 ? '205' : '005');
    assert.equal(result.preparationId, round === 1 ? s.spyglass.preparation_id : s.pebble.preparation_id);
    assert.ok(result.capabilities.staticCourse.assets.every(a => a.preparation_id === result.preparationId));
    assert.ok(s.calls.some(c => c[0] === 'revisions' && c[2] === result.eventCourse.pga_course_id));
  }
  const s = setup(); s.store.revisions = [s.pebble];
  assert.equal((await s.resolve()).reason, 'no_prepared_revision');
});

for (const [name, alter, reason] of [
  ['event missing', s => { s.store.event = null; }, 'event_not_registered'],
  ['assignment missing', s => { s.store.assignments = []; }, 'course_assignment_missing'],
  ['assignment ambiguous', s => { s.store.assignments.push(s.store.assignment); }, 'course_assignment_ambiguous'],
  ['assignment unresolved', s => { Object.assign(s.store.assignment, { state: 'unresolved', pga_course_id: null, unresolved_reason: 'missing_or_ambiguous_assignment' }); }, 'course_assignment_unresolved'],
  ['course missing', s => { s.store.courses = s.store.courses.filter(c => c.pga_course_id !== '205'); }, 'course_not_registered'],
  ['no prepared revision', s => { s.store.revisions = []; }, 'no_prepared_revision'],
  ['validated revision without approval', s => { s.spyglass.is_current = false; }, 'revision_not_approved'],
  ['ambiguous approved revisions', s => { s.store.revisions.push(structuredClone(s.spyglass)); }, 'revision_ambiguous'],
  ['missing proof', s => { s.spyglass.validation_proof = null; }, 'revision_not_validated'],
  ['missing validation date', s => { s.spyglass.validated_at = null; }, 'revision_not_validated'],
  ['hole not prepared', s => { s.spyglass.prepared_holes = [2]; }, 'hole_not_prepared'],
  ['prepared hole outside bounded proof', s => { s.spyglass.prepared_holes.push(2); s.spyglass.validation_proof.hole = 2; }, 'revision_not_validated'],
]) test(`${name} gives ${reason}`, async () => {
  const s = setup(); alter(s);
  const result = await s.resolve();
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, reason);
  assert.ok(result.detail); assert.equal('capabilities' in result, false);
});

for (const state of ['pending', 'staged', 'rejected', 'stale']) {
  test(`${state} revisions remain ineligible with or without an invalid approval flag`, async () => {
    for (const isCurrent of [false, true]) {
      const s = setup(); Object.assign(s.spyglass, { state, is_current: isCurrent });
      assert.equal((await s.resolve()).reason, `revision_${state}`);
    }
  });
}

test('multiple unapproved states have deterministic diagnostics independent of order/timestamps', async () => {
  const s = setup(); Object.assign(s.spyglass, { state: 'pending', is_current: false });
  s.store.revisions.push({ ...s.spyglass, state: 'staged', state_changed_at: '2099-01-01T00:00:00Z' });
  assert.equal((await s.resolve()).reason, 'revision_not_approved');
  s.store.revisions.reverse();
  assert.equal((await s.resolve()).reason, 'revision_not_approved');
});

test('a newer validated but unapproved revision never replaces explicit current approval', async () => {
  const s = setup(); s.store.revisions.unshift({ ...s.spyglass, is_current: false, validated_at: '2099-01-01T00:00:00Z' });
  const result = await s.resolve();
  assert.equal(result.status, 'available'); assert.equal(result.revision.validated_at, recordedAt);
});

for (const assetId of ['course-data', 'course-image', 'course-world', 'h1-terrain', 'h1-image', 'h1-world', 'h1-mask']) {
  test(`missing required ${assetId} falls back to 2D`, async () => {
    const s = setup(); s.store.assets = s.store.assets.filter(a => a.asset_id !== assetId);
    assert.equal((await s.resolve()).reason, 'required_assets_missing');
  });
}

for (const [name, alter] of [
  ['unknown state', s => { s.spyglass.state = 'ready'; }],
  ['untrusted current flag', s => { s.spyglass.is_current = 'true'; }],
  ['wrong event from revision reader', s => { s.reader.readPreparedRevisions = async () => [{ ...s.spyglass, pga_event_id: 'R2026006' }]; }],
  ['wrong course from revision reader', s => { s.reader.readPreparedRevisions = async () => [s.pebble]; }],
  ['wrong assignment round', s => { s.store.assignment.round_number = 2; }],
  ['invalid assignment provenance', s => { s.store.assignment.provenance.groups[0].courseId = '005'; }],
  ['duplicate course identity', s => { s.store.courses.push(s.store.courses.find(c => c.pga_course_id === '205')); }],
  ['wrong proof identity', s => { s.spyglass.validation_proof.preparationId = '0'.repeat(64); }],
  ['failed residual', s => { s.spyglass.validation_proof.maximumResidualMetres = 1; }],
  ['nonfinite comparisons', s => { s.spyglass.validation_proof.comparisons = NaN; }],
  ['invalid proof hash', s => { s.spyglass.validation_proof.nativeSha256 = 'invalid'; }],
  ['invalid preparation ID', s => { s.spyglass.preparation_id = null; }],
  ['wrong package identity', s => { s.spyglass.package_id = s.pebble.package_id; }],
  ['unknown profile', s => { s.spyglass.registration_profile = 'unreviewed'; }],
  ['unknown application hash', s => { s.spyglass.application_sha256 = '0'.repeat(64); }],
  ['wrong asset root', s => { s.spyglass.asset_root = s.pebble.asset_root; }],
  ['mixed revision assets', s => { s.reader.readRevisionAssets = async () => s.store.assets; }],
  ['invalid asset hash', s => { s.store.assets[0].sha256 = 'invalid'; }],
  ['duplicate asset', s => { s.store.assets.push(s.store.assets[0]); }],
]) test(`${name} fails closed`, async () => {
  const s = setup(); alter(s);
  assert.equal((await s.resolve()).reason, 'validation_failed');
});

test('detailed green is granular; absent green/flight/putt material preserves static 3D', async () => {
  const s = setup(), withGreen = await s.resolve();
  assert.equal(withGreen.capabilities.detailedGreen.status, 'available');
  assert.equal(withGreen.capabilities.detailedGreen.asset.asset_id, 'h1-green');
  s.store.assets = s.store.assets.filter(a => a.role !== 'green');
  const result = await s.resolve();
  assert.equal(result.status, 'available'); assert.equal(result.capabilities.staticCourse.status, 'available');
  assert.deepEqual(result.capabilities.detailedGreen, { status: 'unavailable', reason: 'asset_not_recorded' });
  for (const key of ['flightReplay', 'suppliedPuttReplay']) {
    assert.deepEqual(result.capabilities[key], { status: 'unknown', reason: 'replay_evidence_not_recorded' });
  }
});

test('invalid request performs no reads', async () => {
  const s = setup();
  for (const patch of [{ eventId: 'invalid' }, { playerId: 'invalid' }, { round: 0 }, { hole: 0 }, { hole: 19 }]) {
    assert.equal((await resolveShotcast3DCapability(s.reader, { ...request, ...patch })).reason, 'invalid_request');
  }
  assert.deepEqual(s.calls, []);
});

test('resolution is read-only and never fetches provider or asset data', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider acquisition'); });
  const s = setup(), before = structuredClone(s.store);
  assert.equal((await s.resolve()).status, 'available');
  assert.deepEqual(s.store, before); assert.equal(fetchMock.mock.callCount(), 0);
});

test('Supabase server API uses only scoped selects, preserving database errors', async () => {
  const s = setup(), calls = [];
  const rows = { shotcast_events: s.store.event, shotcast_event_courses: s.store.courses,
    shotcast_player_round_courses: s.store.assignments, shotcast_prepared_revisions: [s.spyglass],
    shotcast_revision_assets: s.store.assets.filter(a => a.preparation_id === s.spyglass.preparation_id) };
  let failedTable = null;
  const db = { from(table) {
    const response = () => ({ data: rows[table], error: table === failedTable ? { message: 'offline' } : null });
    return { select(columns) { calls.push(['select', table, columns]); return this; },
      eq(key, value) { calls.push(['eq', table, key, value]); return this; },
      maybeSingle: async () => response(), then(fn) { return Promise.resolve(response()).then(fn); } };
  } };
  const resolve = adapter.createShotcast3DCapabilityResolver(db);
  assert.equal((await resolve(request)).status, 'available');
  assert.ok(calls.some(c => c[1] === 'shotcast_prepared_revisions' && c[2] === 'pga_event_id' && c[3] === request.eventId));
  assert.ok(calls.some(c => c[1] === 'shotcast_prepared_revisions' && c[2] === 'pga_course_id' && c[3] === '205'));
  assert.ok(calls.some(c => c[1] === 'shotcast_revision_assets' && c[2] === 'preparation_id' && c[3] === s.spyglass.preparation_id));
  for (const table of ['shotcast_prepared_revisions', 'shotcast_revision_assets']) {
    failedTable = table;
    await assert.rejects(resolve(request), /read failed: offline/);
  }
});
