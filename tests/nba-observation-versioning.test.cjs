/* eslint-disable @typescript-eslint/no-require-imports */
// Real SQL runs ONLY in a newly created Unix-socket-only local PostgreSQL cluster.
// Never loads .env, a Supabase client, or a production database URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, before, after, beforeEach } = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { observationRecordFromNbaObservation, nbaObservationFromRecord } = require('../lib/analytics/nba/projectionInfrastructure.ts');
const { observationsAsOf } = require('../lib/analytics/nba/history.ts');
const { scoreNbaStats } = require('../lib/analytics/nba/scoring.ts');
const { persistNbaProjectionObservations } = require('../lib/analytics/nba/projectionIngestion.server.ts');
const bin = process.env.NBA_OBSERVATION_PG_BIN;
let directory, socket, env;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const args = () => ['-X', '-h', socket, '-p', '55448', '-U', 'nba_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-f', '-'];
const run = (name, params, input) => execFileSync(path.join(bin, name), params, { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sql = value => run('psql', args(), value).trim();
const asyncSql = value => new Promise((resolve, reject) => {
  const child = execFile(path.join(bin, 'psql'), args(), { env, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  child.stdin.end(value);
});
const appendSql = rows => `set role service_role; select public.append_nba_projection_observations(${json(rows)});`;
const append = rows => Number(sql(appendSql(rows)));
const pgtest = (name, fn) => test(name, { skip: !bin && 'Set NBA_OBSERVATION_PG_BIN to isolated PostgreSQL 15 binaries' }, fn);
const count = () => Number(sql('select count(*) from nba_player_game_observation_versions'));
const current = () => JSON.parse(sql('select row_to_json(c) from nba_player_game_current_observations c'));

function observation(day = 1, points = 10) {
  const time = `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  return { sport: 'nba', identity: { status: 'unresolved', canonicalPlayerId: null, reason: 'fixture' },
    provider: 'espn', providerPlayerId: '42', eventId: '401001', season: 2026, phase: 'regular',
    gameAt: '2026-01-01T18:00:00Z', completedAt: null, team: { providerId: '1', abbreviation: 'BOS' },
    opponent: { providerId: '2', abbreviation: 'NYK' }, homeAway: 'home', gameStatus: 'final', finalEvidence: 'explicit',
    participation: 'played', minutes: 32.5, starter: null,
    stats: { points, rebounds: 2, assists: 1, steals: 0, blocks: 0, turnovers: 1 },
    shooting: {}, provenance: { source: 'https://espn.test/gamelog', fetchedAt: time, knownAt: time }, missing: [] };
}
const record = (day = 1, points = 10) => observationRecordFromNbaObservation(observation(day, points), 7);

function repository(db) {
  const source = fs.readFileSync('lib/analytics/nba/projectionRepository.server.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabaseAdmin') return { supabaseAdmin: db };
    if (name === './projectionInfrastructure') return { nbaObservationFromRecord };
    throw new Error(`Unexpected import: ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}

test('acquisition hashes include timestamps; semantic equality must not use hash equality', () => {
  assert.notEqual(record(1).observation_hash, record(2).observation_hash);
  const changed = observation(1); changed.provenance.source += '?refetch=1';
  assert.notEqual(record(1).observation_hash, observationRecordFromNbaObservation(changed, 7).observation_hash);
  assert.notEqual(record(1).observation_hash, record(1, 11).observation_hash);
});

test('production repository uses the atomic RPC in bounded batches and surfaces failures', async () => {
  const calls = [];
  const repo = repository({ rpc: async (name, payload) => { calls.push({ name, payload }); return { error: null }; } });
  await repo.upsertNbaProjectionObservations(Array.from({ length: 401 }, () => record()));
  assert.deepEqual(calls.map(call => call.payload.observations.length), [200, 200, 1]);
  assert.ok(calls.every(call => call.name === 'append_nba_projection_observations'));
  await assert.rejects(repository({ rpc: async () => ({ error: { message: 'migration missing' } }) })
    .upsertNbaProjectionObservations([record()]), /NBA projection observation upsert failed: migration missing/);
});

before(() => {
  if (!bin) return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nba-observation-pg-'));
  socket = path.join(directory, 'socket'); fs.mkdirSync(socket);
  env = { ...process.env, PGHOST: socket, PGHOSTADDR: '', PGOPTIONS: '', PGPORT: '55448', PGUSER: 'nba_test',
    PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable',
    LD_LIBRARY_PATH: [path.resolve(bin, '../../../x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  run('initdb', ['-D', path.join(directory, 'data'), '-L', path.resolve(bin, '../../../../share/postgresql/15'),
    '--auth=trust', '--username=nba_test', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'postgres.log'), '-o',
    `-k ${socket} -p 55448 -c listen_addresses='' -c jit=off`, '-w', 'start']);
  sql('create role anon; create role authenticated; create role service_role bypassrls; create table players(id bigint primary key); insert into players values(7),(8);');
  for (const file of ['20260925000100_nba_projection_observation_foundation.sql', '20260925000200_nba_current_observations.sql']) {
    sql(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  // Seed a pre-fix row before applying the additive migration.
  const initial = record(), columns = Object.keys(initial).join(',');
  sql(`insert into nba_player_game_observation_versions(${columns}) select ${columns} from jsonb_populate_record(null::nba_player_game_observation_versions,${json(initial)});`);
  sql(fs.readFileSync('supabase/migrations/20261027000100_nba_observation_semantic_append.sql', 'utf8'));
  assert.equal(append([record(2)]), 0);
  assert.equal(count(), 1);
});
beforeEach(() => {
  if (bin) sql('truncate nba_player_game_current_observations,nba_player_game_observation_versions restart identity;');
});
after(() => {
  if (!directory) return;
  try {
    if (fs.existsSync(path.join(directory, 'data/postmaster.pid'))) run('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

pgtest('daily identical acquisitions append once, including repeated keys within one batch', async () => {
  const repo = repository({ rpc: async (_name, payload) => ({ data: append(payload.observations), error: null }) });
  await repo.upsertNbaProjectionObservations([record(1), record(2), record(3)]);
  const first = current();
  await repo.upsertNbaProjectionObservations([record(4)]);
  assert.equal(count(), 1); assert.deepEqual(current(), first);
  // PostgreSQL numeric/timestamptz equality tolerates different wire encodings.
  assert.equal(append([{ ...record(5), game_at: '2026-01-01T13:00:00-05:00', minutes: '32.500' }]), 0);
  assert.equal(append([{ ...record(6), source_url: 'https://espn.test/new-url', normalization_version: 'label-only-v2' }]), 0);
});

pgtest('43 daily acquisitions have distinct acquisition hashes but retain only one fact version', () => {
  const rows = Array.from({ length: 43 }, (_, day) => {
    const sample = observation();
    const acquired = new Date(Date.parse(sample.provenance.fetchedAt) + day * 86_400_000).toISOString();
    sample.provenance.fetchedAt = acquired; sample.provenance.knownAt = acquired;
    return observationRecordFromNbaObservation(sample, 7);
  });
  assert.equal(new Set(rows.map(row => row.observation_hash)).size, 43);
  assert.equal(append(rows), 1);
  assert.equal(count(), 1);
});

pgtest('ingestion through the production RPC preserves validation, reviewed identity and input counts', async () => {
  const writer = repository({ rpc: async (_name, payload) => ({ data: append(payload.observations), error: null }) });
  const ingestionRepository = {
    loadProviderIdentities: async () => [{ provider: 'espn', providerPlayerId: '42', playerId: 7,
      status: 'resolved', evidence: 'Reviewed fixture identity' }],
    upsertObservations: writer.upsertNbaProjectionObservations,
  };
  const invalid = observation(); invalid.stats.blocks = null;
  const live = observation(); live.gameStatus = 'in_progress';
  const unknown = observation(); unknown.providerPlayerId = '99';
  const result = await persistNbaProjectionObservations({ repository: ingestionRepository,
    observations: [observation(1), observation(2), unknown, invalid, live] });
  assert.equal(result.accepted, 3); assert.equal(result.unresolved, 1);
  assert.equal(result.skipped.length, 2);
  assert.equal(count(), 2); // Two acquisitions of player 42 produce only one version.
  assert.equal(sql("select local_player_id is null from nba_player_game_current_observations where provider_player_id='99'"), 't');
  assert.equal(sql("select local_player_id from nba_player_game_current_observations where provider_player_id='42'"), '7');
  await persistNbaProjectionObservations({ repository: ingestionRepository, observations: [observation(3, 11), observation(4, 11)] });
  assert.equal(count(), 3);
  assert.equal(sql("select points from nba_player_game_current_observations where provider_player_id='42'"), '11');
});

pgtest('A -> B -> A corrections all survive; recorded as-of values and scoring stay correct', () => {
  assert.equal(append([record(1), record(2, 11), record(3)]), 3);
  assert.equal(append([record(4)]), 0);
  assert.equal(current().points, 10); assert.equal(count(), 3);
  const rows = JSON.parse(sql('select json_agg(v order by provider_fetched_at,id) from nba_player_game_observation_versions v'));
  const history = rows.map(nbaObservationFromRecord);
  const scope = { provider: 'espn', providerPlayerId: '42', excludeEventIds: [] };
  const policy = { availability: 'recorded', phases: ['regular'] };
  const scoring = { points: 1, rebounds: 1.2, assists: 1.5, steals: 2, blocks: 2, turnovers: -1 };
  for (const [cutoff, points] of [['2026-09-02T00:00:00Z', 10], ['2026-09-03T00:00:00Z', 11], ['2026-09-04T00:00:00Z', 10]]) {
    const selected = observationsAsOf(history, cutoff, scope, policy).observations;
    assert.equal(selected.length, 1); assert.equal(selected[0].stats.points, points);
    assert.ok(Math.abs(scoreNbaStats(selected[0].stats, scoring) - (points + 2.9)) < 1e-9);
  }
});

pgtest('every stored game fact, minute/category and local identity correction appends', () => {
  const changes = { local_player_id: 8, season: 2025, phase: 'regular', game_at: '2026-01-01T18:01:00Z',
    completed_at: '2026-01-01T21:00:00Z', team_provider_id: '3', team_abbreviation: 'LAL',
    opponent_provider_id: '4', opponent_abbreviation: 'LAC', home_away: 'away', minutes: 33,
    points: 11, rebounds: 3, assists: 2, steals: 1, blocks: 1, turnovers: 2 };
  delete changes.phase; // Only regular is supported by the table constraint.
  for (const [key, value] of Object.entries(changes)) {
    sql('truncate nba_player_game_current_observations,nba_player_game_observation_versions restart identity;');
    append([record(1)]);
    assert.equal(append([{ ...record(2), [key]: value }]), 1, key);
    if (key.endsWith('_at')) assert.equal(Date.parse(current()[key]), Date.parse(value), key);
    else assert.equal(current()[key], value, key);
    assert.equal(count(), 2, key);
  }
});

pgtest('older acquisitions and explicit availability evidence remain historical; current never regresses', () => {
  append([record(3)]); const latest = current();
  assert.equal(append([record(1)]), 1);
  assert.deepEqual(current(), latest);
  assert.equal(append([{ ...record(4), provider_known_at: '2026-09-02T10:00:00Z' }]), 1);
  assert.equal(count(), 3);
});

pgtest('retrospective-to-recorded evidence is retained even when statistics match', () => {
  append([{ ...record(1), provider_known_at: null }]);
  assert.equal(append([record(2)]), 1);
  assert.equal(append([record(3)]), 0);
  assert.equal(count(), 2); assert.ok(current().provider_known_at);
});

pgtest('reacquiring the same explicit provider revision does not append; new availability evidence does', () => {
  const known = '2026-09-01T10:00:00Z';
  append([{ ...record(2), provider_known_at: known }]);
  const first = current();
  assert.equal(append([{ ...record(3), provider_known_at: known }]), 0);
  assert.deepEqual(current(), first);
  assert.equal(append([{ ...record(4), provider_known_at: '2026-09-02T10:00:00Z' }]), 1);
  assert.equal(count(), 2);
});

pgtest('null metadata compares safely and enriching a missing fact creates a version', () => {
  const sparse = { ...record(1), local_player_id: null, team_provider_id: null, team_abbreviation: null,
    opponent_provider_id: null, opponent_abbreviation: null, home_away: null };
  append([sparse]);
  assert.equal(append([{ ...sparse, provider_fetched_at: record(2).provider_fetched_at,
    provider_known_at: record(2).provider_known_at, observation_hash: record(2).observation_hash }]), 0);
  assert.equal(append([record(3)]), 1);
  assert.equal(current().local_player_id, 7);
  assert.equal(count(), 2);
});

pgtest('cleanup candidates retain run boundaries, reversals, current references and recorded as-of stats', () => {
  // Simulate old daily churn using direct inserts ONLY in this disposable cluster.
  const rows = [record(1), record(2), record(3), record(4, 11), record(5, 11), record(6, 11), record(7), record(8), record(9)];
  const columns = Object.keys(rows[0]).join(',');
  sql(`insert into nba_player_game_observation_versions(${columns}) select ${columns} from jsonb_populate_recordset(null::nba_player_game_observation_versions,${json(rows)});`);
  const query = fs.readFileSync('supabase/manual/nba-observation-history/redundant-candidates.sql', 'utf8').trim().replace(/;$/, '');
  const candidates = JSON.parse(sql(`select json_agg(q.id order by q.id) from (${query}) q`));
  assert.deepEqual(candidates, [2, 5, 8]);
  assert.ok(!candidates.includes(current().version_id));
  const all = JSON.parse(sql('select json_agg(v order by provider_fetched_at,id) from nba_player_game_observation_versions v'));
  const scope = { provider: 'espn', providerPlayerId: '42', excludeEventIds: [] };
  const policy = { availability: 'recorded', phases: ['regular'] };
  for (let day = 1; day <= 10; day++) {
    const cutoff = `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`;
    const selected = values => observationsAsOf(values.map(nbaObservationFromRecord), cutoff, scope, policy)
      .observations.map(row => ({ eventId: row.eventId, stats: row.stats, minutes: row.minutes }));
    assert.deepEqual(selected(all.filter(row => !candidates.includes(row.id))), selected(all), cutoff);
  }
  // Entire histories with retrospective/custom or tied availability are excluded.
  sql("alter table nba_player_game_observation_versions disable trigger nba_observation_versions_immutable; update nba_player_game_observation_versions set provider_known_at=null where id=1; alter table nba_player_game_observation_versions enable trigger nba_observation_versions_immutable;");
  assert.equal(sql(`select count(*) from (${query}) q`), '0');
});

pgtest('overlapping acquisitions serialize and create only one version', async () => {
  const key = "hashtextextended(jsonb_build_array('nba_observation_append','espn','42','401001')::text,0)";
  const first = asyncSql(`begin; select pg_advisory_xact_lock(${key}); ${appendSql([record(1)])} select pg_sleep(1); commit;`);
  // Wait for the first session's lock rather than assuming process startup order.
  for (let attempt = 0; attempt < 50; attempt++) {
    if (sql("select exists(select 1 from pg_locks where locktype='advisory' and granted)") === 't') break;
    await promisify(setTimeout)(10);
    assert.ok(attempt < 49, 'first acquisition obtained its lock');
  }
  const second = asyncSql(appendSql([record(2)]));
  await Promise.all([first, second]);
  assert.equal(count(), 1); assert.equal(current().points, 10);
});

pgtest('independent event/player keys are retained and a bad batch rolls back atomically', () => {
  assert.equal(append([record(1), { ...record(1), provider_event_id: '401002' }, { ...record(1), provider_player_id: '43', local_player_id: null }]), 3);
  assert.throws(() => append([record(2, 12), { ...record(2), minutes: -1 }]), /check constraint/);
  assert.equal(count(), 3);
  assert.equal(sql('select points from nba_player_game_current_observations where provider_event_id=\'401001\' and provider_player_id=\'42\''), '10');
});

pgtest('RPC is service-role-only, bounded, and does not weaken immutable history', () => {
  assert.throws(() => sql(`set role anon; select append_nba_projection_observations('[]');`), /permission denied/);
  assert.throws(() => sql(`set role authenticated; select append_nba_projection_observations('[]');`), /permission denied/);
  assert.equal(append([]), 0);
  assert.throws(() => append(Array.from({ length: 201 }, () => record())), /at most 200/);
  assert.throws(() => append({}), /must be an array/);
  append([record()]);
  assert.throws(() => sql('update nba_player_game_observation_versions set points=20'), /immutable/);
  assert.throws(() => sql('delete from nba_player_game_observation_versions'), /immutable/);
  assert.equal(sql("select count(*) from pg_trigger where tgrelid='nba_player_game_observation_versions'::regclass and not tgisinternal"), '2');
});

pgtest('review-only audit SQL executes read-only and reports consistent current observations', () => {
  append([record(1), record(2, 11), record(3)]);
  const report = sql(fs.readFileSync('supabase/manual/nba-observation-history/audit.sql', 'utf8'));
  assert.equal(report.split('\n').at(-1), '0');
  assert.equal(count(), 3);
});

pgtest('manual deployment queries distinguish suppressed polls, real corrections and old-writer churn', () => {
  const blocks = fs.readFileSync('supabase/manual/nba-observation-history/post-deployment.sql', 'utf8')
    .match(/begin read only;[\s\S]*?commit;/g);
  assert.equal(blocks.length, 4);
  append([record(1)]);
  const before = sql(blocks[0]).split('|'), watermark = Number(before[2]);
  append([record(2)]);
  const after = sql(blocks[0]).split('|');
  for (const index of [1, 2, 4, 5]) assert.equal(after[index], before[index]);
  assert.equal(sql(blocks[1]), 'f||0|0|0|0|0');
  const changes = blocks[1].replace('NULL::bigint', `${watermark}::bigint`);
  assert.equal(sql(changes), `t|${watermark}|0|0|0|0|0`);
  append([record(3, 11), record(4, 11), record(5)]);
  assert.equal(sql(changes), `t|${watermark}|2|0|2|0|0`);
  // Simulate the old writer ONLY in the local cluster: the monitor must flag it.
  const repeated = record(6), columns = Object.keys(repeated).join(',');
  sql(`insert into nba_player_game_observation_versions(${columns}) select ${columns} from jsonb_populate_record(null::nba_player_game_observation_versions,${json(repeated)});`);
  assert.equal(sql(changes), `t|${watermark}|3|0|2|0|1`);
  assert.equal(sql(blocks[2]), '1|0|0|0');
  assert.ok(sql(blocks[3]).length > 0);
});
