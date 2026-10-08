import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';

const integration = await importTs('lib/golf/shotcastCapability.server.ts');
const projection = await importTs('lib/shotcast/registry/preparationProjection.server.ts');
const { sha256 } = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const fixture = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-assignments.json')).events[1];
const prepared = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-prepared-spyglass.json'));

function setup(round = 1) {
  const bytes = new TextEncoder().encode(JSON.stringify({ data: { teeTimes: { id: fixture.event.eventId, rounds: fixture.rounds } } }));
  const batch = projection.registryRecordsFromTeeTimes(fixture.event,
    { bytes, evidence: { ...fixture.teeTimesEvidence, sha256: sha256(bytes) } }, fixture.playerId, round);
  const projected = projection.registryRecordsFromPreparedCourse(structuredClone(prepared), '2026-10-07T12:00:00.000Z');
  const tables = {
    shotcast_events: [{ ...batch.event, espn_event_id: '401811937', identity_link_source: 'reviewed-test-link' }],
    shotcast_event_courses: batch.courses,
    shotcast_player_round_courses: [{ ...batch.assignment, golf_player_id: 77 }],
    shotcast_prepared_revisions: [{ ...projected.revision, ...projected.validation, is_current: true }],
    shotcast_revision_assets: projected.assets,
  };
  const calls = [];
  // Only read operations exist. An attempted insert/update/delete or RPC fails the test.
  const db = { from(table) {
    calls.push(['from', table]);
    const filters = [];
    let maximum = Infinity;
    const rows = () => (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, maximum);
    const query = {
      select(columns) { calls.push(['select', table, columns]); return query; },
      eq(key, value) { calls.push(['eq', table, key, value]); filters.push([key, value]); return query; },
      limit(value) { maximum = value; return query; },
      maybeSingle: async () => {
        const matches = rows();
        return matches.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: matches[0] ?? null, error: null };
      },
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then(resolve) { return Promise.resolve({ data: rows(), error: null }).then(resolve); },
    };
    return query;
  } };
  const replay = { tournamentId: 'R2026005', pgaPlayerId: '50525', roundNumber: round, holeNumber: 1,
    playerName: 'Collin Morikawa', observedAt: '2026-10-07T12:00:00.000Z', par: 4, shots: [],
    shotcast: { imageUrl: 'https://example.test/existing-2d.jpg', verified: true }, pinWorld: { x: 1, y: 2, z: 3 } };
  const context = { espnEventId: '401811937', golfPlayerId: 77, round, hole: 1, replay };
  return { tables, calls, db, context, resolve: () => integration.resolveGolfShotcastCapability(db, context) };
}

function stays2D(result, reason) {
  assert.equal(result.renderer, '2d');
  assert.equal(result.activation, 'disabled');
  if (reason) { assert.equal(result.capability.status, 'unavailable'); assert.equal(result.capability.reason, reason); }
}

test('corroborated PGA context invokes the existing resolver; AVAILABLE remains explicitly disabled', async () => {
  const s = setup(), result = await s.resolve();
  stays2D(result);
  assert.equal(result.capability.status, 'available');
  assert.deepEqual(result.capability.request, { eventId: 'R2026005', playerId: '50525', round: 1, hole: 1 });
  assert.equal(result.capability.eventCourse.pga_course_id, '205');
  assert.equal(result.capability.revision.preparation_id, prepared.preparationId);
  assert.equal(result.capability.capabilities.staticCourse.status, 'available');
  assert.equal(result.capability.capabilities.flightReplay.status, 'unknown');
  assert.ok(s.calls.some(c => c[1] === 'shotcast_revision_assets'));
  assert.ok(s.calls.some(c => c[0] === 'eq' && c[1] === 'shotcast_prepared_revisions' && c[2] === 'pga_course_id' && c[3] === '205'));
  assert.deepEqual(integration.golfShotcastCapabilitySummary(result), {
    renderer: '2d', activation: 'disabled', capability: { status: 'available' },
  });
});

for (const [name, change, reason] of [
  ['missing PGA event', s => { s.context.replay.tournamentId = ''; }, 'missing_pga_event_identity'],
  ['missing PGA player', s => { s.context.replay.pgaPlayerId = ''; }, 'missing_pga_player_identity'],
  ['missing application event', s => { s.context.espnEventId = null; }, 'missing_pga_event_identity'],
  ['absent replay', s => { s.context.replay = null; }, 'missing_pga_event_identity'],
  ['ESPN event in PGA field', s => { s.context.replay.tournamentId = s.context.espnEventId; }, 'invalid_request'],
  ['wrong replay round', s => { s.context.replay.roundNumber = 2; }, 'ambiguous_pga_identity'],
  ['wrong replay hole', s => { s.context.replay.holeNumber = 2; }, 'ambiguous_pga_identity'],
]) test(`${name}: 2D with no registry reads`, async () => {
  const s = setup(); change(s);
  stays2D(await s.resolve(), reason);
  assert.deepEqual(s.calls, []);
});

test('invalid round/hole/internal player is rejected before reading metadata', async () => {
  for (const patch of [{ round: 0 }, { round: 5 }, { round: 1.5 }, { hole: 0 }, { hole: 19 },
    { hole: NaN }, { golfPlayerId: 0 }]) {
    const s = setup(); Object.assign(s.context, patch);
    stays2D(await s.resolve(), 'invalid_request'); assert.deepEqual(s.calls, []);
  }
});

for (const [name, change, reason] of [
  ['no explicit event link', s => { s.tables.shotcast_events = []; }, 'missing_pga_event_identity'],
  ['unreviewed event link', s => { s.tables.shotcast_events[0].identity_link_source = null; }, 'missing_pga_event_identity'],
  ['event link conflicts with name-matched replay', s => { s.tables.shotcast_events[0].pga_event_id = 'R2026006'; }, 'ambiguous_pga_identity'],
  ['no explicit player link', s => { s.tables.shotcast_player_round_courses[0].golf_player_id = null; }, 'missing_pga_player_identity'],
  ['ESPN player in PGA field', s => { s.context.replay.pgaPlayerId = '5467'; }, 'ambiguous_pga_identity'],
  ['internal player in PGA field', s => { s.context.replay.pgaPlayerId = '77'; }, 'ambiguous_pga_identity'],
  ['multiple linked PGA players', s => { s.tables.shotcast_player_round_courses.push({ ...s.tables.shotcast_player_round_courses[0], pga_player_id: '99999' }); }, 'ambiguous_pga_identity'],
  ['link only for another round', s => { s.tables.shotcast_player_round_courses[0].round_number = 2; }, 'missing_pga_player_identity'],
]) test(`${name}: 2D without invoking revision resolution`, async () => {
  const s = setup(); change(s);
  stays2D(await s.resolve(), reason);
  assert.ok(!s.calls.some(c => c[1] === 'shotcast_prepared_revisions'));
});

test('UNAVAILABLE preserves Phase 4D.2 reason and keeps internal detail out of public summary', async () => {
  const s = setup(); s.tables.shotcast_prepared_revisions = [];
  const result = await s.resolve(); stays2D(result, 'no_prepared_revision');
  assert.equal(result.capability.detail, 'no_prepared_revision');
  assert.deepEqual(integration.golfShotcastCapabilitySummary(result), {
    renderer: '2d', activation: 'disabled', capability: { status: 'unavailable', reason: 'no_prepared_revision' },
  });
});

test('historical multi-course R2 uses its player/round host assignment, never the R1 preparation', async () => {
  const s = setup(2), result = await s.resolve();
  stays2D(result, 'no_prepared_revision');
  assert.ok(s.calls.some(c => c[0] === 'eq' && c[1] === 'shotcast_prepared_revisions' && c[2] === 'pga_course_id' && c[3] === '005'));
});

test('metadata errors preserve 2D without leaking database details', async () => {
  const s = setup(); s.db.from = () => { throw new Error('private database information'); };
  const result = await s.resolve(); stays2D(result, 'capability_read_failed');
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('read path performs no provider fetch, acquisition or registry mutation; context is intact', async () => {
  const s = setup(), before = structuredClone({ tables: s.tables, context: s.context });
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('provider acquisition forbidden'); };
  try { assert.equal((await s.resolve()).capability.status, 'available'); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(fetches, 0);
  assert.deepEqual({ tables: s.tables, context: s.context }, before);
});

// Execute the existing route with its authorized app/provider boundaries stubbed.
// No browser, live Supabase, provider transport or scoring persistence is involved.
function route(stubs) {
  const loaded = { exports: {} };
  const source = fs.readFileSync('app/api/golf/hole-replay/route.ts', 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    assert.ok(name in stubs, `unexpected route dependency: ${name}`);
    return stubs[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

test('normal authorized hole-replay route adds only diagnostics and preserves replay/scoring context', async () => {
  const s = setup(), before = structuredClone(s.context.replay);
  s.tables.slates = [{ id: 12, sport: 'golf', display_name: 'AT&T Pebble Beach', start_date: '2026-02-12', external_event_id: s.context.espnEventId }];
  s.tables.golf_players = [{ id: 77, display_name: 'Collin Morikawa' }];
  let providerCalls = 0, reconcileCalls = 0;
  const handler = route({
    'next/server': { NextResponse: { json: (body, options) => ({ body, options }) } },
    '@/lib/supabaseAdmin': { supabaseAdmin: s.db },
    '@/lib/security/resourceAuthorization': { authorizeSlateResource: async () => ({ ok: true }) },
    '@/lib/providers/pgaTourShots': { fetchGolfHoleReplay: async input => {
      providerCalls++; assert.equal(input.roundNumber, 1); assert.equal(input.holeNumber, 1); return s.context.replay;
    } },
    '@/lib/golf/holeAcceptance': { shotcastObservation: () => null },
    '@/lib/golf/reconcileGolf': { reconcileGolf: async () => {
      reconcileCalls++; return { events: [], revision: 42, scoringChanged: false };
    } },
    '@/lib/golf/shotcastCapability.server': integration,
  });
  const response = await handler.GET({ nextUrl: new URL('https://example.test/api/golf/hole-replay?slateId=12&playerId=77&round=1&hole=1') });
  assert.deepEqual(response.body.replay, before);
  assert.equal(response.body.success, true);
  assert.equal(response.body.available, false); // Existing availability is shot-count based.
  assert.equal(response.body.acceptedRevision, 42);
  assert.equal(response.body.scoringChanged, false);
  assert.equal(response.body.reconciledHole, null);
  assert.deepEqual(response.body.shotcastCapability, { renderer: '2d', activation: 'disabled', capability: { status: 'available' } });
  assert.equal(response.options.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(providerCalls, 1); assert.equal(reconcileCalls, 1);
});

test('route retains authorization boundary before any provider or capability work', async () => {
  const denied = { status: 403 };
  const forbidden = () => { assert.fail('unauthorized work'); };
  const handler = route({
    'next/server': {}, '@/lib/supabaseAdmin': { supabaseAdmin: { from: forbidden } },
    '@/lib/security/resourceAuthorization': { authorizeSlateResource: async () => ({ ok: false, response: denied }) },
    '@/lib/providers/pgaTourShots': { fetchGolfHoleReplay: forbidden },
    '@/lib/golf/holeAcceptance': {}, '@/lib/golf/reconcileGolf': {},
    '@/lib/golf/shotcastCapability.server': { resolveGolfShotcastCapability: forbidden },
  });
  assert.equal(await handler.GET({ nextUrl: new URL('https://example.test/api/golf/hole-replay?slateId=12&playerId=77&round=1&hole=1') }), denied);
});
