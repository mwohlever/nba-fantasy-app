/* eslint-disable @typescript-eslint/no-require-imports */
// Optional real PostgreSQL verification. Always creates a fresh local cluster; never accepts a database URL.
// NCAAF_TEST_PG_BIN=/path/to/postgres/bin node --test tests/ncaa-background-worker-postgres.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, before, after, beforeEach } = require('node:test');
const bin = process.env.NCAAF_TEST_PG_BIN;
const enabled = Boolean(bin);
let directory, socket, env;
const run = (name, args) => execFileSync(path.join(bin, name), args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const args = sql => ['-X', '-h', socket, '-p', '55436', '-U', 'ncaaf_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql];
const sql = value => run('psql', args(value)).trim();
const asyncSql = async value => (await promisify(execFile)(path.join(bin, 'psql'), args(value), { env, encoding: 'utf8' })).stdout.trim();
const scalar = value => JSON.parse(sql(value));
const claim = (task = 'results', manual = false, id = 1) => scalar(`set role service_role; select public.claim_ncaa_pickem_sync(${id}, '${task}', ${manual}); reset role;`);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const batch = (events = ['shared-event'], winner = 'home') => events.map((event, index) => ({
  espn_event_id: event, kickoff_at: new Date(Date.now() - 60_000).toISOString(),
  status: 'post', winner_team_id: winner, completed: true, away_score: 10 + index, home_score: 20,
}));
const apply = (token, games = batch(), id = 1) => scalar(`set role service_role; select public.apply_ncaa_pickem_results(${id}, '${token}', ${quote(JSON.stringify(games))}::jsonb); reset role;`);
const reserve = (token, team = 1, user = '10000000-0000-0000-0000-000000000001', id = 1) => sql(`set role service_role; select public.reserve_ncaa_pickem_reminder(${id}, '${token}', ${team}, '${user}'); reset role;`);

before(() => {
  if (!enabled) return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ncaa-worker-pg-'));
  socket = path.join(directory, 'socket'); fs.mkdirSync(socket);
  env = { ...process.env, PGHOST: socket, PGPORT: '55436', PGUSER: 'ncaaf_test', PGDATABASE: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable' };
  run('initdb', ['-D', path.join(directory, 'data'), '-L', path.resolve(bin, '../../../../share/postgresql/15'), '--auth=trust', '--username=ncaaf_test', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'postgres.log'), '-o', `-k ${socket} -p 55436 -c listen_addresses=''`, '-w', 'start']);
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.app_users(id uuid primary key, is_active boolean not null default true);
    create table public.leagues(id uuid primary key, group_id uuid not null, sport_key text not null);
    create table public.teams(id bigint primary key, group_id uuid not null, user_id uuid references app_users(id));
    create table public.group_memberships(group_id uuid, user_id uuid, is_active boolean);
    create table public.notification_preferences(user_id uuid primary key, notifications_enabled boolean, pickem_reminder_enabled boolean);
    -- Intentionally no unique constraint: reservation must work independently of historical schema drift.
    create table public.notification_history(event_key text, status text);`);
  sql(fs.readFileSync('supabase/migrations/20260817_ncaa_pickem_foundation.sql', 'utf8'));
  sql(`alter table public.ncaa_pickem_weeks add column league_id uuid references public.leagues(id);
    alter table public.ncaa_pickem_games add column commissioner_selected boolean not null default false;`);
  sql(fs.readFileSync('supabase/migrations/20260907_ncaa_pickem_odds.sql', 'utf8'));
  sql(fs.readFileSync('supabase/migrations/20260901_ncaa_pickem_group_scope_phase_b.sql', 'utf8'));
  sql(`alter table public.ncaa_pickem_weeks add unique(league_id,season,week_number);
    alter table public.ncaa_pickem_games add unique(week_id,espn_event_id);
    grant usage on schema public to service_role, anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;`);
  sql(fs.readFileSync('supabase/migrations/20261002000100_ncaa_pickem_background_worker.sql', 'utf8'));
});
after(() => {
  if (!directory) return;
  try { run('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
beforeEach(() => {
  if (!enabled) return;
  sql(`truncate public.ncaa_pickem_sync_state, public.ncaa_pickem_sync_runs, public.ncaa_pickem_reminder_events,
    public.ncaa_pickem_picks, public.ncaa_pickem_games, public.ncaa_pickem_weeks, public.notification_history,
    public.notification_preferences, public.group_memberships, public.teams, public.leagues, public.app_users restart identity;
    insert into public.app_users values('10000000-0000-0000-0000-000000000001', true),('10000000-0000-0000-0000-000000000002', true),('10000000-0000-0000-0000-000000000003', false);
    insert into public.leagues values('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ncaa_pickem'),
      ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','ncaa_pickem');
    insert into public.teams values(1,'30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
      (2,'30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002'),
      (3,'30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003');
    insert into public.group_memberships values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true),
      ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',true),
      ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',true);
    insert into public.ncaa_pickem_weeks(id,season,week_number,label,status,lock_at,league_id) values
      (1,2026,4,'Week 4','locked',clock_timestamp()-interval '1 hour','20000000-0000-0000-0000-000000000001'),
      (2,2026,4,'Week 4','locked',clock_timestamp()-interval '1 hour','20000000-0000-0000-0000-000000000002');
    insert into public.ncaa_pickem_games(id,week_id,espn_event_id,kickoff_at,away_team_id,away_team_name,home_team_id,home_team_name,status,included) values
      (10,1,'shared-event',clock_timestamp()-interval '1 hour','away','Away','home','Home','in',true),
      (20,2,'shared-event',clock_timestamp()-interval '1 hour','away','Away','home','Home','in',true);
    insert into public.ncaa_pickem_picks(id,week_id,game_id,team_id,picked_team_id) values (1,1,10,1,'home'),(2,2,20,2,'away'),(3,1,10,3,'home');`);
});
const pgtest = (name, fn) => test(name, { skip: !enabled }, fn);

pgtest('SQL: overlapping claims are atomic; expired token cannot apply or finish over replacement', async () => {
  const claims = (await Promise.all([asyncSql("select claim_ncaa_pickem_sync(1,'results');"), asyncSql("select claim_ncaa_pickem_sync(1,'results');")])).map(JSON.parse);
  assert.deepEqual(claims.map(c => c.state).sort(), ['claimed', 'leased']);
  const old = claims.find(c => c.state === 'claimed');
  sql("update ncaa_pickem_sync_state set lease_expires_at = clock_timestamp() - interval '1 second';");
  const replacement = claim(); assert.equal(replacement.recovered, true);
  assert.throws(() => apply(old.token), /lease lost/);
  assert.equal(sql(`select finish_ncaa_pickem_sync(1,'results','${old.token}',true);`), 'f');
  assert.equal(apply(replacement.token).gradedPicks, 1);
});
pgtest('SQL: scoring is idempotent, Group-isolated and excludes inactive participants', () => {
  const lease = claim(); const first = apply(lease.token); const second = apply(lease.token);
  assert.equal(first.gradedPicks, 1); assert.equal(second.gradedPicks, 0); assert.equal(first.weekStatus, 'final');
  assert.equal(sql('select is_correct from ncaa_pickem_picks where id=1'), 't');
  assert.equal(sql('select is_correct is null from ncaa_pickem_picks where id in(2,3) order by id'), 't\nt');
  assert.equal(sql('select status from ncaa_pickem_weeks where id=2'), 'locked');
  assert.equal(sql('select status from ncaa_pickem_games where id=20'), 'in');
});
pgtest('SQL: every included game must be complete; completed games without winners retain legacy finalization', () => {
  sql(`insert into ncaa_pickem_games(id,week_id,espn_event_id,kickoff_at,away_team_id,away_team_name,home_team_id,home_team_name,status,included)
    values(11,1,'missing-event',clock_timestamp(),'a','A','h','H','in',true);`);
  sql("update ncaa_pickem_weeks set status='open' where id=1;");
  const lease = claim(), locked = apply(lease.token);
  assert.equal(locked.weekStatus, 'locked'); assert.equal(locked.previousWeekStatus, 'open'); assert.equal(locked.statusChanged, true);
  assert.equal(apply(lease.token, batch(['shared-event','missing-event'], null)).weekStatus, 'final');
  sql("update ncaa_pickem_weeks set status='final' where id=1;");
  assert.equal(apply(lease.token, [{ ...batch()[0], status: 'in', completed: false }]).weekStatus, 'final');
  assert.throws(() => apply(lease.token, []), /no mapped games/);
});
pgtest('SQL: atomic apply preserves current commissioner inclusion and locked odds', () => {
  const lease = claim();
  sql("update ncaa_pickem_games set included=false,commissioner_selected=true,spread=-7.5,odds_provider='Frozen' where id=10;");
  const result = apply(lease.token, [{ ...batch()[0], included: true, spread: -1, odds_provider: 'New' }]);
  assert.equal(result.gradedPicks, 0); assert.equal(result.weekStatus, 'locked');
  assert.equal(sql('select included::text || \'|\' || commissioner_selected::text || \'|\' || spread::text || \'|\' || odds_provider from ncaa_pickem_games where id=10'), 'false|true|-7.5|Frozen');
});
pgtest('SQL: final weeks skip unattended work but retain explicit manual refresh', () => {
  sql("update ncaa_pickem_weeks set status='final' where id=1;");
  assert.equal(claim().state, 'ineligible');
  assert.equal(claim('results', true).state, 'claimed');
  assert.equal(claim('reminders', true).state, 'ineligible');
});
pgtest('SQL: failure backoff, success reset, bounded history retention and durable history permissions', () => {
  const lease = claim();
  assert.equal(sql(`select finish_ncaa_pickem_sync(1,'results','${lease.token}',false,'{}','failure');`), 't');
  assert.equal(sql("select consecutive_failures from ncaa_pickem_sync_state where week_id=1"), '1');
  assert.ok(Number(sql("select extract(epoch from next_attempt_at-clock_timestamp()) from ncaa_pickem_sync_state where week_id=1")) > 115);
  assert.equal(claim().state, 'backoff');
  const manual = claim('results', true);
  sql(`select finish_ncaa_pickem_sync(1,'results','${manual.token}',true,'{}',null,1);`);
  assert.equal(sql('select consecutive_failures from ncaa_pickem_sync_state where week_id=1'), '0');
  assert.ok(Number(sql('select extract(epoch from next_attempt_at-clock_timestamp()) from ncaa_pickem_sync_state where week_id=1')) > 235);
  const capped = claim('results', true);
  sql(`update ncaa_pickem_sync_state set consecutive_failures=50 where week_id=1;
    select finish_ncaa_pickem_sync(1,'results','${capped.token}',false,'{}','retry cap');`);
  const retrySeconds = Number(sql('select extract(epoch from next_attempt_at-clock_timestamp()) from ncaa_pickem_sync_state where week_id=1'));
  assert.ok(retrySeconds > 21595 && retrySeconds <= 21600);
  sql("set role service_role; insert into ncaa_pickem_sync_runs(task,source,started_at) select 'results','background',clock_timestamp()-interval '61 days' from generate_series(1,150); reset role;");
  assert.equal(sql('select prune_ncaa_pickem_sync_runs()'), '100'); assert.equal(sql('select count(*) from ncaa_pickem_sync_runs'), '50');
  for (const role of ['anon','authenticated']) {
    assert.throws(() => sql(`set role ${role}; select * from ncaa_pickem_sync_state;`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select claim_ncaa_pickem_sync(1,'results');`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select apply_ncaa_pickem_results(1,'${manual.token}','[]');`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select * from ncaa_pickem_reminder_events;`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select discover_ncaa_pickem_work('results');`), /permission denied/);
  }
});
pgtest('SQL: reminder reservations enforce Group, deadline, missing picks, preferences and duplicate history keys', () => {
  sql("update ncaa_pickem_weeks set status='open',lock_at=clock_timestamp()+interval '1 hour';");
  const lease = claim('reminders'); assert.equal(lease.state, 'claimed');
  assert.equal(reserve(lease.token), 'ineligible'); sql('delete from ncaa_pickem_picks where id=1;');
  assert.equal(reserve(lease.token, 2, '10000000-0000-0000-0000-000000000002'), 'ineligible');
  assert.equal(reserve(lease.token, 3, '10000000-0000-0000-0000-000000000003'), 'ineligible');
  sql("insert into notification_preferences values('10000000-0000-0000-0000-000000000001',true,false);");
  assert.equal(reserve(lease.token), 'ineligible'); sql('delete from notification_preferences;');
  sql("insert into notification_history values('ncaa_pickem_lock_reminder:1:10000000-0000-0000-0000-000000000001','failed');");
  assert.equal(reserve(lease.token), 'duplicate'); sql('delete from notification_history;');
  assert.equal(reserve(lease.token), 'reserved'); assert.equal(reserve(lease.token), 'duplicate');
  assert.equal(sql('select count(*) from ncaa_pickem_reminder_events'), '1');
  sql("update ncaa_pickem_weeks set lock_at=clock_timestamp()-interval '1 second' where id=1;");
  assert.equal(reserve(lease.token), 'ineligible');
});
pgtest('SQL: discovery filters stale due times before the 100-week bound and surfaces never-attempted work', () => {
  const lease = claim(); sql(`select finish_ncaa_pickem_sync(1,'results','${lease.token}',true);`);
  assert.equal(sql("select id from discover_ncaa_pickem_work('results')"), '2');
  sql("update ncaa_pickem_weeks set status='final' where id=2;");
  assert.equal(sql("select count(*) from discover_ncaa_pickem_work('results')"), '0');
});
