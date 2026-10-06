/* eslint-disable @typescript-eslint/no-require-imports */
/* Fresh Unix-socket PostgreSQL only. Never loads .env or accepts a DB URL. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const root = path.resolve(__dirname, '../..');
const ids = {
  group: '10000000-0000-0000-0000-000000000001', other: '10000000-0000-0000-0000-000000000002',
  league: '20000000-0000-0000-0000-000000000001', otherLeague: '20000000-0000-0000-0000-000000000002',
  mark: '30000000-0000-0000-0000-000000000004', josh: '30000000-0000-0000-0000-000000000002',
  jon: '30000000-0000-0000-0000-000000000003', outsider: '30000000-0000-0000-0000-000000000006',
  super: '30000000-0000-0000-0000-000000000007',
};
const snapshot = { sport: 'nfl', schemaVersion: 1, draft: { type: 'snake' },
  roster: { slots: [{ position: 'QB', slotCount: 1 }, { position: 'RB', slotCount: 2 },
    { position: 'WR', slotCount: 2 }, { position: 'TE', slotCount: 1 }, { position: 'FLEX', slotCount: 1 }] }, scoring: {} };
const slots = snapshot.roster.slots.map(s => ({ position: s.position, slot_count: s.slotCount }));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
function createDiscardPostgres(bin, port = 55439) {
  let directory, socket, env;
  const run = (name, args) => execFileSync(path.join(bin, name), args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const args = value => ['-X', '-h', socket, '-p', String(port), '-U', 'discard_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', value];
  const sql = value => run('psql', args(value)).trim();
  const asyncSql = async (value, name = 'discard-test') => (await promisify(execFile)(path.join(bin, 'psql'), args(value),
    { env: { ...env, PGAPPNAME: name }, encoding: 'utf8' })).stdout.trim();
  const startSql = (value, name) => asyncSql(value, name).then(stdout => ({ ok: true, stdout }), error => ({ ok: false, error }));
  const scalar = value => JSON.parse(sql(value));
  const call = (name = 'discard_abandoned_nfl_slate', id = 191, actor = ids.mark, group = ids.group, league = ids.league) =>
    `select public.${name}(${id},'${group}','${league}','${actor}');`;
  const inspect = (id = 191, actor = ids.mark, group = ids.group, league = ids.league) => scalar(`set role service_role; ${call('inspect_nfl_slate_discard', id, actor, group, league)}`);
  const discard = (id = 191, actor = ids.mark, group = ids.group, league = ids.league) => scalar(`set role service_role; ${call('discard_abandoned_nfl_slate', id, actor, group, league)}`);
  function pickSql(id = 191, team = 2, player = 283, actor = ids.josh, expected = [], correction = false) {
    return `select public.mutate_fantasy_draft(${id},'${ids.group}','${ids.league}','nfl',${team},'${actor}',${json({
      desired_ids: [player], expected_ids: expected, correction, rules_snapshot: snapshot, roster_slots: slots,
      assignments: [{ player_id: player, position: 'RB', slot_index: 1 }],
    })});`;
  }
  const graph = () => scalar(`select jsonb_build_object(
    'slates',(select count(*) from slates where id=191),'drafts',(select count(*) from fantasy_drafts where slate_id=191),
    'picks',(select count(*) from draft_picks where slate_id=191),'corrections',(select count(*) from draft_corrections where slate_id=191),
    'lineups',(select count(*) from lineups where slate_id=191),'players',(select count(*) from lineup_players lp join lineups l on l.id=lp.lineup_id where l.slate_id=191),
    'teams',(select count(*) from slate_teams where slate_id=191),'context',(select count(*) from nfl_slate_discard_context));`);
  async function waitFor(name, event) {
    const deadline = Date.now() + 5000;
    do {
      if (sql(`select exists(select 1 from pg_stat_activity where application_name=${quote(name)} and ${event === 'sleep' ? "wait_event='PgSleep'" : "wait_event_type='Lock'"});`) === 't') return;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(`Session ${name} did not reach ${event}`);
  }
  function start() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-discard-pg-'));
    socket = path.join(directory, 'socket'); fs.mkdirSync(socket);
    env = { ...process.env, PGHOST: socket, PGPORT: String(port), PGUSER: 'discard_test', PGDATABASE: 'postgres',
      PGPASSWORD: '', PGSSLMODE: 'disable', LD_LIBRARY_PATH: [path.resolve(bin, '../../../x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
    run('initdb', ['-D', path.join(directory, 'data'), '-L', path.resolve(bin, '../../../../share/postgresql/15'), '--auth=trust', '--username=discard_test', '--no-locale', '--encoding=UTF8']);
    run('pg_ctl', ['-D', path.join(directory, 'data'), '-l', path.join(directory, 'postgres.log'), '-o', `-k ${socket} -p ${port} -c listen_addresses='' -c jit=off`, '-w', 'start']);
    sql("alter database postgres set timezone='America/New_York'"); // Fixtures' current_date matches the explicit application day.
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create table groups(id uuid primary key,is_active boolean default true);
      create table app_users(id uuid primary key,display_name text,system_role text default 'user',role text default 'player',is_active boolean default true);
      create table leagues(id uuid primary key,group_id uuid references groups(id),sport_key text,is_enabled boolean default true);
      create table group_memberships(id bigint generated always as identity primary key,group_id uuid references groups(id),user_id uuid references app_users(id),role text default 'member',is_active boolean default true);
      create table teams(id bigint primary key,name text,user_id uuid references app_users(id),group_id uuid references groups(id));
      create table slates(id bigint generated by default as identity primary key,league_id uuid references leagues(id),sport text,date date,start_date date,end_date date,is_locked boolean default false,
        archived_at timestamptz,first_game_start_time timestamptz,display_name text,rules_snapshot jsonb,rules_version integer);
      create table slate_teams(id bigint generated always as identity primary key,slate_id bigint references slates(id),team_id bigint references teams(id),draft_order integer,is_participating boolean,unique(slate_id,team_id));
      create table lineups(id bigint generated always as identity primary key,slate_id bigint references slates(id),team_id bigint references teams(id));
      create table lineup_players(id bigint generated always as identity primary key,lineup_id bigint references lineups(id) on delete cascade,player_id bigint,
        roster_slot_position text,roster_slot_index integer,projected_fantasy_points numeric,projection_confidence text,projection_source text,projected_at timestamptz);
      create table players_nfl(id bigint primary key,name text,position text,is_active boolean default true);
      create table players(id bigint primary key,name text,position_group text,is_active boolean default true);
      create table team_slate_results(id bigint generated always as identity primary key,slate_id bigint references slates(id),team_id bigint references teams(id),fantasy_points numeric,finish_position integer);
      create table player_slate_stats(slate_id bigint references slates(id),player_id bigint,fantasy_points numeric);
      create table player_nfl_slate_stats(slate_id bigint references slates(id),player_id bigint,fantasy_points numeric);
      create table notification_history(id bigint generated always as identity primary key,slate_id bigint references slates(id),league_id uuid references leagues(id),team_id bigint references teams(id),status text,title text,metadata jsonb);
      create table golf_roster_periods(id bigint primary key,slate_id bigint references slates(id) on delete cascade);
      grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;`);
    for (const file of ['20260912000100_fantasy_draft_history.sql', '20260930000100_nfl_background_scoring.sql', '20261006000100_guarded_nfl_slate_discard.sql']) {
      sql(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    }
  }
  function reset({ pick = true, initialized = false, corrections = false } = {}) {
    sql(`truncate nfl_slate_discard_context,notification_history,golf_roster_periods,nfl_sync_state,nfl_sync_runs,draft_corrections,draft_picks,fantasy_drafts,
      lineup_players,lineups,slate_teams,team_slate_results,player_slate_stats,player_nfl_slate_stats,slates,teams,group_memberships,leagues,groups,app_users,players_nfl,players restart identity;
      insert into groups(id) values('${ids.group}'),('${ids.other}');
      insert into app_users(id,display_name) select ('30000000-0000-0000-0000-00000000000'||i)::uuid,name from (values(1,'Andy'),(2,'Josh'),(3,'Jon'),(4,'Mark'),(5,'Mark YMCA'),(6,'Other admin'),(7,'Super admin')) u(i,name);
      update app_users set system_role='super_admin' where id='${ids.super}';
      insert into leagues(id,group_id,sport_key) values('${ids.league}','${ids.group}','nfl'),('${ids.otherLeague}','${ids.other}','nfl');
      insert into group_memberships(group_id,user_id,role,is_active) select '${ids.group}',id,case when display_name='Mark' then 'admin' else 'member' end,display_name<>'Mark YMCA' from app_users where display_name not in ('Other admin','Super admin');
      insert into group_memberships(group_id,user_id,role) values('${ids.other}','${ids.outsider}','admin');
      insert into teams select i,name,('30000000-0000-0000-0000-00000000000'||i)::uuid,case when i=6 then '${ids.other}'::uuid else '${ids.group}'::uuid end from (values(1,'Andy'),(2,'Josh'),(3,'Jon'),(4,'Mark'),(5,'Mark YMCA'),(6,'Other admin')) u(i,name);
      insert into players_nfl(id,name,position) values(283,'Jahmyr Gibbs','RB'),(284,'Replacement RB','RB');
      insert into slates(id,league_id,sport,date,start_date,end_date,display_name,rules_snapshot,rules_version) values
        (191,'${ids.league}','nfl',current_date+2,current_date+2,current_date+6,'2026 Week 5',${json(snapshot)},5),
        (190,'${ids.league}','nfl',current_date-5,current_date-5,current_date-1,'2026 Week 4',${json(snapshot)},5),
        (300,'${ids.otherLeague}','nfl',current_date+2,current_date+2,current_date+6,'Other Week',${json(snapshot)},5);
      update slates set is_locked=true where id=190;
      insert into slate_teams(slate_id,team_id,draft_order,is_participating) values(191,2,1,true),(191,3,2,true),(191,4,3,true),(191,1,4,true),(300,6,1,true);
      insert into team_slate_results(slate_id,team_id,fantasy_points,finish_position) values(190,1,119.9,1),(190,4,114,2),(190,3,108.4,3),(190,2,98.1,4);`);
    if (pick) sql(`set role service_role; ${pickSql()}`);
    else if (initialized) sql(`insert into fantasy_drafts(slate_id,group_id,league_id,sport,participant_ids,roster_slots,rules_snapshot) values(191,'${ids.group}','${ids.league}','nfl',array[2,3,4,1],${json(slots)},${json(snapshot)});`);
    if (corrections) sql(`set role service_role; ${pickSql(191,2,284,ids.mark,[283],true)}`);
    sql(`insert into notification_history(slate_id,league_id,team_id,status,title,metadata) values(191,'${ids.league}',3,'sent','Your turn','{"delivery":"retained"}');`);
  }
  function stop() {
    if (!directory) return;
    try { if (fs.existsSync(path.join(directory, 'data/postmaster.pid'))) run('pg_ctl', ['-D', path.join(directory, 'data'), '-m', 'immediate', '-w', 'stop']); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  return { start, stop, reset, sql, asyncSql, startSql, scalar, inspect, discard, graph, call, pickSql, waitFor, ids, snapshot, slots, json, quote };
}
module.exports = { createDiscardPostgres, ids, snapshot, slots, json, quote };
