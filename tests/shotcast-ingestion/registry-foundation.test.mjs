import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';

const projection = await importTs('lib/shotcast/registry/preparationProjection.server.ts');
const resolution = await importTs('lib/shotcast/registry/resolution.ts');
const model = await importTs('lib/shotcast/registry/model.ts');
const readerAdapter = await importTs('lib/shotcast/registry/supabaseReader.server.ts');
const acquisition = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const legacy = await importTs('lib/shotcast/preparation/playerRoundCourse.server.ts');
const fixtures = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-assignments.json')).events;
const prepared = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-prepared-spyglass.json'));
const accepted = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/pga-runtime-multicourse.json'));
const recordedAt = '2026-10-07T12:00:00.000Z';

// Hash these compact test projections, never impersonate the original full-payload hash.
function resource(fixture, rounds = fixture.rounds) {
  const body = { data: { teeTimes: { id: fixture.event.eventId, rounds } },
    leaderboard: { courseId: fixture.finalLeaderboardCourseId } };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return { bytes, evidence: { ...fixture.teeTimesEvidence, sha256: acquisition.sha256(bytes) } };
}
function records(fixture, round = 1, rounds = fixture.rounds) {
  return projection.registryRecordsFromTeeTimes(fixture.event, resource(fixture, rounds), fixture.playerId, round);
}
function reader(batch, assignments = [batch.assignment]) {
  return { readEvent: async () => batch.event, readCourses: async () => batch.courses, readAssignments: async () => assignments };
}
const resolve = batch => resolution.resolveCourseForPlayerRound(reader(batch), batch.event.pga_event_id, batch.assignment.pga_player_id, batch.assignment.round_number);
const playerGroups = (fixture, ids) => [{ roundInt: 1, groups: ids.map(courseId => ({ courseId, players: [{ id: fixture.playerId }] })) }];

test('single-course assignment has explicit player/round authority and durable provenance', async () => {
  const batch = records(fixtures[0]), result = await resolve(batch);
  assert.equal(result.state, 'authoritative'); assert.equal(result.eventCourse.pga_course_id, '006');
  assert.equal(result.player.pgaPlayerId, '59095'); assert.equal(result.roundNumber, 1);
  assert.equal(result.source, 'tee-time-player-round-course'); assert.ok(result.provenance.groups.length);
});

test('accepted Morikawa R1 Spyglass / R2–R4 Pebble identities survive the durable contract', async () => {
  for (const round of [1, 2, 3, 4]) {
    const batch = records(fixtures[1], round), result = await resolve(batch);
    const original = legacy.assignmentFromTeeTimes(fixtures[1].event, resource(fixtures[1]), '50525', round);
    assert.equal(result.state, 'authoritative');
    assert.equal(result.eventCourse.pga_course_id, round === 1 ? '205' : '005');
    assert.equal(result.eventCourse.pga_course_id, original.course.id);
    assert.equal(result.event.season, 2026); assert.equal(batch.courses.length, 2);
  }
  for (const proof of accepted.cases) {
    const fixture = fixtures.find(f => f.event.eventId === proof.eventId);
    const result = await resolve(records(fixture, proof.roundNumber));
    assert.equal(result.eventCourse.pga_course_id, proof.courseId);
  }
});

test('final leaderboard course 005 never overrides historical R1 course 205', async () => {
  assert.equal(fixtures[1].finalLeaderboardCourseId, '005');
  assert.equal((await resolve(records(fixtures[1]))).eventCourse.pga_course_id, '205');
});

for (const fixture of fixtures) test(`${fixture.event.eventId}: missing player membership has no host fallback`, async () => {
  const batch = records(fixture, 1, playerGroups(fixture, [])), result = await resolve(batch);
  assert.equal(batch.assignment.state, 'unresolved'); assert.equal(batch.assignment.pga_course_id, null);
  assert.equal(result.state, 'unresolved'); assert.equal(result.eventCourse, null);
});

test('another player or round cannot supply membership, even on the host', async () => {
  const fixture = fixtures[1], rounds = [{ roundInt: 1, groups: [{ courseId: '005', players: [{ id: '99999' }] }] },
    { roundInt: 2, groups: [{ courseId: '005', players: [{ id: fixture.playerId }] }] }];
  assert.equal((await resolve(records(fixture, 1, rounds))).state, 'unresolved');
});

test('conflicting tee-time course assignments remain unresolved', async () => {
  const batch = records(fixtures[1], 1, playerGroups(fixtures[1], ['005', '205']));
  assert.equal(batch.assignment.state, 'unresolved'); assert.equal((await resolve(batch)).eventCourse, null);
});

test('unlisted course is unresolved at both provider projection and registry read boundaries', async () => {
  const batch = records(fixtures[1], 1, playerGroups(fixtures[1], ['999']));
  assert.equal((await resolve(batch)).state, 'unresolved');
  const known = records(fixtures[1]); known.courses = known.courses.filter(c => c.pga_course_id !== '205');
  assert.equal((await resolve(known)).reason, 'unknown_course');
});

test('wrong query, wrong event and tampered resource hashes cannot establish authority', async () => {
  for (const alter of [r => { r.evidence.variables = { id: 'R2026006' }; },
    r => { r.evidence.sha256 = '0'.repeat(64); },
    r => { const b = JSON.parse(new TextDecoder().decode(r.bytes)); b.data.teeTimes.id = 'R2026006';
      r.bytes = new TextEncoder().encode(JSON.stringify(b)); r.evidence.sha256 = acquisition.sha256(r.bytes); }]) {
    const fixture = fixtures[1], r = resource(fixture); alter(r);
    const batch = projection.registryRecordsFromTeeTimes(fixture.event, r, fixture.playerId, 1);
    assert.equal((await resolve(batch)).state, 'unresolved');
  }
});

test('registry reads reject absent/duplicate assignments and invalid stored provenance', async () => {
  const batch = records(fixtures[1]), args = [batch.event.pga_event_id, '50525', 1];
  assert.equal((await resolution.resolveCourseForPlayerRound(reader(batch, []), ...args)).reason, 'missing_assignment');
  assert.equal((await resolution.resolveCourseForPlayerRound(reader(batch, [batch.assignment, batch.assignment]), ...args)).reason, 'ambiguous_assignment');
  batch.assignment.provenance.groups[0].roundNumber = 2;
  assert.equal((await resolve(batch)).reason, 'invalid_assignment_provenance');
});

test('invalid request and missing event remain unresolved', async () => {
  const batch = records(fixtures[1]);
  assert.equal((await resolution.resolveCourseForPlayerRound(reader(batch), batch.event.pga_event_id, '50525', 0)).state, 'unresolved');
  assert.equal((await resolution.resolveCourseForPlayerRound({ ...reader(batch), readEvent: async () => null }, batch.event.pga_event_id, '50525', 1)).reason, 'event_not_registered');
});

test('application links are explicit; registry does not infer ESPN or internal player IDs', () => {
  const fixture = fixtures[1], batch = records(fixture);
  assert.equal(batch.event.espn_event_id, null); assert.equal(batch.assignment.golf_player_id, null);
  assert.throws(() => projection.registryRecordsFromTeeTimes(fixture.event, resource(fixture), '50525', 1, { espnEventId: '123' }), /invalid_registry_identity/);
  const linked = projection.registryRecordsFromTeeTimes(fixture.event, resource(fixture), '50525', 1,
    { espnEventId: '123', identityLinkSource: 'reviewed tournament mapping', golfPlayerId: 42 });
  assert.equal(linked.event.espn_event_id, '123'); assert.equal(linked.assignment.golf_player_id, 42);
});

test('accepted prepared revision projects only metadata, staged assets and a separate validation patch', () => {
  const batch = projection.registryRecordsFromPreparedCourse(prepared, recordedAt);
  assert.equal(batch.revision.state, 'staged'); assert.equal(batch.revision.is_current, false);
  assert.equal(batch.validation.state, 'validated'); assert.equal(batch.validation.validation_proof.hole, 1);
  assert.equal(batch.revision.preparation_id, prepared.preparationId);
  assert.equal(batch.revision.configuration_sha256, prepared.identity.configurationIdentity);
  assert.equal(batch.assets.length, prepared.assets.length);
  assert.ok(batch.assets.every(a => a.sha256.length === 64 && !('bytes' in a) && !('localPath' in a)));
  assert.equal(model.selectCurrentPreparedRevision([{ ...batch.revision, ...batch.validation }], 'R2026005', '205'), null);
});

test('unvalidated preparation remains staged, while invalid proofs/content reject', () => {
  const staged = structuredClone(prepared); staged.registrationProof = null;
  const batch = projection.registryRecordsFromPreparedCourse(staged, recordedAt);
  assert.equal(batch.revision.state, 'staged'); assert.equal(batch.validation, null);
  for (const alter of [m => { m.registrationProof.maximumResidualMetres = 1; }, m => { m.assets[0].sha256 = '0'.repeat(64); }]) {
    const bad = structuredClone(prepared); alter(bad);
    assert.throws(() => projection.registryRecordsFromPreparedCourse(bad, recordedAt));
  }
});

test('explicit states parse; only one explicitly current validated revision can be selected', () => {
  const batch = projection.registryRecordsFromPreparedCourse(prepared, recordedAt);
  const current = { ...batch.revision, ...batch.validation, is_current: true };
  for (const state of model.PREPARED_REVISION_STATES) {
    assert.equal(model.parsePreparedRevisionState(state), state);
    assert.equal(model.selectCurrentPreparedRevision([{ ...current, state }], 'R2026005', '205') !== null, state === 'validated');
  }
  assert.equal(model.parsePreparedRevisionState('ready'), null);
  assert.equal(model.selectCurrentPreparedRevision([current, current], 'R2026005', '205'), null);
  assert.equal(model.selectCurrentPreparedRevision([current], 'R2026005', '005'), null);
  assert.equal(model.selectCurrentPreparedRevision([{ ...current, validation_proof: null }], 'R2026005', '205'), null);
});

test('Supabase seam performs only event-scoped metadata reads; no acquisition or writes', async () => {
  const batch = records(fixtures[1]), calls = [];
  const data = { shotcast_events: batch.event, shotcast_event_courses: batch.courses, shotcast_player_round_courses: [batch.assignment] };
  const db = { from(table) {
    const query = { select(columns) { calls.push(['select', table, columns]); return this; },
      eq(key, value) { calls.push(['eq', table, key, value]); return this; },
      maybeSingle: async () => ({ data: data[table], error: null }),
      then(fn) { return Promise.resolve({ data: data[table], error: null }).then(fn); } };
    return query;
  } };
  const result = await resolution.resolveCourseForPlayerRound(readerAdapter.createShotcastRegistryReader(db), 'R2026005', '50525', 1);
  assert.equal(result.eventCourse.pga_course_id, '205');
  for (const table of Object.keys(data)) assert.ok(calls.some(c => c[0] === 'eq' && c[1] === table && c[2] === 'pga_event_id' && c[3] === 'R2026005'));
  assert.ok(calls.some(c => c[2] === 'pga_player_id' && c[3] === '50525'));
  assert.ok(calls.some(c => c[2] === 'round_number' && c[3] === 1));
});

test('migration adds only ShotCast tables with scoped keys, current uniqueness and browser isolation', () => {
  const sql = fs.readFileSync('supabase/migrations/20261007000100_shotcast_registry_foundation.sql', 'utf8');
  assert.equal((sql.match(/create table public\.shotcast_/g) ?? []).length, 5);
  assert.ok(sql.includes('primary key (pga_event_id,pga_player_id,round_number)'));
  assert.ok(sql.includes('foreign key (pga_event_id,pga_course_id)'));
  assert.ok(sql.includes('where is_current'));
  assert.equal((sql.match(/enable row level security/g) ?? []).length, 5);
  assert.equal(/alter table public\.(slates|golf_|teams|memberships)/.test(sql), false);
});


test('tournament lookup reads only the explicit ESPN/PGA link and preserves missing links', async () => {
  const batch = records(fixtures[1]), calls = [];
  let stored = { ...batch.event, espn_event_id: '123', identity_link_source: 'reviewed mapping' };
  const db = { from(table) {
    calls.push(['from', table]);
    return { select() { return this; }, eq(key, value) { calls.push([key, value]); return this; },
      maybeSingle: async () => ({ data: stored, error: null }) };
  } };
  assert.equal((await readerAdapter.findShotcastEventForTournament(db, '123')).pga_event_id, 'R2026005');
  assert.deepEqual(calls, [['from', 'shotcast_events'], ['espn_event_id', '123']]);
  stored = null;
  assert.equal(await readerAdapter.findShotcastEventForTournament(db, '123'), null);
});
