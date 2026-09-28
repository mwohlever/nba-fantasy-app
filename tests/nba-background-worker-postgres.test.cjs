/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated local PostgreSQL only. Never reads a Supabase URL or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, before, after, beforeEach } = require('node:test');
const bin = process.env.NBA_TEST_PG_BIN;
let directory, socket, env;
const run = (name,args) => execFileSync(path.join(bin,name),args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const args = value => ['-X','-h',socket,'-p','55438','-U','nba_test','-d','postgres','-v','ON_ERROR_STOP=1','-Atq','-c',value];
const sql = value => run('psql',args(value)).trim();
const asyncSql = async value => (await promisify(execFile)(path.join(bin,'psql'),args(value),{env,encoding:'utf8'})).stdout.trim();
const scalar = value => JSON.parse(sql(value));
const quote = value => `'${String(value).replaceAll("'","''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const claim = (task='fantasy',id=1,manual=false) => scalar(`set role service_role; select claim_nba_sync('${task}',${id},${manual});`);
const codes = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'];
const records = (wins=3,losses=2) => codes.map(abbreviation=>({abbreviation,displayName:abbreviation,espnTeamId:'1',wins,losses,gamesPlayed:wins+losses}));
const projections = () => codes.map(abbreviation=>({abbreviation,projectedWins:41,projectedLosses:41}));
const skinsApply = (token,id=11,rows=records(),projected=null) => scalar(`set role service_role; select apply_nba_skins(${id},'${token}',2026,${json(rows)},${projected?json(projected):'null'});`);
const ctx = id => scalar(`select load_nba_fantasy_context(${id});`);
function fantasyApply(token,id=1,options={}) {
  const context = options.context??ctx(id);
  const row = {slate_id:id,player_id:1,points:10,rebounds:2,assists:1,steals:1,blocks:1,turnovers:1,fantasy_points:16.9,
    games_completed:options.final?1:0,games_in_progress:options.final?0:1,games_remaining:0,game_status:options.final?3:2,game_status_text:options.final?'Final':'Live',period:4,game_clock:'PT0S'};
  const teams = [{slate_id:id,team_id:id,fantasy_points:16.9,finish_position:1,games_completed:row.games_completed,games_in_progress:row.games_in_progress,games_remaining:0}];
  return sql(`set role service_role; select apply_nba_fantasy(${id},'${token}',${json(context)},${json(options.rows??[row])},${json(teams)},${Boolean(options.final)},${json({completed:Boolean(options.final),currentStats:[row]})},${quote(new Date(context.slate.end_date+'T23:59:59').toISOString())}::timestamptz);`)==='t';
}
const finish = (task,id,token,success=true,delay=240) => sql(`set role service_role; select finish_nba_sync('${task}',${id},'${token}',${success},'{}',${success?'null':"'provider failed'"},${delay});`);
const pgtest = (name,fn) => test(name,{skip:!bin},fn);
before(()=>{
  if(!bin)return;
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'nba-worker-pg-'));socket=path.join(directory,'socket');fs.mkdirSync(socket);
  env={...process.env,PGHOST:socket,PGPORT:'55438',PGUSER:'nba_test',PGDATABASE:'postgres',PGPASSWORD:'',PGSSLMODE:'disable',
    LD_LIBRARY_PATH:[path.resolve(bin,'../../../x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
  run('initdb',['-D',path.join(directory,'data'),'-L',path.resolve(bin,'../../../../share/postgresql/15'),'--auth=trust','--username=nba_test','--no-locale','--encoding=UTF8']);
  run('pg_ctl',['-D',path.join(directory,'data'),'-l',path.join(directory,'postgres.log'),'-o',`-k ${socket} -p 55438 -c listen_addresses='' -c jit=off`,'-w','start']);
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table leagues(id uuid primary key,group_id uuid not null,sport_key text,is_enabled boolean default true);
    create table teams(id bigint primary key,group_id uuid);
    create table players(id bigint primary key,name text,nba_player_id bigint,team_abbreviation text);
    create table slates(id bigint primary key,league_id uuid references leagues(id),sport text,date date,start_date date,end_date date,
      is_locked boolean default false,archived_at timestamptz,first_game_start_time timestamptz,nba_team_abbreviations text[],rules_snapshot jsonb);
    create table lineups(id bigint primary key,slate_id bigint references slates(id),team_id bigint references teams(id));
    create table lineup_players(lineup_id bigint references lineups(id),player_id bigint references players(id));
    create table slate_nba_games(slate_id bigint references slates(id),game_id text,game_code text,game_date date,unique(slate_id,game_id));
    create table player_slate_stats(slate_id bigint references slates(id),player_id bigint references players(id),points integer,rebounds integer,assists integer,steals integer,blocks integer,turnovers integer,
      fantasy_points numeric,games_completed integer,games_in_progress integer,games_remaining integer,game_status integer,game_status_text text,period integer,game_clock text,unique(slate_id,player_id));
    create table team_slate_results(slate_id bigint references slates(id),team_id bigint references teams(id),fantasy_points numeric,finish_position integer,games_completed integer,games_in_progress integer,games_remaining integer,unique(slate_id,team_id));`);
  sql(fs.readFileSync('supabase/migrations/20260817_nba_skins_foundation.sql','utf8'));
  sql(`alter table nba_skins_seasons add column league_id uuid references leagues(id),add column participant_count integer default 4,add column nba_teams_per_participant integer default 7;
    alter table nba_skins_seasons drop constraint nba_skins_seasons_season_key;
    grant usage on schema public to anon,authenticated,service_role;
    grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;`);
  // Only this fresh, temporary cluster receives the migration, for transaction/security verification.
  sql(fs.readFileSync('supabase/migrations/20261003000100_nba_background_orchestration.sql','utf8'));
});
after(()=>{if(!directory)return;try{if(fs.existsSync(path.join(directory,'data','postmaster.pid')))run('pg_ctl',['-D',path.join(directory,'data'),'-m','immediate','-w','stop']);}finally{fs.rmSync(directory,{recursive:true,force:true});}});
beforeEach(()=>{
  if(!bin)return;
  sql(`truncate nba_sync_state,nba_sync_runs,nba_skins_team_records,nba_skins_picks,nba_skins_draft_order,nba_skins_seasons,player_slate_stats,team_slate_results,slate_nba_games,lineup_players,lineups,slates,players,teams,leagues restart identity;
    insert into leagues values
      ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','nba',true),
      ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','nba',true),
      ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','nba_skins',true),
      ('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','nba_skins',true);
    insert into teams select i,case when i%2=1 then '20000000-0000-0000-0000-000000000001'::uuid else '20000000-0000-0000-0000-000000000002'::uuid end from generate_series(1,8) i;
    insert into players values(1,'Player',42,'BOS');
    insert into slates(id,league_id,sport,date,start_date,end_date,first_game_start_time,nba_team_abbreviations) select i,l.id,'nba',(clock_timestamp() at time zone 'America/New_York')::date-1,(clock_timestamp() at time zone 'America/New_York')::date-1,(clock_timestamp() at time zone 'America/New_York')::date-1,clock_timestamp()-interval '1 hour',array['BOS'] from generate_series(1,2) i join leagues l on l.id=('10000000-0000-0000-0000-00000000000'||i)::uuid;
    insert into lineups values(10,1,1),(20,2,2);insert into lineup_players values(10,1),(20,1);
    insert into slate_nba_games select i,'0022600001',to_char((clock_timestamp() at time zone 'America/New_York')::date-1,'YYYYMMDD')||'/LALBOS',(clock_timestamp() at time zone 'America/New_York')::date-1 from generate_series(1,2) i;
    insert into nba_skins_seasons(id,season,status,league_id) values(11,2026,'locked','10000000-0000-0000-0000-000000000003'),(12,2026,'locked','10000000-0000-0000-0000-000000000004');
    insert into nba_skins_picks(season_id,team_id,nba_team_abbreviation,pick_type,draft_round,overall_pick)
      select season_id,case season_id when 11 then 1+2*((idx-1)%4) else 2+2*((idx-1)%4) end,abbreviation,case when idx%2=0 then 'losses' else 'wins' end,1+(idx-1)/4,idx
      from (select abbreviation,row_number() over(order by abbreviation)::integer idx from nba_skins_nba_teams) t cross join (values(11),(12)) s(season_id) where idx<=28;`);
});
pgtest('SQL claims serialize; Fantasy and Skins leases are independent; expired claims fence old apply and finish',async()=>{
  const claims=(await Promise.all([asyncSql("select claim_nba_sync('fantasy',1);"),asyncSql("select claim_nba_sync('fantasy',1);")])).map(JSON.parse);
  assert.deepEqual(claims.map(c=>c.state).sort(),['claimed','leased']); const old=claims.find(c=>c.state==='claimed');
  assert.equal(claim('skins',11).state,'claimed');
  sql("update nba_sync_state set lease_expires_at=clock_timestamp()-interval '1 second' where task='fantasy';");
  assert.throws(()=>fantasyApply(old.token),/lease lost/); assert.equal(finish('fantasy',1,old.token),'f');
  const replacement=claim(); assert.equal(replacement.recovered,true); assert.throws(()=>fantasyApply(old.token),/lease lost/); assert.equal(fantasyApply(replacement.token),true);
});
pgtest('SQL Fantasy player/team writes and finalization are atomic and Group isolated; replay rebuild never adds totals',()=>{
  let lease=claim(); assert.equal(fantasyApply(lease.token),true);
  assert.equal(sql('select fantasy_points from player_slate_stats where slate_id=1'),'16.9');assert.equal(sql('select count(*) from player_slate_stats where slate_id=2'),'0');
  sql(`select ack_nba_notifications(1,'${lease.token}');`);assert.equal(finish('fantasy',1,lease.token),'t');
  lease=claim('fantasy',1,true);assert.equal(fantasyApply(lease.token,1,{final:true}),true);
  assert.equal(sql('select fantasy_points from player_slate_stats where slate_id=1'),'16.9');assert.equal(sql('select is_locked from slates where id=1'),'t');assert.equal(sql('select is_locked from slates where id=2'),'f');
  sql(`select ack_nba_notifications(1,'${lease.token}');`);finish('fantasy',1,lease.token);
  assert.equal(claim('fantasy',1,true).state,'ineligible');
});
pgtest('SQL changed pins/rules/rosters or accepted state reject the old read set before any writes',()=>{
  for(const change of ["update slates set rules_snapshot='{\"scoring\":{\"points\":2}}' where id=1",
    "insert into slate_nba_games values(1,'0022600002','20261020/LALBOS',(clock_timestamp() at time zone 'America/New_York')::date-1)",
    'delete from lineup_players where lineup_id=10']) {
    const lease=claim('fantasy',1,true),context=ctx(1);sql(change);assert.throws(()=>fantasyApply(lease.token,1,{context}),/context changed/);
    assert.equal(sql('select count(*) from player_slate_stats'),'0');finish('fantasy',1,lease.token,false);
  }
});
pgtest('SQL malformed team write rolls back player writes and pending notifications',()=>{
  const lease=claim(),context=ctx(1);
  assert.throws(()=>fantasyApply(lease.token,1,{context,rows:[{slate_id:2,player_id:1}]}),/batch scope/);
  assert.equal(sql('select count(*) from player_slate_stats'),'0');assert.equal(sql("select pending_notifications is null from nba_sync_state where task='fantasy'"),'t');
});
pgtest('SQL final day cannot be locked early; accepted locked data and archived/disabled slates are ineligible',()=>{
  sql("update slates set end_date=(clock_timestamp() at time zone 'America/New_York')::date where id=1;");
  const lease=claim();assert.throws(()=>fantasyApply(lease.token,1,{final:true}),/end day not passed/);
  finish('fantasy',1,lease.token,false);sql("update slates set is_locked=true where id=1;");assert.equal(claim('fantasy',1,true).state,'ineligible');
  sql("update slates set archived_at=clock_timestamp() where id=2;");assert.equal(claim('fantasy',2,true).state,'ineligible');
});
pgtest('SQL notification payload survives final lock/expiration and fenced acknowledgment; discovery includes recovery',()=>{
  const lease=claim();fantasyApply(lease.token,1,{final:true});finish('fantasy',1,lease.token);
  sql("update nba_sync_state set next_attempt_at=clock_timestamp()-interval '1 second';");
  const work=scalar("select jsonb_agg(to_jsonb(w)) from discover_nba_work('fantasy') w;");assert.ok(work.some(w=>w.target_id===1));
  const retry=claim();assert.ok(retry.pending);assert.equal(sql(`select ack_nba_notifications(1,'${lease.token}');`),'f');
  assert.equal(sql(`select ack_nba_notifications(1,'${retry.token}');`),'t');
});
pgtest('SQL Skins rebuilds season/participant totals idempotently; projections are retained; completed results do not auto-finalize',()=>{
  const lease=claim('skins',11);assert.equal(skinsApply(lease.token,11,records(),projections()).picksUpdated,28);
  assert.equal(skinsApply(lease.token,11,records(),null).picksUpdated,28);
  assert.equal(sql('select count(*) from nba_skins_team_records where season_id=11'),'30');assert.equal(sql('select count(*) from nba_skins_team_records where season_id=12'),'0');
  assert.equal(sql('select projected_wins from nba_skins_team_records where season_id=11 limit 1'),'41.00');
  assert.equal(sql('select count(*) from nba_skins_picks where season_id=12 and final_points is not null'),'0');
  skinsApply(lease.token,11,records(40,42));assert.equal(sql('select status from nba_skins_seasons where id=11'),'locked');
  assert.throws(()=>skinsApply(lease.token,11,records()),/regression/);
});
pgtest('SQL partial standings/projections, incomplete draft and cross-Group participants never partially score',()=>{
  const lease=claim('skins',11);
  for(const rows of [null,records().slice(1),[...records().slice(1),records()[1]],records().map((r,i)=>i? r:{...r,gamesPlayed:99})]) assert.throws(()=>skinsApply(lease.token,11,rows),/incomplete standings/);
  assert.throws(()=>skinsApply(lease.token,11,records(),projections().slice(1)),/incomplete projections/);assert.equal(sql('select count(*) from nba_skins_team_records'),'0');
  sql('update nba_skins_picks set team_id=2 where season_id=11 and overall_pick=1;');assert.throws(()=>skinsApply(lease.token),/Group scope/);
  sql('delete from nba_skins_picks where season_id=11 and overall_pick=1;');assert.throws(()=>skinsApply(lease.token),/draft incomplete/);
});
pgtest('SQL discovery honors complete frozen drafts, independent latest year per league, due times and oldest-attempt fairness',()=>{
  assert.equal(sql("select count(*) from discover_nba_work('skins')"),'2');
  sql("update nba_skins_seasons set season=2025 where id=11; insert into nba_skins_seasons(id,season,status,league_id) values(13,2026,'open','10000000-0000-0000-0000-000000000003');");
  assert.equal(sql("select count(*) from discover_nba_work('skins')"),'2');
  sql('insert into nba_skins_picks(season_id,team_id,nba_team_abbreviation,pick_type,draft_round,overall_pick) select 13,team_id,nba_team_abbreviation,pick_type,draft_round,overall_pick from nba_skins_picks where season_id=11;');
  assert.equal(sql("select string_agg(target_id::text,',' order by target_id) from discover_nba_work('skins')"),'12,13');
  const lease=claim('skins',12);finish('skins',12,lease.token,true,3600);assert.equal(sql("select string_agg(target_id::text,',') from discover_nba_work('skins')"),'13');
});
pgtest('SQL exponential retries, expired recovery and bounded history pruning preserve durable state',()=>{
  for(let i=0;i<11;i++) {
    const lease=claim('fantasy',1,true);finish('fantasy',1,lease.token,false);
    const delay=Number(sql("select extract(epoch from next_attempt_at-updated_at)::integer from nba_sync_state where task='fantasy'"));
    assert.equal(delay,Math.min(21600,120*2**Math.min(i,8)));
  }
  sql("insert into nba_sync_runs(source,started_at) select 'background',clock_timestamp()-interval '61 days' from generate_series(1,120);");
  assert.equal(sql('set role service_role; select prune_nba_sync_runs();'),'100');assert.equal(sql('select count(*) from nba_sync_runs'),'20');assert.equal(sql('select count(*) from nba_sync_state'),'1');
});
pgtest('SQL anon/authenticated cannot read worker infrastructure or execute service functions',()=>{
  for(const role of ['anon','authenticated']) for(const statement of ['select * from nba_sync_state','select * from nba_sync_runs',"select discover_nba_work('fantasy')","select claim_nba_sync('skins',11)",'select load_nba_fantasy_context(1)','select prune_nba_sync_runs()']) {
    assert.throws(()=>sql(`set role ${role}; ${statement};`),/permission denied/);
  }
});
pgtest('SQL explicitly finalized Skins seasons and far-future drafts are excluded without modifying their results',()=>{
  sql("update nba_skins_seasons set status='final',finalized_at=clock_timestamp() where id=11; update nba_skins_seasons set season=2100 where id=12;");
  assert.equal(claim('skins',11).state,'ineligible');assert.equal(sql("select count(*) from discover_nba_work('skins')"),'0');
  assert.equal(sql('select count(*) from nba_skins_picks'),'56');
});
