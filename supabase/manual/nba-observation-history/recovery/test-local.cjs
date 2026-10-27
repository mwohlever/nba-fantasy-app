// Opt-in, socket-only disposable cluster. Never reads .env or a database URL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const bin = process.env.NBA_OBSERVATION_PG_BIN;
const here = __dirname;
const repo = path.resolve(here, '../../../..');

test('local archive restore, immutable cleanup, restart and rollback', { skip: !bin }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nba-recovery-test-'));
  const socket = path.join(dir, 'socket'); fs.mkdirSync(socket);
  const env = { ...process.env, PGHOST: socket, PGHOSTADDR: '', PGPORT: '55449',
    PGUSER: 'nba_test', PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable', PGOPTIONS: '',
    LD_LIBRARY_PATH: [path.resolve(bin, '../../../x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  delete env.PGSERVICE; delete env.PGSERVICEFILE;
  const run = (cmd, args, input) => execFileSync(path.join(bin, cmd), args,
    { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const sql = (input, db = 'postgres') => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-d', db, '-f', '-'], input).trim();
  const template = fs.readFileSync(path.join(here, 'batch-template.sql'), 'utf8');
  const render = (keys, approval = 'ARCHIVE_RESTORED_AND_APPROVED_1502203') => template
    .replace('__APPROVAL__', approval)
    .replace('__PLAN__', JSON.stringify({ cutoff: 1502203, current_count: 3, keys }));
  let started = false;
  try {
    const version = run('postgres', ['--version']).match(/PostgreSQL\) (\d+)/)[1];
    run('initdb', ['-D', path.join(dir, 'data'), '-L', path.resolve(bin, `../../../../share/postgresql/${version}`),
      '--auth=trust', '--username=nba_test', '--no-locale', '--encoding=UTF8']);
    run('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'pg.log'), '-o',
      `-k ${socket} -p 55449 -c listen_addresses='' -c jit=off`, '-w', 'start']); started = true;
    sql('create role anon; create role authenticated; create role service_role bypassrls; create table players(id bigint primary key); insert into players values(7);');
    for (const file of ['20260925000100_nba_projection_observation_foundation.sql',
      '20260925000200_nba_current_observations.sql', '20261027000100_nba_observation_semantic_append.sql']) {
      sql(fs.readFileSync(path.join(repo, 'supabase/migrations', file), 'utf8'));
    }
    sql(`INSERT INTO public.nba_player_game_observation_versions(
      provider,provider_player_id,provider_event_id,local_player_id,season,phase,game_at,
      completed_at,minutes,points,rebounds,assists,steals,blocks,turnovers,source_url,
      provider_fetched_at,provider_known_at,normalization_version,observation_hash)
      SELECT 'espn','42','40100'||event,7,2026,'regular','2026-01-01T00:00Z',NULL,
        30,10,2,1,0,0,1,'https://example.test','2026-09-01T00:00Z'::timestamptz + day * interval '1 day',
        '2026-09-01T00:00Z'::timestamptz + day * interval '1 day','v1',
        md5(event||':'||day)||md5(event||':'||day)
      FROM generate_series(1,3) event CROSS JOIN generate_series(0,43) day ORDER BY event,day;`);
    const manifest = sql(fs.readFileSync(path.join(here, 'manifest-local.sql'), 'utf8'));
    const keys = manifest.split('\n').map(JSON.parse);
    const originalRows = JSON.parse(sql('select json_agg(v order by id) from nba_player_game_observation_versions v'));
    assert.equal(keys.length, 3); assert.ok(keys.every(k => k.eligible));
    const baseline = sql('select json_agg(c order by provider_event_id) from nba_player_game_current_observations c');
    assert.throws(() => sql(render(keys.slice(0, 1), 'REVIEW_ONLY')), /Command failed/);
    const dump = path.join(dir, 'observations.dump');
    run('pg_dump', ['-Fc', '-f', dump, '-t', 'public.nba_player_game_observation_versions',
      '-t', 'public.nba_player_game_current_observations', 'postgres']);
    const metadata = JSON.parse(sql(fs.readFileSync(path.join(here, 'capture-metadata.sql'), 'utf8')));
    metadata.watermark = 1502203; metadata.current_count = 34386;
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
    execFileSync('python3', [path.join(here, 'prepare.py'), 'bootstrap', path.join(dir, 'metadata.json'), path.join(dir, 'bootstrap.sql')]);
    sql('create database rehearsal');
    for (const section of ['pre-data','data']) run('pg_restore', ['--exit-on-error','--no-owner','--no-privileges',
      `--section=${section}`, '-d', 'rehearsal', dump]);
    sql(fs.readFileSync(path.join(dir, 'bootstrap.sql'), 'utf8'), 'rehearsal');
    run('pg_restore', ['--exit-on-error','--no-owner','--no-privileges','--section=post-data','-d','rehearsal',dump]);
    assert.equal(sql('select count(*) from nba_player_game_observation_versions','rehearsal'), '132');
    assert.equal(sql('select json_agg(c order by provider_event_id) from nba_player_game_current_observations c','rehearsal'), baseline);
    sql(render(keys.slice(0,2)));
    assert.equal(sql('select count(*) from nba_player_game_observation_versions'), '48');
    assert.equal(sql('select json_agg(c order by provider_event_id) from nba_player_game_current_observations c'), baseline);
    const restart = sql(render(keys.slice(0,2))); assert.match(restart, /0\|84/);
    const tampered = JSON.parse(JSON.stringify(keys[2])); tampered.observations[10].observation_hash = '0'.repeat(64);
    assert.throws(() => sql(render([tampered])), /Command failed/);
    assert.equal(sql('select count(*) from nba_player_game_observation_versions'), '48');
    assert.equal(sql("select string_agg(tgenabled::text,',' order by tgname) from pg_trigger where tgrelid='nba_player_game_observation_versions'::regclass and not tgisinternal"), 'O,O');
    const broken = JSON.parse(JSON.stringify(keys[2])); broken.last.id = broken.first.id;
    assert.throws(() => sql(render([broken])), /Command failed/);
    const failing = render([keys[2]]).replace('IF deleted <> cardinality(delete_ids)', 'IF deleted >= 0');
    assert.throws(() => sql(failing), /Command failed/);
    assert.equal(sql('select count(*) from nba_player_game_observation_versions'), '48');
    assert.equal(sql("select tgenabled from pg_trigger where tgrelid='nba_player_game_observation_versions'::regclass and tgname='nba_observation_versions_immutable'"), 'O');
    assert.throws(() => sql('delete from nba_player_game_observation_versions where id=1'), /Command failed/);
    sql(render([keys[2]]));
    assert.equal(sql('select count(*) from nba_player_game_observation_versions'), '6');
    assert.equal(sql('select json_agg(c order by provider_event_id) from nba_player_game_current_observations c'), baseline);
    sql(fs.readFileSync(path.join(here, 'verify.sql'), 'utf8'));
    const ts = require(path.join(repo, 'node_modules/typescript'));
    require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText, filename);
    const { nbaObservationFromRecord } = require(path.join(repo, 'lib/analytics/nba/projectionInfrastructure.ts'));
    const { observationsAsOf } = require(path.join(repo, 'lib/analytics/nba/history.ts'));
    const compactRows = JSON.parse(sql('select json_agg(v order by id) from nba_player_game_observation_versions v'));
    const selection = (rows, time) => {
      const result = observationsAsOf(rows.map(nbaObservationFromRecord), time,
        { provider: 'espn', providerPlayerId: '42', excludeEventIds: [] },
        { availability: 'recorded', phases: ['regular'], seasons: [2026] });
      return { excluded: result.excluded, observations: result.observations.map(x => ({
        eventId: x.eventId, gameAt: x.gameAt, completedAt: x.completedAt, season: x.season,
        team: x.team, opponent: x.opponent, minutes: x.minutes, stats: x.stats, identity: x.identity,
      })) };
    };
    for (const time of new Set(originalRows.map(r => Date.parse(r.provider_known_at)))) {
      for (const offset of [-1,0,1]) {
        const cutoff = new Date(time + offset).toISOString();
        assert.deepEqual(selection(compactRows, cutoff), selection(originalRows, cutoff), cutoff);
      }
    }
    const tableOid = sql("select 'public.nba_player_game_observation_versions'::regclass::oid");
    sql('VACUUM (ANALYZE, INDEX_CLEANUP ON, TRUNCATE FALSE, PARALLEL 0) public.nba_player_game_observation_versions;');
    for (const command of sql(fs.readFileSync(path.join(here, 'reindex-commands.sql'), 'utf8')).split('\n')) {
      sql(command.split('|')[0]);
    }
    sql('VACUUM (FULL, ANALYZE) public.nba_player_game_observation_versions;');
    assert.equal(sql("select 'public.nba_player_game_observation_versions'::regclass::oid"), tableOid);
    assert.equal(sql('select json_agg(c order by provider_event_id) from nba_player_game_current_observations c'), baseline);
    assert.equal(sql("select string_agg(tgenabled::text,',' order by tgname) from pg_trigger where tgrelid='nba_player_game_observation_versions'::regclass and not tgisinternal"), 'O,O');
    const removedRows = originalRows.filter(r => !compactRows.some(k => k.id === r.id));
    const recovery = fs.readFileSync(path.join(here, 'restore-template.sql'), 'utf8')
      .replace('__ROWS__', JSON.stringify(removedRows))
      .replace('__APPROVAL__', 'ARCHIVE_RESTORED_AND_APPROVED_1502203');
    sql(recovery);
    assert.deepEqual(JSON.parse(sql('select json_agg(v order by id) from nba_player_game_observation_versions v')), originalRows);
    assert.equal(sql('select json_agg(c order by provider_event_id) from nba_player_game_current_observations c'), baseline);
    assert.match(sql(recovery), /^0$/);
    console.log('132-row archive restored; 126 candidates removed; restart/tamper/rollback/current checks passed');
  } finally {
    if (started) run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
