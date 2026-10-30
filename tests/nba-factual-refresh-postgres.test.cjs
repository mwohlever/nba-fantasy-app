/* eslint-disable @typescript-eslint/no-require-imports */
// ONLY a new isolated Unix-socket PostgreSQL cluster. No .env or production clients.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { test, before, beforeEach, after } = require('node:test'), assert = require('node:assert/strict');
const { input, build, pointsChange, gp, uuid } = require('./helpers/nba-refresh-fixtures.cjs');
const bin = process.env.NBA_REFRESH_PG_BIN;
const pgtest = (name, fn) => test(name, { skip: !bin && 'Set NBA_REFRESH_PG_BIN to isolated PostgreSQL binaries' }, fn);
let dir, socket, env;
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${q(JSON.stringify(value))}::jsonb`;
const file = 'supabase/manual/player-center/factual-refresh-v1.sql';
const installation = fs.readFileSync(file, 'utf8').replace("= 'REVIEW_ONLY'", "= 'INSTALL_NBA_FACTUAL_REFRESH_V1'");
function tool(name, args, text) { return execFileSync(path.join(bin, name), args, { env, encoding: 'utf8', input: text, stdio: ['pipe', 'pipe', 'pipe'] }); }
const args = () => ['-X', '-q', '-At', '-h', socket, '-p', '55449', '-U', 'refresh_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'];
const sql = text => tool('psql', args(), text).trim();
function publish(value, extra = []) { return `set role service_role;select public.publish_player_center_nba_refresh(${q(value.runId)}::uuid,${value.season},${q(value.asOf)}::timestamptz,${json([build(value), ...extra])});`; }
const count = () => Number(sql('select count(*) from nba_player_game_observation_versions'));
const current = () => sql('select md5(string_agg(to_jsonb(c)::text,\'\' order by version_id)) from nba_player_game_current_observations c');
before(() => {
  if (!bin) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nba-factual-refresh-')); socket = path.join(dir, 'socket'); fs.mkdirSync(socket);
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !/SUPABASE|INGEST_SECRET/.test(key)));
  Object.assign(env, { PGHOST: socket, PGHOSTADDR: '', PGPORT: '55449', PGUSER: 'refresh_test', PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable',
    LD_LIBRARY_PATH: [path.resolve(bin, '../../../x86_64-linux-gnu'), env.LD_LIBRARY_PATH].filter(Boolean).join(':') });
  const major = tool('postgres', ['--version']).match(/PostgreSQL\) (\d+)/)[1];
  tool('initdb', ['-D', path.join(dir, 'data'), '-L', path.resolve(bin, '../../../../share/postgresql', major), '--auth=trust', '--username=refresh_test', '--no-locale', '--encoding=UTF8']);
  tool('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'postgres.log'), '-o', `-k ${socket} -p 55449 -c listen_addresses='' -c jit=off`, '-w', 'start']);
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create table players(id bigint primary key,name text,nba_player_id bigint,is_active boolean);
    create table players_nfl(id bigint primary key);
    insert into players values(6,'LeBron James',2544,true),(7,'Unresolved',999,true);`);
  for (const name of ['20260925000100_nba_projection_observation_foundation.sql', '20260925000200_nba_current_observations.sql', '20261027000100_nba_observation_semantic_append.sql']) sql(fs.readFileSync('supabase/migrations/' + name, 'utf8'));
  assert.throws(() => sql(fs.readFileSync(file, 'utf8')), /not approved/);
  sql(installation);
  sql("insert into nba_player_provider_identities values('espn','1966',6,'LeBron James','resolved','reviewed_provider_evidence','Exact reviewed native 2544',true)");
});
beforeEach(() => { if (bin) sql('truncate player_center_nba_refresh_status,player_center_season_cache,nba_player_game_current_observations,nba_player_game_observation_versions restart identity;'); });
after(() => { if (!dir) return; try { if (fs.existsSync(path.join(dir, 'data/postmaster.pid'))) tool('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop']); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });

pgtest('manual installation is guarded/idempotent; public roles cannot publish or write caches', () => {
  sql(installation);
  assert.equal(sql("select has_function_privilege('service_role','publish_player_center_nba_refresh(uuid,integer,timestamptz,jsonb)','execute')"), 't');
  for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_function_privilege('${role}','publish_player_center_nba_refresh(uuid,integer,timestamptz,jsonb)','execute')`), 'f');
  assert.equal(sql("select has_table_privilege('service_role','player_center_season_cache','insert')"), 'f');
  assert.equal(sql("select has_table_privilege('service_role','player_center_nba_refresh_status','update')"), 'f');
});

const appendMetadata = () => JSON.parse(sql("select json_build_object('source',prosrc,'acl',proacl,'owner',proowner,'definer',prosecdef,'settings',proconfig) from pg_proc where oid='public.append_nba_projection_observations(jsonb)'::regprocedure"));
const appendDefinition = source => `create or replace function public.append_nba_projection_observations(observations jsonb) returns integer language plpgsql security definer set search_path=pg_catalog,public as $append_source$${source}$append_source$;`;
for (const ending of ['LF', 'CRLF']) {
  pgtest(`${ending} approved RPC passes installation and health without changing source, permissions or correction history`, () => {
    const original = appendMetadata();
    try {
      const source = original.source.replace(/\r\n/g, '\n').replace(/\n/g, ending === 'CRLF' ? '\r\n' : '\n');
      sql(appendDefinition(source));
      const before = appendMetadata();
      assert.deepEqual(before, { ...original, source });
      assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.append_nba_projection_observations(jsonb)'::regprocedure"),
        ending === 'CRLF' ? '94ebfcc90da6cea8a06735eff4f7de08' : '9308a04b52fecc6993b7730490cf686a');
      sql(installation);
      const health = JSON.parse(sql('select public.player_center_nba_refresh_health(false)'));
      assert.equal(health.append_source_hash, '9308a04b52fecc6993b7730490cf686a');
      assert.equal(health.schema_ok, true);
      assert.deepEqual(appendMetadata(), before, 'Fingerprint normalization must not rewrite the append RPC or its privileges');
      const value = input(1), expected = build(value).observations.map(row => row.observation_hash);
      assert.equal(JSON.parse(sql(publish(value))).appended, 2);
      const hashes = () => JSON.parse(sql('select json_agg(observation_hash order by id) from nba_player_game_observation_versions'));
      assert.deepEqual(hashes(), expected, 'Input observation hashes remain unchanged');
      const checksum = current();
      assert.equal(JSON.parse(sql(publish(input(2)))).appended, 0);
      assert.equal(current(), checksum);
      assert.deepEqual(hashes(), expected);
      assert.equal(JSON.parse(sql(publish(pointsChange(input(3))))).appended, 1);
      assert.equal(JSON.parse(sql(publish(input(4)))).appended, 1);
      assert.equal(count(), 4);
      assert.deepEqual(hashes().slice(0, 2), expected, 'Corrections and A-B-A reversals preserve original history');
      assert.deepEqual(appendMetadata(), before);
    } finally { sql(appendDefinition(original.source)); }
  });
  pgtest(`${ending} modified RPC fails installation, health and publication; other whitespace is not ignored`, () => {
    const original = appendMetadata(), source = original.source.replace(/\r\n/g, '\n');
    const changed = source.replace('incoming.provider_fetched_at >= current_row.provider_fetched_at', 'incoming.provider_fetched_at > current_row.provider_fetched_at');
    assert.notEqual(changed, source);
    try {
      for (const body of [changed, source + ' ']) {
        sql(appendDefinition(body.replace(/\n/g, ending === 'CRLF' ? '\r\n' : '\n')));
        const before = appendMetadata();
        assert.throws(() => sql(installation), /Reviewed semantic append RPC changed/);
        const health = JSON.parse(sql('select public.player_center_nba_refresh_health(false)'));
        assert.notEqual(health.append_source_hash, '9308a04b52fecc6993b7730490cf686a');
        assert.equal(health.schema_ok, false);
        assert.throws(() => sql(publish(input(1))), /integrity gate failed/);
        assert.equal(count(), 0);
        assert.equal(sql('select count(*) from player_center_season_cache'), '0');
        assert.equal(sql('select count(*) from player_center_nba_refresh_status'), '0');
        assert.deepEqual(appendMetadata(), before);
      }
    } finally { sql(appendDefinition(original.source)); }
  });
}

pgtest('repeat checks advance cache/status but append zero versions and preserve current rows', () => {
  assert.equal(JSON.parse(sql(publish(input(1)))).appended, 2); const checksum = current();
  const before = sql('select checked_at from player_center_season_cache'), gamesBefore=sql('select games from player_center_season_cache');
  const repeated = JSON.parse(sql(publish(input(2)))); assert.equal(repeated.accepted, 2); assert.equal(repeated.appended, 0);
  assert.equal(count(), 2); assert.equal(current(), checksum); assert.notEqual(sql('select checked_at from player_center_season_cache'), before);
  assert.equal(sql('select games from player_center_season_cache'),gamesBefore,'Unchanged per-game JSON must not be rewritten just to advance fetch clocks');
  assert.equal(sql("select count(*) from pg_trigger where tgrelid='nba_player_game_observation_versions'::regclass and not tgisinternal and tgenabled='O'"), '2');
});
pgtest('real statistical corrections and A-B-A reversals append while keeping all earlier payloads', () => {
  sql(publish(input(1))); assert.equal(JSON.parse(sql(publish(pointsChange(input(2))))).appended, 1);
  assert.equal(JSON.parse(sql(publish(input(3)))).appended, 1); assert.equal(count(), 4);
  assert.equal(sql("select count(*) from nba_player_game_current_observations c left join nba_player_game_observation_versions v on v.id=c.version_id where v.id is null or (to_jsonb(c)-'version_id') is distinct from (to_jsonb(v)-'id')"), '0');
});
pgtest('failed acquisition preserves last successful cache/check; partial facts cannot certify coverage', () => {
  sql(publish(input(1))); const before = sql('select row_to_json(c) from player_center_season_cache c');
  const failed = input(2); failed.log = { fetchedAt: failed.attemptedAt, error: 'provider_http_503' };
  sql(publish(failed)); assert.equal(sql('select row_to_json(c) from player_center_season_cache c'), before);
  assert.equal(sql('select outcome from player_center_nba_refresh_status'), 'acquisition_failed'); assert.equal(count(), 2);
  sql(publish(gp(input(3), 3))); assert.equal(sql('select complete from player_center_season_cache'), 'f');
  assert.equal(sql('select expected_games from player_center_season_cache'), '3'); assert.equal(count(), 2);
  const failedAt=sql('select last_failure_at from player_center_nba_refresh_status');
  sql(publish(input(4)));assert.equal(sql('select last_failure_at from player_center_nba_refresh_status'),failedAt);
  assert.equal(sql('select outcome from player_center_nba_refresh_status'),'verified_data');
});
pgtest('explicit zero is publishable without observations; unknown no-data is a failure', () => {
  const value = gp(input(1), 0); value.log.payload = { filters: [{ name: 'league', value: 'nba' }] };
  sql(publish(value)); assert.equal(count(), 0); assert.equal(sql('select complete from player_center_season_cache'), 't');
  assert.equal(sql('select outcome from player_center_nba_refresh_status'), 'verified_zero_appearances');
  const unknown = input(2); unknown.log.payload = value.log.payload; unknown.summary.payload.categories = [];
  sql(publish(unknown)); assert.equal(sql('select outcome from player_center_nba_refresh_status'), 'acquisition_failed');
  assert.equal(count(), 0);
});
pgtest('cache failure in a later player rolls back the entire publication transaction', () => {
  sql(publish(input(1))); const checksum = current();
  const invalid = build(input(2)); invalid.player_id = 7; invalid.native_player_id = '999'; invalid.provider_player_id = null;
  assert.throws(() => sql(publish(pointsChange(input(2)), [invalid])), /Identity drift|Native catalog drift/);
  assert.equal(count(), 2); assert.equal(current(), checksum); assert.equal(sql('select count(*) from player_center_nba_refresh_status'), '1');
});
pgtest('stale runs, changed replays, bad cache facts and identity drift fail closed', () => {
  sql(publish(input(3)));
  assert.throws(() => sql(publish(input(1))), /Stale\/conflicting/);
  const changed = pointsChange(input(3)); assert.throws(() => sql(publish(changed)), /Changed replay/);
  const bad = build(input(4)); bad.cache.games[0].stats.points += 1;
  assert.throws(() => sql(`set role service_role;select publish_player_center_nba_refresh(${q(uuid(4))},2027,${q(input(4).asOf)},${json([bad])})`), /facts differ/);
  assert.equal(count(), 2);
  const drift = input(4); drift.player.nativePlayerId = '999'; assert.throws(() => sql(publish(drift)), /Identity drift|Native catalog drift/);
});
pgtest('exact and concurrent replay recognizes committed receipts without extra appends', async () => {
  const value = input(1), text = publish(value);
  const commands = [0, 1].map(() => new Promise((resolve, reject) => {
    const child = execFile(path.join(bin, 'psql'), args(), { env, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout.trim())));
    child.stdin.end(text);
  }));
  const receipts = await Promise.all(commands);
  assert.equal(receipts.reduce((s, r) => s + r.appended, 0), 2); assert.equal(count(), 2);
  assert.equal(JSON.parse(sql(text)).replayed_players, 1);
});
pgtest('unresolved players are explicit status rows and are never mapped or made inactive', () => {
  const v = input(1); v.player = { ...v.player, playerId: 7, nativePlayerId: '999', providerPlayerId: null, identity: 'unresolved' };
  sql(publish(v)); assert.equal(sql('select outcome from player_center_nba_refresh_status'), 'blocked_identity');
  assert.equal(sql('select is_active from players where id=7'), 't'); assert.equal(sql('select count(*) from nba_player_provider_identities'), '1');
});
pgtest('new mapping after a blocked cohort snapshot refuses stale blocked publication',()=>{
  const v=input(1);v.player={...v.player,playerId:7,nativePlayerId:'999',providerPlayerId:null,identity:'unresolved'};
  assert.throws(()=>sql("begin;insert into nba_player_provider_identities(provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked) values('espn','7777',7,'Reviewed new claim','resolved','reviewed_provider_evidence','Fresh exact proof',true);"+publish(v)),/Blocked identity changed/);
  assert.equal(sql('select count(*) from nba_player_provider_identities'),'1');
});
pgtest('retrospective-to-recorded availability transitions remain versioned once, with original evidence intact',()=>{
  const records=build(input(1)).observations.map(row=>({...row,provider_known_at:null}));
  sql(`set role service_role;select append_nba_projection_observations(${json(records)})`);
  assert.equal(JSON.parse(sql(publish(input(2)))).appended,2);
  assert.equal(JSON.parse(sql(publish(input(3)))).appended,0);
  assert.equal(count(),4);assert.equal(sql('select count(*) from nba_player_game_observation_versions where provider_known_at is null'),'2');
});

pgtest('normalizer/source labels alone do not create versions; malformed/future cache evidence rolls back', () => {
  sql(publish(input(1)));
  const value = input(2), p = build(value);
  for (const record of p.observations) { record.normalization_version = 'audit_label_only'; record.source_url += '&refresh=2'; }
  const statement = payload => `set role service_role;select publish_player_center_nba_refresh(${q(value.runId)},2027,${q(value.asOf)},${json([payload])})`;
  assert.equal(JSON.parse(sql(statement(p))).appended, 0); assert.equal(count(), 2);
  const future = input(3), bad = build(future); delete bad.cache.games[0].gameAt;
  assert.throws(() => sql(`set role service_role;select publish_player_center_nba_refresh(${q(future.runId)},2027,${q(future.asOf)},${json([bad])})`), /Invalid raw game facts|Cache game counts/);
  assert.equal(count(), 2);
});

pgtest('richer shooting corrections refresh raw cache without appending unchanged core stats',()=>{
  sql(publish(input(1)));const before=sql('select games from player_center_season_cache');
  const value=input(2),log=value.log.payload,index=log.names.indexOf('fieldGoalsMade-fieldGoalsAttempted');assert.ok(index>=0);
  const row=log.seasonTypes.find(t=>/Regular Season/i.test(t.displayName)).categories.flatMap(c=>c.events||[]).find(r=>r.eventId);
  const [made,attempts]=row.stats[index].split('-').map(Number);row.stats[index]=`${made}-${attempts+1}`;
  assert.equal(JSON.parse(sql(publish(value))).appended,0);assert.equal(count(),2);assert.notEqual(sql('select games from player_center_season_cache'),before);
});
pgtest('changed append code and disabled history triggers stop publication before any writes',()=>{
  const definition=sql("select pg_get_functiondef('append_nba_projection_observations(jsonb)'::regprocedure)");
  try {
    sql('create or replace function public.append_nba_projection_observations(observations jsonb) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$begin return 0;end$$');
    assert.equal(sql("select player_center_nba_refresh_health(false)->>'schema_ok'"),'false');
    assert.throws(()=>sql(publish(input(1))),/integrity gate failed/);assert.equal(count(),0);
  } finally {sql(definition);}
  assert.throws(()=>sql('begin;alter table nba_player_game_observation_versions disable trigger nba_observation_versions_immutable;'+publish(input(1))),/integrity gate failed/);
  assert.equal(sql("select tgenabled from pg_trigger where tgname='nba_observation_versions_immutable'"),'O');
});

pgtest('storage budget benchmark: captured 60-game history, synthetic 530-player cohort and repeated checks', () => {
  const captures = require('../data/player-center-preview/captured.json');
  const history = captures.histories.find(h => h.player.sport === 'nba' && h.season === 2026 && h.games.length >= 50);
  assert.ok(history, 'Real captured prior-season history required');
  const template = { sport: 'nba', provider: 'espn', provider_player_id: '1966', season: 2026, phase: 'regular', nba_local_player_id: 6, nfl_local_player_id: null,
    as_of: input().asOf, checked_at: input().attemptedAt, expected_games: history.games.length, observed_games: history.games.length, complete: false,
    games: history.games, season_stats: history.seasonStats ?? null, issues: ['synthetic_storage_cohort'], content_hash: 'a'.repeat(64), rollout_batch_id: uuid(1) };
  sql("insert into players select 10000+n,'Synthetic storage fixture',900000+n,true from generate_series(1,530)n");
  const start = sql('select pg_current_wal_insert_lsn()');
  sql(`insert into player_center_season_cache select r.* from generate_series(1,530)n cross join lateral jsonb_populate_record(null::player_center_season_cache,
    ${json(template)} || jsonb_build_object('nba_local_player_id',10000+n,'provider_player_id',(900000+n)::text,
    'games',(select jsonb_agg(g || jsonb_build_object('providerPlayerId',(900000+n)::text)) from jsonb_array_elements(${json(history.games)})g)))r`);
  const size = () => JSON.parse(sql("select json_build_object('rows',count(*),'logical_bytes',sum(octet_length(to_jsonb(c)::text)), 'allocated_bytes',pg_total_relation_size('player_center_season_cache'),'heap_toast_bytes',pg_table_size('player_center_season_cache'),'index_bytes',pg_indexes_size('player_center_season_cache')) from player_center_season_cache c"));
  const first = size(), metadataChecks = [], checks = [];
  for (let i=0;i<3;i++) {
    sql(`update player_center_season_cache set checked_at=clock_timestamp(),as_of=clock_timestamp(),rollout_batch_id=${q(uuid(i+2))}`);
    metadataChecks.push(size());
  }
  for (let i = 0; i < 3; i++) {
    sql(`update player_center_season_cache set checked_at=clock_timestamp(),as_of=clock_timestamp(),games=(select jsonb_agg(jsonb_set(g,'{fetchedAt}',to_jsonb(clock_timestamp()::text))) from jsonb_array_elements(games)g),rollout_batch_id=${q(uuid(i + 2))}`);
    checks.push(size());
  }
  const report = { scope: 'Isolated PostgreSQL; actual captured game shapes duplicated into a synthetic cohort. Not a measurement of 530 real player histories.',
    captured_games_per_player: history.games.length, cohort_players: 530, first, after_three_metadata_checks: metadataChecks, after_three_full_rewrites: checks,
    estimated_82_game_logical_bytes: Math.ceil(first.logical_bytes * 82 / history.games.length),
    wal_generated_bytes: Number(sql(`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(),${q(start)})`)),
    cache_allocation_limit_bytes: 64 * 1048576 };
  assert.ok(checks.every(x => x.allocated_bytes < report.cache_allocation_limit_bytes), 'Measured check churn exceeds planned allocation budget');
  if (process.env.NBA_REFRESH_STORAGE_REPORT) fs.writeFileSync(process.env.NBA_REFRESH_STORAGE_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log('CACHE_STORAGE_BENCHMARK ' + JSON.stringify(report));
});
