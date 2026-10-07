/* eslint-disable @typescript-eslint/no-require-imports */
/* Fresh Unix-socket PostgreSQL only: never loads .env or a database URL. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, before, after } = require('node:test');
const bin = process.env.FAVORITES_TEST_PG_BIN;
let directory, socket, env;
const run = (name, args) => execFileSync(path.join(bin, name), args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sql = value => run('psql', ['-X', '-h', socket, '-p', '55440', '-U', 'favorites_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', value]).trim();
const migration = file => fs.readFileSync(path.resolve('supabase/migrations', file), 'utf8');
const user = '30000000-0000-0000-0000-000000000001';
const other = '30000000-0000-0000-0000-000000000002';
const skip = !bin && 'Set FAVORITES_TEST_PG_BIN to isolated PostgreSQL binaries';
before(() => {
  if (!bin) return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nba-favorites-pg-'));
  socket = path.join(directory, 'socket'); fs.mkdirSync(socket);
  env = { ...process.env, PGHOST: socket, PGPORT: '55440', PGUSER: 'favorites_test', PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable',
    LD_LIBRARY_PATH: [path.resolve(bin, '../../../x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  run('initdb', ['-D', path.join(directory, 'data'), '-L', path.resolve(bin, '../../../../share/postgresql/15'), '--auth=trust', '--username=favorites_test', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'postgres.log'), '-o', `-k ${socket} -p 55440 -c listen_addresses='' -c jit=off`, '-w', 'start']);
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key);
    insert into app_users values('${user}'),('${other}');`);
  sql(migration('20260908_ncaa_favorite_teams.sql'));
  sql(migration('20260909_live_score_favorite_teams.sql'));
  sql(`grant usage on schema public to anon,authenticated,service_role;
    grant all on all tables in schema public to service_role;
    insert into live_score_favorite_teams values('${user}','nfl','9','2026-09-09T00:00:00Z');
    insert into ncaa_favorite_teams values('${user}','194','2026-09-08T00:00:00Z');`);
});
after(() => {
  if (!directory) return;
  try { if (fs.existsSync(path.join(directory, 'data/postmaster.pid'))) run('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
const security = () => sql(`select jsonb_build_object(
  'rls',(select relrowsecurity from pg_class where oid='live_score_favorite_teams'::regclass),
  'acl',(select relacl from pg_class where oid='live_score_favorite_teams'::regclass),
  'policies',(select jsonb_agg(row_to_json(p)) from pg_policies p where tablename='live_score_favorite_teams'),
  'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where tablename='live_score_favorite_teams'),
  'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname)
    from pg_constraint where conrelid='live_score_favorite_teams'::regclass and conname<>'live_score_favorite_teams_sport_check'),
  'ncaa',(select jsonb_agg(row_to_json(n)) from ncaa_favorite_teams n));`);
const rejected = (statement, message) => assert.throws(() => sql(statement), error => error.stderr.includes(message));
test('forward migration widens only the actual sport CHECK; preserves NFL/NCAA rows, constraints, indexes and access controls', { skip }, () => {
  assert.equal(sql("select conname from pg_constraint where conrelid='live_score_favorite_teams'::regclass and conname='live_score_favorite_teams_sport_check'"), 'live_score_favorite_teams_sport_check');
  rejected(`insert into live_score_favorite_teams(user_id,sport,espn_team_id) values('${user}','nba','9')`, 'live_score_favorite_teams_sport_check');
  const beforeSecurity = security();
  const nfl = sql("select row_to_json(f) from live_score_favorite_teams f where sport='nfl'");
  sql(migration('20261006000200_nba_live_score_favorites.sql'));
  assert.equal(security(), beforeSecurity);
  assert.equal(sql("select row_to_json(f) from live_score_favorite_teams f where sport='nfl'"), nfl);
  const definition = sql("select pg_get_constraintdef(oid) from pg_constraint where conname='live_score_favorite_teams_sport_check'");
  assert.match(definition, /'nfl'/); assert.match(definition, /'nba'/);
  sql(`set role service_role;
    insert into live_score_favorite_teams(user_id,sport,espn_team_id) values('${user}','nfl','10'),('${user}','nba','9'),('${other}','nba','9');`);
  rejected(`insert into live_score_favorite_teams(user_id,sport,espn_team_id) values('${user}','golf','9')`, 'live_score_favorite_teams_sport_check');
  rejected(`insert into live_score_favorite_teams(user_id,sport,espn_team_id) values('${user}','nba','9')`, 'live_score_favorite_teams_pkey');
  sql(`set role service_role; insert into live_score_favorite_teams(user_id,sport,espn_team_id) values('${user}','nba','9') on conflict(user_id,sport,espn_team_id) do nothing`);
  assert.equal(sql("select count(*) from live_score_favorite_teams"), '4');
  for (const role of ['anon', 'authenticated']) for (const statement of [
    'select * from live_score_favorite_teams',
    `insert into live_score_favorite_teams(user_id,sport,espn_team_id) values('${user}','nba','11')`,
    "delete from live_score_favorite_teams where sport='nba'",
  ]) rejected(`set role ${role}; ${statement}`, 'permission denied');
  // With SELECT granted only in this fixture, RLS still exposes no rows to client roles.
  sql('grant select on live_score_favorite_teams to authenticated');
  assert.equal(sql('set role authenticated; select count(*) from live_score_favorite_teams'), '0');
  sql('revoke select on live_score_favorite_teams from authenticated');
  sql(`set role service_role; delete from live_score_favorite_teams where user_id='${user}' and sport='nba' and espn_team_id='9'`);
  assert.equal(sql(`select count(*) from live_score_favorite_teams where user_id='${other}' and sport='nba'`), '1');
  assert.equal(sql("select count(*) from live_score_favorite_teams where sport='nfl'"), '2');
  assert.equal(security(), beforeSecurity);
});
