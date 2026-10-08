import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';

const api = await importTs('lib/shotcast/storage/preparedAssets.server.ts');
const golf = await importTs('lib/golf/preparedShotcastAssets.server.ts');
const projection = await importTs('lib/shotcast/registry/preparationProjection.server.ts');
const { hashValue } = await importTs('lib/shotcast/preparation/prepareCourse.server.ts');
const prepared = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-prepared-spyglass.json'));
const fixture = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/registry-assignments.json')).events[1];
const at = '2026-10-07T12:00:00.000Z';
const origin = 'https://example.supabase.co';
const media = { terrain: 'model/gltf-binary', green: 'model/gltf-binary', image: 'image/jpeg',
  mask: 'image/png', 'world-file': 'text/plain', 'course-data': 'application/json' };

function signedUrl(path, patch = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { url: `${api.PREPARED_ASSET_BUCKET}/${path}`, scope: 'download', iat, exp: iat + 60, ...patch };
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), 'stub-signature'].join('.');
  return `${origin}/storage/v1/object/sign/${api.PREPARED_ASSET_BUCKET}/${path}?token=${token}`;
}

function setup() {
  const bytes = Buffer.from(JSON.stringify({ data: { teeTimes: { id: fixture.event.eventId, rounds: fixture.rounds } } }));
  const batch = projection.registryRecordsFromTeeTimes(fixture.event,
    { bytes, evidence: { ...fixture.teeTimesEvidence, sha256: createHash('sha256').update(bytes).digest('hex') } },
    fixture.playerId, 1, { espnEventId: 'espn-1', identityLinkSource: 'reviewed', golfPlayerId: 7 });
  const projected = projection.registryRecordsFromPreparedCourse(structuredClone(prepared), at);
  const revision = { ...projected.revision, ...projected.validation, is_current: true };
  const manifest = { schemaVersion: 1, packageSchemaVersion: 2, preparationId: revision.preparation_id,
    preparationVersion: '1', hole: 1, assets: projected.assets.map(a => ({ assetId: a.asset_id, kind: a.role,
      objectPath: api.preparedAssetObjectPath(a.preparation_id, a.asset_id), sha256: a.sha256,
      sizeBytes: 12, mediaType: media[a.role] })) };
  const record = { preparation_id: revision.preparation_id, manifest_sha256: hashValue(manifest), manifest,
    state: 'approved', integrity_verified_at: at, approved_at: at };
  const calls = [];
  const rows = { shotcast_events: [batch.event], shotcast_event_courses: batch.courses,
    shotcast_player_round_courses: [batch.assignment], shotcast_prepared_revisions: [revision],
    shotcast_revision_assets: projected.assets, shotcast_asset_delivery_manifests: [record],
    slates: [{ id: 3, sport: 'golf', league_id: 'league-1', external_event_id: 'espn-1' }],
    golf_event_players: [{ slate_id: 3, player_id: 7 }] };
  const reader = {
    readEvent: async () => batch.event, readCourses: async () => batch.courses, readAssignments: async () => [batch.assignment],
    readPreparedRevisions: async () => [revision], readRevisionAssets: async () => rows.shotcast_revision_assets,
  };
  const storage = {
    origin, readManifest: async id => { calls.push(['manifest', id]); return record; },
    stat: async path => { calls.push(['stat', path]); return { sizeBytes: 12, mediaType: manifest.assets.find(a => a.objectPath === path)?.mediaType }; },
    sign: async (paths, ttl) => { calls.push(['sign', paths, ttl]); return paths.map(path => ({ path, signedUrl: signedUrl(path), error: null })); },
  };
  const input = { request: { eventId: 'R2026005', playerId: '50525', round: 1, hole: 1 },
    approvedRevision: { preparation_id: revision.preparation_id }, eventCourse: batch.courses.find(c => c.pga_course_id === '205'), hole: 1 };
  const authorization = { ok: true, mode: 'user', user: { id: 'user-1' },
    target: { id: 3, leagueId: 'league-1', groupId: 'group-1', sportKey: 'golf' } };
  const auth = async id => { calls.push(['authorize', id]); return authorization; };
  let failedTable = null;
  const db = { from(table) {
    calls.push(['table', table]);
    const filters = []; let bound = Infinity;
    const result = single => {
      const matches = rows[table].filter(row => filters.every(([k, v]) => row[k] === v)).slice(0, bound);
      return { data: single ? matches[0] ?? null : matches, error: table === failedTable ? { message: 'SECRET_SERVICE_KEY' } : null };
    };
    return { select() { return this; }, eq(k, v) { calls.push(['eq', table, k, v]); filters.push([k, v]); return this; },
      limit(n) { calls.push(['limit', table, n]); bound = n; return this; }, maybeSingle: async () => result(true),
      then(fn) { return Promise.resolve(result(false)).then(fn); } };
  }, storage: { from(bucket) {
    calls.push(['bucket', bucket]);
    assert.equal(bucket, api.PREPARED_ASSET_BUCKET);
    return { async info(path) { const s = await storage.stat(path); return { data: s && { size: s.sizeBytes, contentType: s.mediaType }, error: null }; },
      async createSignedUrls(paths, ttl) { return { data: await storage.sign(paths, ttl), error: null }; } };
  } } };
  const golfInput = { slateId: 3, golfPlayerId: 7, round: 1, hole: 1 };
  return { revision, manifest, record, rows, storage, reader, input, calls, authorization, golfInput,
    failTable: table => { failedTable = table; },
    rehash: () => { record.manifest_sha256 = hashValue(manifest); },
    resolve: () => api.resolvePreparedShotcastAssets(reader, storage, input),
    deliver: () => golf.createGolfPreparedShotcastAssetDelivery(db, auth, origin)(golfInput) };
}

test('approved revision resolves only its eight verified objects with 60-second scoped URLs', async () => {
  const s = setup(), result = await s.resolve();
  assert.equal(result.status, 'available'); assert.equal(result.assets.length, 8);
  assert.equal(result.manifestId, s.record.manifest_sha256);
  assert.deepEqual(result.scope, { eventId: 'R2026005', courseId: '205', playerId: '50525', round: 1, hole: 1 });
  assert.ok(result.assets.every(a => a.objectPath.startsWith(`revisions/${s.revision.preparation_id}/`)));
  const sign = s.calls.find(c => c[0] === 'sign'); assert.equal(sign[2], 60); assert.equal(sign[1].length, 8);
  assert.ok(Date.parse(result.expiresAt) <= Date.now() + 61000);
});

for (const state of ['pending', 'staged', 'rejected', 'stale']) test(`${state} registration denied before storage`, async () => {
  const s = setup(); s.revision.state = state;
  assert.equal((await s.resolve()).status, 'unavailable'); assert.deepEqual(s.calls, []);
});
for (const state of ['pending', 'rejected', 'stale']) test(`${state} delivery approval denied before signing`, async () => {
  const s = setup(); s.record.state = state;
  assert.equal((await s.resolve()).reason, 'manifest_unavailable'); assert.equal(s.calls.length, 1);
});

for (const [name, alter] of [
  ['unapproved revision', s => { s.revision.is_current = false; }],
  ['wrong expected revision', s => { s.input.approvedRevision.preparation_id = 'a'.repeat(64); }],
  ['wrong event', s => { s.input.eventCourse.pga_event_id = 'R2026006'; }],
  ['wrong course', s => { s.input.eventCourse.pga_course_id = '005'; }],
  ['wrong player', s => { s.input.request.playerId = '59095'; }],
  ['ambiguous approved revisions', s => { s.reader.readPreparedRevisions = async () => [s.revision, s.revision]; }],
  ['wrong hole', s => { s.input.hole = 2; }],
  ['hole outside proof', s => { s.input.hole = s.input.request.hole = 2; s.revision.prepared_holes.push(2); }],
  ['missing required registry asset', s => { s.rows.shotcast_revision_assets.pop(); }],
]) test(`${name} denied`, async () => {
  const s = setup(); alter(s); assert.equal((await s.resolve()).status, 'unavailable'); assert.deepEqual(s.calls, []);
});

for (const [name, alter] of [
  ['missing manifest', s => { s.storage.readManifest = async () => null; }],
  ['wrong manifest revision', s => { s.manifest.preparationId = 'a'.repeat(64); }],
  ['wrong record revision', s => { s.record.preparation_id = 'a'.repeat(64); }],
  ['wrong preparation version', s => { s.manifest.preparationVersion = '2'; }],
  ['wrong package schema', s => { s.manifest.packageSchemaVersion = 1; }],
  ['wrong manifest schema', s => { s.manifest.schemaVersion = 2; }],
  ['wrong manifest hole', s => { s.manifest.hole = 2; }],
  ['missing required stored asset', s => { s.manifest.assets.pop(); }],
  ['duplicate asset', s => { s.manifest.assets[1] = s.manifest.assets[0]; }],
  ['invalid hash', s => { s.manifest.assets[0].sha256 = 'bad'; }],
  ['mismatched hash', s => { s.manifest.assets[0].sha256 = 'a'.repeat(64); }],
  ['invalid size', s => { s.manifest.assets[0].sizeBytes = -1; }],
  ['oversized asset', s => { s.manifest.assets[0].sizeBytes = api.MAX_ASSET_BYTES + 1; }],
  ['wrong media type', s => { s.manifest.assets[0].mediaType = 'text/html'; }],
  ['wrong kind', s => { s.manifest.assets[0].kind = 'terrain'; }],
  ['wrong namespace', s => { s.manifest.assets[0].objectPath = `revisions/${'a'.repeat(64)}/course-data.bin`; }],
  ['traversal', s => { s.manifest.assets[0].objectPath += '/../secret'; }],
  ['encoded traversal', s => { s.manifest.assets[0].objectPath += '/%2e%2e/secret'; }],
  ['absolute local path', s => { s.manifest.assets[0].objectPath = '/tmp/research.bin'; }],
  ['arbitrary bucket', s => { s.manifest.assets[0].bucket = 'avatars'; }],
  ['arbitrary key', s => { s.manifest.assets[0].objectPath = 'other/key.bin'; }],
  ['unbounded manifest', s => { s.manifest.assets = Array(1000).fill(s.manifest.assets[0]); }],
  ['unverified integrity', s => { s.record.integrity_verified_at = null; }],
  ['missing explicit approval', s => { s.record.approved_at = null; }],
  ['approval before verification', s => { s.record.approved_at = '2020-01-01'; }],
  ['leaked local metadata', s => { s.manifest.localPath = 'tmp/research'; }],
]) test(`${name} manifest fails closed`, async () => {
  const s = setup(); alter(s); s.rehash();
  assert.equal((await s.resolve()).status, 'unavailable'); assert.equal(s.calls.some(c => c[0] === 'sign'), false);
});

test('manifest content hash must match', async () => {
  const s = setup(); s.manifest.assets[0].sizeBytes++;
  assert.equal((await s.resolve()).reason, 'manifest_invalid');
});
test('optional Green absent from both registry and manifest allows seven static objects', async () => {
  const s = setup(); s.rows.shotcast_revision_assets = s.rows.shotcast_revision_assets.filter(a => a.role !== 'green');
  s.manifest.assets = s.manifest.assets.filter(a => a.kind !== 'green'); s.rehash();
  assert.equal((await s.resolve()).assets.length, 7);
});

for (const [name, alter] of [
  ['missing object', s => { s.storage.stat = async () => null; }],
  ['object size mismatch', s => { s.storage.stat = async () => ({ sizeBytes: 10, mediaType: 'application/json' }); }],
  ['object media mismatch', s => { s.storage.stat = async () => ({ sizeBytes: 12, mediaType: 'text/html' }); }],
  ['stat error', s => { s.storage.stat = async () => { throw new Error('SECRET_SERVICE_KEY'); }; }],
  ['manifest database error', s => { s.storage.readManifest = async () => { throw new Error('SECRET_SERVICE_KEY'); }; }],
  ['registry error', s => { s.reader.readEvent = async () => { throw new Error('SECRET_SERVICE_KEY'); }; }],
  ['signing error', s => { s.storage.sign = async () => { throw new Error('SECRET_SERVICE_KEY'); }; }],
  ['partial signing', s => { s.storage.sign = async () => []; }],
  ['per-object signing error', s => { s.storage.sign = async paths => paths.map(path => ({ path, error: 'SECRET_SERVICE_KEY', signedUrl: null })); }],
]) test(`${name} fails closed without leaking errors`, async () => {
  const s = setup(); alter(s); assert.deepEqual(await s.resolve(), { status: 'unavailable', reason: 'storage_unavailable' });
});

for (const [name, patch] of [
  ['long expiry', { exp: Math.floor(Date.now() / 1000) + 3600 }],
  ['expired', { exp: 1 }], ['wrong object', { url: 'other/object' }],
  ['service-role token', { role: 'service_role' }], ['upload token', { scope: 'upload' }],
]) test(`${name} signed URL rejected`, async () => {
  const s = setup(); s.storage.sign = async paths => paths.map(path => ({ path, signedUrl: signedUrl(path, patch), error: null }));
  assert.equal((await s.resolve()).reason, 'storage_unavailable');
});
test('arbitrary signing host/key and extra signing rows rejected', async () => {
  for (const mutate of [url => url.replace(origin, 'https://evil.example'), url => url.replace('/revisions/', '/elsewhere/'),
    url => `${url}&apikey=SECRET_SERVICE_KEY`]) {
    const s = setup(); s.storage.sign = async paths => paths.map(path => ({ path, signedUrl: mutate(signedUrl(path)), error: null }));
    assert.equal((await s.resolve()).status, 'unavailable');
  }
  const s = setup(); const sign = s.storage.sign;
  s.storage.sign = async (...args) => [...await sign(...args), { path: 'extra', signedUrl: signedUrl('extra'), error: null }];
  assert.equal((await s.resolve()).status, 'unavailable');
});

test('Golf seam authorizes Group/slate first, checks slate player, and uses explicit registry links', async () => {
  const s = setup(), result = await s.deliver(); assert.equal(result.status, 'available');
  assert.deepEqual(s.calls[0], ['authorize', 3]);
  assert.ok(s.calls.some(c => c[0] === 'eq' && c[1] === 'golf_event_players' && c[2] === 'slate_id' && c[3] === 3));
  assert.ok(s.calls.some(c => c[0] === 'limit' && c[1] === 'shotcast_prepared_revisions' && c[2] === 2));
  assert.ok(s.calls.some(c => c[0] === 'limit' && c[1] === 'shotcast_revision_assets' && c[2] === 94));
});
for (const [name, alter] of [
  ['denied membership', s => { s.authorization.ok = false; }],
  ['internal authorization', s => { s.authorization.mode = 'internal'; }],
  ['wrong authorized slate', s => { s.authorization.target.id = 9; }],
  ['wrong sport', s => { s.authorization.target.sportKey = 'nba'; }],
  ['wrong league', s => { s.authorization.target.leagueId = 'other'; }],
  ['player outside slate', s => { s.rows.golf_event_players = []; }],
  ['no event identity link', s => { s.rows.shotcast_events[0].identity_link_source = null; }],
  ['no player identity link', s => { s.rows.shotcast_player_round_courses[0].golf_player_id = null; }],
  ['ambiguous player identity link', s => { s.rows.shotcast_player_round_courses.push(s.rows.shotcast_player_round_courses[0]); }],
  ['client supplied bucket', s => { s.golfInput.bucket = 'avatars'; }],
  ['client supplied key', s => { s.golfInput.objectPath = 'secret'; }],
]) test(`Golf ${name} cannot sign`, async () => {
  const s = setup(); alter(s); assert.equal((await s.deliver()).status, 'unavailable');
  assert.equal(s.calls.some(c => c[0] === 'bucket'), false);
});
test('database failures never expose credentials through Golf seam', async () => {
  for (const table of ['slates', 'golf_event_players', 'shotcast_events', 'shotcast_player_round_courses',
    'shotcast_prepared_revisions', 'shotcast_revision_assets', 'shotcast_asset_delivery_manifests']) {
    const s = setup(); s.failTable(table); const result = await s.deliver();
    assert.equal(result.status, 'unavailable'); assert.equal(JSON.stringify(result).includes('SECRET_SERVICE_KEY'), false);
  }
});
test('oversized registry assets fail closed rather than truncating into validity', async () => {
  const s = setup(); s.rows.shotcast_revision_assets = Array(94).fill(s.rows.shotcast_revision_assets[0]);
  assert.equal((await s.deliver()).status, 'unavailable'); assert.equal(s.calls.some(c => c[0] === 'bucket'), false);
});
test('successful response omits unrelated server record credentials and provider provenance', async () => {
  const s = setup(); s.record.serviceRoleKey = 'SECRET_SERVICE_KEY';
  const result = await s.deliver(); assert.equal(result.status, 'available');
  assert.equal(/SECRET_SERVICE_KEY|source_url|localPath|validation_proof/.test(JSON.stringify(result)), false);
});
test('read path has no provider acquisition, registry mutation, filesystem reads, or client imports', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected acquisition'); });
  const s = setup(), before = structuredClone(s.rows);
  assert.equal((await s.deliver()).status, 'available'); assert.deepEqual(s.rows, before); assert.equal(fetchMock.mock.callCount(), 0);
  for (const file of ['lib/shotcast/storage/preparedAssets.server.ts', 'lib/golf/preparedShotcastAssets.server.ts']) {
    const code = fs.readFileSync(file, 'utf8'); assert.ok(code.startsWith('import "server-only";'));
    // The fake DB has only read methods; attempted mutations cannot succeed.
    assert.equal(/node:fs|\.upload\(|\.insert\(|getPublicUrl|SUPABASE_SERVICE_ROLE_KEY/.test(code), false);
  }
});
test('separate upload-time byte integrity verifier checks hash and size', () => {
  const bytes = Buffer.from('fake approved asset');
  const asset = { sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
  assert.equal(api.verifyPreparedShotcastAssetBytes(asset, bytes), true);
  assert.equal(api.verifyPreparedShotcastAssetBytes(asset, Buffer.from('changed')), false);
  assert.equal(api.verifyPreparedShotcastAssetBytes({ ...asset, sizeBytes: 0 }, bytes), false);
  assert.equal(api.verifyPreparedShotcastAssetBytes({ ...asset, sha256: 'a'.repeat(64) }, bytes), false);
});
test('migration is private, denies browser objects/listing, and does not seed registry or assets', () => {
  const sql = fs.readFileSync('supabase/migrations/20261008000100_shotcast_prepared_asset_delivery.sql', 'utf8');
  assert.match(sql, /'shotcast-prepared-private', 'shotcast-prepared-private', false/);
  assert.equal((sql.match(/as restrictive for all to anon, authenticated/g) ?? []).length, 2);
  assert.match(sql, /enable row level security/); assert.match(sql, /r\.state = 'validated' and r\.is_current/);
  assert.equal(/insert into public\.|update storage\.|delete from/i.test(sql), false);
});
