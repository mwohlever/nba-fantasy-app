/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { isolatedPostgres, quote, json } = require('./helpers/factual-pipeline-phase2-postgres.cjs');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const { normalizeEspnNflGameLog } = require('../lib/analytics/providers/espnNflGameLog.ts');
const { buildNflObservation, observationRecordFromNflObservation } = require('../lib/analytics/nfl/observationIngestion.ts');
const { hashNflObservation } = require('../lib/analytics/nfl/observationFoundation.ts');
const { selectNflAsOfObservationVersions } = require('../lib/analytics/nfl/projectionInfrastructure.ts');
const { rosterIdentityColumns, assertFrozenPoolScope } = require('../lib/rosters/storageContracts.ts');
const allgeier = require('./fixtures/factual-pipeline/nfl-allgeier-negative-yards.json');
const bin = process.env.FACTUAL_PIPELINE_PG_BIN;
const root = 'supabase/manual/factual-pipeline/';
const group = '00000000-0000-0000-0000-000000000001', league = '00000000-0000-0000-0000-000000000002';
const nflLeague = '00000000-0000-0000-0000-000000000003';
let pg, preservation, signed, initialNfl, initialRecords, initialFunctions;
const receipt = { fixtureOnly: true, productionConnections: 0, productionWrites: 0, results: [] };
const read = file => fs.readFileSync(file, 'utf8');
const apply = (file, approval) => pg.sql(`set sports111.factual_schema_approval=${quote(approval)};\n${read(root + file)}`);
const sqlJson = sql => JSON.parse(pg.sql(sql));
const isolated = (name, fn) => test(name, { skip: !bin && 'Set FACTUAL_PIPELINE_PG_BIN to isolated PostgreSQL binaries' }, async () => {
  await fn(); receipt.results.push({ name, passed: true });
});
function nfl(event, day = 1, yards = 10, extra = {}) {
  const at = `2026-10-${String(day).padStart(2,'0')}T12:00:00Z`;
  const row = { provider:'espn',provider_player_id:'4373626',provider_event_id:String(event),local_player_id:101,position:'RB',season:2026,week:4,
    phase:'regular',game_at:'2026-09-27T17:00:00Z',completed_at:null,team_provider_id:'1',team_abbreviation:'ATL',
    opponent_provider_id:'2',opponent_abbreviation:'BUF',home_away:'home',completions:null,passing_attempts:null,passing_yards:null,
    passing_touchdowns:null,interceptions:null,rushing_attempts:2,rushing_yards:yards,rushing_touchdowns:0,receiving_targets:0,receptions:0,
    receiving_yards:0,receiving_touchdowns:0,fumbles_lost:0,game_log_source_url:'https://sports.example.test/gamelog',game_log_fetched_at:at,
    fumble_summary_source_url:null,fumble_summary_fetched_at:null,known_at:at,normalization_version:'fixture_v1',...extra };
  // Same canonical production hash function, including the existing normalizer label.
  const camel = key => key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
  row.observation_hash = hashNflObservation({provider:row.provider,providerPlayerId:row.provider_player_id,providerEventId:row.provider_event_id,
    localPlayerId:row.local_player_id,position:row.position,season:row.season,week:row.week,phase:row.phase,gameAt:row.game_at,completedAt:row.completed_at,
    team:{providerId:row.team_provider_id,abbreviation:row.team_abbreviation},opponent:{providerId:row.opponent_provider_id,abbreviation:row.opponent_abbreviation},homeAway:row.home_away,
    stats:Object.fromEntries(['completions','passing_attempts','passing_yards','passing_touchdowns','interceptions','rushing_attempts','rushing_yards','rushing_touchdowns',
      'receiving_targets','receptions','receiving_yards','receiving_touchdowns','fumbles_lost'].map(key=>[camel(key),row[key]])),
    provenance:{gameLogSourceUrl:row.game_log_source_url,gameLogFetchedAt:row.game_log_fetched_at,fumbleSummarySourceUrl:row.fumble_summary_source_url,
      fumbleSummaryFetchedAt:row.fumble_summary_fetched_at,knownAt:row.known_at,normalizationVersion:row.normalization_version}});
  return row;
}
function insertLegacy(row) {
  const cols = Object.keys(row).join(',');
  return pg.sql(`insert into public.nfl_player_game_observation_versions(${cols}) select ${cols}
    from jsonb_populate_record(null::public.nfl_player_game_observation_versions,${json(row)}) returning id`);
}
const appendSql = (rows, id = crypto.randomUUID()) => `select public.propose_append_nfl_observations(${quote(id)},${json(rows)})`;
const append = (rows, id) => sqlJson(appendSql(rows,id));
const rowsFor = event => sqlJson(`select coalesce(jsonb_agg(to_jsonb(v) order by known_at,id),'[]') from public.nfl_player_game_observation_versions v where provider_event_id=${quote(event)}`);
function evidence(pid = 1, extra = {}) {
  const sport = pid >= 101 ? 'nfl':'nba';
  return { id:crypto.randomUUID(),sport,nba_player_id:sport==='nba'?pid:null,nfl_player_id:sport==='nfl'?pid:null,entity_kind:'athlete',season:sport==='nba'?2027:2026,
    evidence_type:'interval',effective_from:'2026-10-01T00:00:00Z',effective_to:null,observed_at:'2026-10-20T00:00:00Z',verified_through:extra.effective_to||'2026-10-20T00:00:00Z',
    roster_status:'rostered',confidence:'confirmed',team_provider:'espn',team_provider_id:'1',team_abbreviation:'A',position:sport==='nba'?'G':'RB',
    sources:[{url:'https://sports.example.test/confirmed-transaction',sha256:'a'.repeat(64),captured_at:'2026-10-20T00:00:00Z'}],supersedes_id:null,...extra };
}
const save = e => pg.sql(`select public.propose_append_roster_evidence(${json(e)})`);
const resolve = (pid, at, season = 2027, cutoff = 'clock_timestamp()') => sqlJson(`select public.propose_resolve_roster(${quote(pid>=101?'nfl':'nba')},${pid},${season},${quote(at)},${cutoff})`);
function rosterBaseline() {
  for (let i=1;i<=6;i++) save(evidence(i,i===5 ? { roster_status:'unrostered',team_provider:null,team_provider_id:null,team_abbreviation:null,position:null } : {}));
}
const freezeSql = (id, cutoff = 'clock_timestamp()', sport = 'nba') => `select public.propose_freeze_slate_pool(${id},${quote(group)},${quote(sport==='nba'?league:nflLeague)},${quote(sport)},${sport==='nba'?2027:2026},'2026-10-05T00:00:00Z',${cutoff},'[{"provider":"espn","id":"1"}]')`;
const pool = id => sqlJson(`select public.propose_read_slate_pool(${id},${quote(group)},${quote(league)},'nba')`);
const oldRecordsSql = `select jsonb_build_object('players',(select jsonb_agg(to_jsonb(p) order by id) from players p),
  'nflPlayers',(select jsonb_agg(to_jsonb(p) order by id) from players_nfl p),
  'drafts',(select jsonb_agg(to_jsonb(d) order by slate_id) from fantasy_drafts d),
  'picks',(select jsonb_agg(to_jsonb(p) order by id) from draft_picks p),
  'scores',(select jsonb_agg(to_jsonb(s) order by slate_id) from fixture_saved_scores s),
  'nba',(select jsonb_agg(to_jsonb(v) order by id) from nba_player_game_observation_versions v),
  'nbaCurrent',(select jsonb_agg(to_jsonb(v) order by provider,provider_player_id,provider_event_id) from nba_player_game_current_observations v))`;
const functionsSql = `select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) from pg_proc where oid=any(array[
  'public.append_nba_projection_observations(jsonb)'::regprocedure,'public.read_fantasy_draft(bigint,uuid,uuid,text)'::regprocedure,
  'public.mutate_fantasy_draft(bigint,uuid,uuid,text,bigint,uuid,jsonb)'::regprocedure])`;
function metadata() {
  return sqlJson(`select jsonb_build_object('constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname)
    from pg_constraint where conrelid='public.nfl_player_game_observation_versions'::regclass),
    'grants',(select relacl::text from pg_class where oid='public.nfl_player_game_observation_versions'::regclass),
    'sequenceGrants',(select relacl::text from pg_class where oid='public.nfl_player_game_observation_versions_id_seq'::regclass),
    'viewGrants',(select relacl::text from pg_class where oid='public.nfl_player_game_observations'::regclass),
    'view',pg_get_viewdef('public.nfl_player_game_observations'::regclass,true),
    'trigger',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.nfl_player_game_observation_versions'::regclass and not tgisinternal))`);
}
before(() => {
  if (!bin) return;
  pg=isolatedPostgres(bin); receipt.environment={...pg.environment,version:pg.version};
  pg.sql(read('tests/fixtures/factual-pipeline/phase2-parents.sql'));
  for(const name of ['20260912000100_fantasy_draft_history.sql','20260925000100_nba_projection_observation_foundation.sql',
    '20260925000200_nba_current_observations.sql','20261027000100_nba_observation_semantic_append.sql','20260926000100_nfl_projection_observation_foundation.sql']) {
    pg.sql(read('supabase/migrations/'+name));
  }
  pg.sql(`insert into fantasy_drafts(slate_id,group_id,league_id,sport,participant_ids,roster_slots,rules_snapshot)
    select 90,${quote(group)},${quote(league)},'nba',array[1]::bigint[],'[{"position":"G","index":0}]',rules_snapshot from slates where id=90;
    insert into draft_picks(slate_id,group_id,league_id,sport,overall_pick,round_number,pick_in_round,team_id,player_id,player_name,player_position,team_name,
      roster_slot_position,roster_slot_index,source) values(90,${quote(group)},${quote(league)},'nba',1,1,1,1,1,'Historical saved name','G','Historical fantasy team','G',0,'verified_backfill');
    insert into fixture_saved_scores select 90,1,41.16,rules_snapshot from slates where id=90;
    insert into nba_player_game_observation_versions(provider,provider_player_id,provider_event_id,local_player_id,season,phase,game_at,team_provider_id,
      team_abbreviation,minutes,points,rebounds,assists,steals,blocks,turnovers,source_url,provider_fetched_at,provider_known_at,normalization_version,observation_hash)
      values('espn','1001','990001',1,2027,'regular','2026-10-03Z','1','A',30,10,2,3,1,0,2,'https://sports.example.test/game','2026-10-04Z','2026-10-04Z','fixture',repeat('c',64)),
        ('espn','1001','990004',1,2027,'regular','2026-10-17Z','2','B',30,12,2,3,1,0,2,'https://sports.example.test/game','2026-10-18Z','2026-10-18Z','fixture',repeat('d',64)),
        ('espn','1005','990005',5,2026,'regular','2026-01-03Z','1','A',30,8,2,3,1,0,2,'https://sports.example.test/game','2026-01-04Z','2026-01-04Z','fixture',repeat('e',64));`);
  insertLegacy(nfl('990002',1,10)); insertLegacy(nfl('990003',1,0));
  initialNfl=rowsFor('990002'); initialRecords=sqlJson(oldRecordsSql); initialFunctions=sqlJson(functionsSql);
  preservation={...metadata()};
  assert.throws(()=>pg.sql(read(root+'phase2/01-rosters-and-pools.proposed.sql')),/Reviewed isolated/);
  apply('phase2/01-rosters-and-pools.proposed.sql','rehearsal:rosters_pools_v1');
  apply('nfl-signed-yard-constraints.proposed.sql','reviewed:nfl_signed_yards_v1');
  signed=metadata();
  assert.equal(signed.grants,preservation.grants); assert.equal(signed.view,preservation.view); assert.equal(signed.trigger,preservation.trigger);
  assert.equal(signed.sequenceGrants,preservation.sequenceGrants); assert.equal(signed.viewGrants,preservation.viewGrants);
  assert.deepEqual(signed.constraints,preservation.constraints.filter(([name])=> !['passing_yards','rushing_yards','receiving_yards'].some(k=>name.endsWith(k+'_check'))));
  assert.deepEqual(rowsFor('990002'),initialNfl);
  receipt.signedMigration={removedChecks:3,unrelatedConstraintsUnchanged:true,grantsUnchanged:true,viewUnchanged:true,historyUnchanged:true};
  apply('phase2/02-nfl-semantic-append.proposed.sql','rehearsal:nfl_semantic_v1');
  apply('phase2/03-unused-only-rollback.proposed.sql','rehearsal:unused_rollback_v1');
  assert.deepEqual(metadata(),preservation); assert.deepEqual(rowsFor('990002'),initialNfl);
  assert.deepEqual(sqlJson(oldRecordsSql),initialRecords); assert.deepEqual(sqlJson(functionsSql),initialFunctions);
  receipt.unusedRollback={restoredConstraintsAndGrants:true,legacyIdsAndRecordsPreserved:true};
  // Reapply after rollback. Simulate a deployment failure: the whole proposal
  // runs inside the enclosing transaction and rolls back even after DDL succeeds.
  const rosterProposal=read(root+'phase2/01-rosters-and-pools.proposed.sql').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  assert.throws(()=>pg.sql(`begin;set local sports111.factual_schema_approval='rehearsal:rosters_pools_v1';${rosterProposal}select 1/0;commit;`),/division by zero/);
  assert.equal(pg.sql("select to_regclass('public.professional_player_roster_evidence') is null"),'t');
  apply('phase2/01-rosters-and-pools.proposed.sql','rehearsal:rosters_pools_v1');
  apply('nfl-signed-yard-constraints.proposed.sql','reviewed:nfl_signed_yards_v1');
  apply('phase2/02-nfl-semantic-append.proposed.sql','rehearsal:nfl_semantic_v1');
});
beforeEach(()=> { if(pg) pg.sql('truncate public.slate_player_eligibility,public.slate_player_pool_snapshots,public.professional_player_roster_evidence'); });
after(()=> {
  if(!pg) return;
  try {
    assert.deepEqual(sqlJson(oldRecordsSql),initialRecords); assert.deepEqual(sqlJson(functionsSql),initialFunctions);
    const oldNow=rowsFor('990002').map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['semantic_receipt_id','semantic_ordinal'].includes(k))));
    assert.deepEqual(oldNow,initialNfl);
    receipt.preservation={existingPlayersDraftsScoresNbaVersionsAndCurrentUnchanged:true,existingNflRowsAndIdsUnchanged:true,
      existingDraftRpcDefinitionsUnchanged:true,nbaAppendFingerprint:pg.sql("select md5(replace(prosrc,chr(13)||chr(10),chr(10))) from pg_proc where oid='public.append_nba_projection_observations(jsonb)'::regprocedure")};
    assert.equal(receipt.preservation.nbaAppendFingerprint,'9308a04b52fecc6993b7730490cf686a');
    receipt.storage=[];
    for(const table of ['nfl_player_game_observation_versions','nfl_observation_append_receipts','nfl_observation_append_heads',
      'professional_player_roster_evidence','slate_player_pool_snapshots','slate_player_eligibility']) {
      receipt.storage.push(sqlJson(`select jsonb_build_object('table',${quote(table)},'rows',count(*),'averageTupleBytes',round(avg(pg_column_size(v)),1),
        'totalBytes',pg_total_relation_size(${quote('public.'+table)}::regclass),'heapBytes',pg_relation_size(${quote('public.'+table)}::regclass),
        'indexBytes',pg_indexes_size(${quote('public.'+table)}::regclass)) from public.${table} v`));
    }
    if(process.env.FACTUAL_PIPELINE_REHEARSAL_RECEIPT) fs.writeFileSync(process.env.FACTUAL_PIPELINE_REHEARSAL_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  } finally {pg.close();}
});

isolated('confirmed trade and two trades retain bounded half-open intervals',()=>{
  save(evidence(1,{effective_to:'2026-10-07Z'}));
  save(evidence(1,{effective_from:'2026-10-07Z',effective_to:'2026-10-14Z',team_provider_id:'2',team_abbreviation:'B'}));
  save(evidence(1,{effective_from:'2026-10-14Z',team_provider_id:'3',team_abbreviation:'C'}));
  for(const [at,team] of [['2026-10-06Z','1'],['2026-10-07Z','2'],['2026-10-14Z','3']]) assert.equal(resolve(1,at).claim.team_provider_id,team);
  assert.equal(pg.sql('select count(distinct player_id) from professional_player_roster_evidence'),'1');
});
isolated('release and re-sign preserve an unrostered gap',()=>{
  save(evidence(2,{effective_to:'2026-10-07Z'}));
  save(evidence(2,{effective_from:'2026-10-07Z',effective_to:'2026-10-14Z',roster_status:'unrostered',team_provider:null,team_provider_id:null,team_abbreviation:null,position:null}));
  save(evidence(2,{effective_from:'2026-10-14Z',team_provider_id:'2'}));
  assert.equal(resolve(2,'2026-10-10Z').state,'unrostered'); assert.equal(resolve(2,'2026-10-14Z').claim.team_provider_id,'2');
});
isolated('season rollover, zero appearances and historical-only membership are independent',()=>{
  save(evidence(3,{season:2026,effective_from:'2025-10-01Z',effective_to:'2026-06-01Z',verified_through:'2026-06-01Z'}));
  save(evidence(3,{team_provider_id:'2'})); save(evidence(4));
  save(evidence(5,{season:2026,effective_from:'2025-10-01Z',effective_to:'2026-06-01Z',verified_through:'2026-06-01Z'}));
  assert.equal(resolve(3,'2026-02-01Z',2026).claim.team_provider_id,'1'); assert.equal(resolve(3,'2026-10-10Z').claim.team_provider_id,'2');
  assert.equal(resolve(4,'2026-10-10Z').state,'rostered'); assert.equal(resolve(5,'2026-10-10Z').state,'unresolved');
  assert.equal(pg.sql('select count(*) from nba_player_game_observation_versions where local_player_id in (3,4)'),'0');
  assert.equal(pg.sql('select count(*) from nba_player_game_observation_versions where local_player_id=5 and season=2026'),'1');
  assert.equal(pg.sql('select count(*) from nba_player_game_observation_versions where local_player_id=5 and season=2027'),'0');
});
isolated('snapshots never invent transaction dates; conflicts and uncertain evidence remain unresolved',()=>{
  save(evidence(1,{evidence_type:'snapshot',effective_from:null,observed_at:'2026-10-05Z',verified_through:'2026-10-05Z',sources:[{url:'https://sports.example.test/roster',sha256:'a'.repeat(64),captured_at:'2026-10-05Z'}]}));
  save(evidence(1,{evidence_type:'snapshot',effective_from:null,team_provider_id:'2'}));
  assert.equal(resolve(1,'2026-10-10Z').state,'unresolved');
  save(evidence(6)); save(evidence(6,{team_provider_id:'2'})); assert.equal(resolve(6,'2026-10-10Z').state,'conflict');
  save(evidence(2,{confidence:'uncertain'})); assert.equal(resolve(2,'2026-10-10Z').state,'unresolved');
});
isolated('receipt replay, supersession and actual database knowledge cutoffs preserve old evidence',()=>{
  const e=evidence(); save(e); save(e);
  assert.equal(pg.sql('select count(*) from professional_player_roster_evidence'),'1');
  assert.throws(()=>save({...e,team_provider_id:'2'}),/reused/);
  const cutoff=pg.sql('select clock_timestamp()'); save(evidence(1,{team_provider_id:'2',supersedes_id:e.id}));
  assert.equal(resolve(1,'2026-10-10Z',2027,quote(cutoff)).claim.team_provider_id,'1');
  assert.equal(resolve(1,'2026-10-10Z').claim.team_provider_id,'2');
  assert.equal(resolve(1,'2026-10-10Z',2027,"'2026-10-21Z'").state,'unresolved');
  assert.throws(()=>pg.sql(`update professional_player_roster_evidence set position='C' where id=${quote(e.id)}`),/immutable/);
});
isolated('game-level historical team evidence is unchanged by later roster transactions',()=>{
  save(evidence()); save(evidence(1,{effective_from:'2026-10-10Z',team_provider_id:'2'}));
  assert.equal(pg.sql("select team_provider_id from nba_player_game_current_observations where provider_event_id='990001'"),'1');
  assert.equal(pg.sql("select team_abbreviation from nba_player_game_observation_versions where provider_event_id='990001'"),'A');
  assert.equal(pg.sql("select string_agg(team_provider_id,',' order by game_at) from nba_player_game_current_observations where local_player_id=1"),'1,2');
});
isolated('frozen unlocked and locked pools retain all members, positions, teams and optional On Slate',()=>{
  rosterBaseline(); const cutoff=pg.sql('select clock_timestamp()');
  sqlJson(freezeSql(1,quote(cutoff))); sqlJson(freezeSql(2,quote(cutoff)));
  const before=pool(1),lockedBefore=pool(2); assert.equal(before.players.length,5); assert.ok(before.players.some(p=>p.player_id===4));
  assertFrozenPoolScope(before,{slateId:1,groupId:group,leagueId:league,sport:'nba'});
  pg.sql('update slates set is_locked=true where id=2');
  save(evidence(1,{team_provider_id:'2',position:'F/C'}));
  assert.deepEqual(pool(1),before); assert.deepEqual(pool(2),lockedBefore);
  assert.deepEqual(sqlJson(freezeSql(1,quote(cutoff))),before.header);
  assert.throws(()=>pg.sql('update slate_player_eligibility set on_slate=false where slate_id=1'),/immutable/);
  assert.throws(()=>pg.sql("update slates set start_date='2026-10-04' where id=1"),/Frozen/);
  assert.throws(()=>pg.sql(`update leagues set sport_key='nfl' where id=${quote(league)}`),/Group\/sport ownership/);
  assert.throws(()=>pg.sql(`select public.propose_freeze_slate_pool(1,${quote(group)},${quote(league)},'nba',2026,'2026-10-05Z',${quote(cutoff)},'[]')`),/parameters differ/);
});
isolated('On Slate false does not remove otherwise eligible players',()=>{
  rosterBaseline(); pg.sql(`select public.propose_freeze_slate_pool(3,${quote(group)},${quote(league)},'nba',2027,'2026-10-05Z',clock_timestamp(),'[]')`);
  assert.equal(pool(3).players.length,5); assert.ok(pool(3).players.every(p=>!p.on_slate));
  assert.throws(()=>pg.sql("insert into slate_player_eligibility(slate_id,sport,nba_player_id,nfl_player_id,entity_kind,saved_position,team_provider,team_provider_id,saved_team_abbreviation,on_slate,roster_evidence_id) select slate_id,sport,nba_player_id,nfl_player_id,entity_kind,saved_position,team_provider,team_provider_id,saved_team_abbreviation,on_slate,roster_evidence_id from slate_player_eligibility where slate_id=3 limit 1"),/late members/);
});
isolated('legacy locked or populated slates are explicit review cases, never reconstructed',()=>{
  rosterBaseline(); assert.deepEqual(pool(90),{state:'legacy_requires_review'});
  assert.throws(()=>pg.sql(freezeSql(90)),/Legacy\/populated/);
  pg.sql('update slates set is_locked=true where id=91');
  assert.throws(()=>pg.sql(freezeSql(91)),/Legacy\/populated/);
  assert.equal(pg.sql('select count(*) from slate_player_pool_snapshots'),'0');
});
isolated('incomplete catalogs, wrong Group and a late failure leave no partial header/membership',()=>{
  save(evidence()); assert.throws(()=>pg.sql(freezeSql(4)),/Incomplete eligibility/);
  assert.equal(pg.sql('select count(*) from slate_player_eligibility'),'0');
  rosterBaseline();
  assert.throws(()=>pg.sql(`select public.propose_freeze_slate_pool(4,'00000000-0000-0000-0000-000000000099',${quote(league)},'nba',2027,'2026-10-05Z',clock_timestamp(),'[]')`),/outside/);
  assert.throws(()=>pg.sql(`begin;${freezeSql(4)};select 1/0;commit;`),/division by zero/);
  assert.equal(pg.sql('select count(*) from slate_player_pool_snapshots'),'0');
});
isolated('concurrent roster writes replay once and frozen-pool writers serialize under the slate lock',async()=>{
  const e=evidence(); const cmd=`select public.propose_append_roster_evidence(${json(e)})`;
  await Promise.all([pg.asyncSql(cmd),pg.asyncSql(cmd)]);
  assert.equal(pg.sql('select count(*) from professional_player_roster_evidence'),'1');
  for(let i=2;i<=6;i++) save(evidence(i));
  const cutoff=pg.sql('select clock_timestamp()');
  const results=await Promise.all([pg.asyncSql(`begin;${freezeSql(5,quote(cutoff))};select pg_sleep(0.15);commit;`),pg.asyncSql(freezeSql(5,quote(cutoff)))]);
  assert.equal(results.length,2); assert.equal(pg.sql('select count(*) from slate_player_pool_snapshots'),'1');
  assert.equal(pool(5).players.length,6);
  // Evidence write waits behind an in-progress admission SHARE lock, then cannot
  // change the committed pool. A fixed knowledge cutoff excludes the later claim.
  const c2=pg.sql('select clock_timestamp()');
  await Promise.all([pg.asyncSql(`begin;lock table professional_player_roster_evidence in share mode;${freezeSql(6,quote(c2))};select pg_sleep(0.15);commit;`),
    pg.asyncSql(`select public.propose_append_roster_evidence(${json(evidence(1,{team_provider_id:'9'}))})`)]);
  assert.equal(pool(6).players.find(p=>p.player_id===1).team_provider_id,'1');
});
isolated('NFL K limits and synthetic team defenses use existing IDs and frozen canonical slots',()=>{
  for(const id of [101,102,103,104]) save(evidence(id,{position: id===101?'RB':id===102?'QB':id===103?'K':'D/ST',entity_kind:id===104?'team_defense':'athlete'}));
  sqlJson(freezeSql(200,'clock_timestamp()','nfl'));
  assert.equal(pg.sql('select string_agg(player_id::text,\',\' order by player_id) from slate_player_eligibility where slate_id=200'),'101,102');
  assert.throws(()=>save(evidence(104,{entity_kind:'athlete'})),/synthetic/);
  assert.throws(()=>save(evidence(104,{entity_kind:'team_defense',position:'D/ST',team_provider_id:'2'})),/synthetic/);
});
isolated('RLS, grants, restrictive identity FKs and caller permissions fail closed',()=>{
  assert.equal(pg.sql("select bool_and(relrowsecurity) from pg_class where oid=any(array['professional_player_roster_evidence'::regclass,'slate_player_pool_snapshots'::regclass,'slate_player_eligibility'::regclass,'nfl_observation_append_receipts'::regclass,'nfl_observation_append_heads'::regclass])"),'t');
  assert.equal(pg.sql("select bool_and(convalidated) from pg_constraint where conrelid=any(array['professional_player_roster_evidence'::regclass,'slate_player_pool_snapshots'::regclass,'slate_player_eligibility'::regclass,'nfl_observation_append_receipts'::regclass,'nfl_observation_append_heads'::regclass])"),'t');
  assert.equal(pg.sql("select has_table_privilege('service_role','nfl_player_game_observation_versions','INSERT')"),'f');
  for(const role of ['anon','authenticated','service_role']) {
    assert.throws(()=>pg.sql(`set role ${role};select propose_append_roster_evidence(${json(evidence())})`),/permission denied/);
    assert.throws(()=>pg.sql(`set role ${role};${appendSql([nfl('991001')])}`),/permission denied/);
    assert.throws(()=>pg.sql(`set role ${role};${freezeSql(7)}`),/permission denied/);
  }
  assert.throws(()=>save(evidence(999,{sport:'nba',nba_player_id:999,nfl_player_id:null,position:'G',season:2027})),/foreign key/);
  assert.throws(()=>save(evidence(999)),/Unknown permanent/); save(evidence());
  save(evidence(4)); assert.throws(()=>pg.sql('delete from players where id=4'),/foreign key/);
  const e1=pg.sql('select id from professional_player_roster_evidence where player_id=1');
  const membership=`insert into slate_player_eligibility(slate_id,sport,nba_player_id,entity_kind,saved_position,team_provider,team_provider_id,on_slate,roster_evidence_id)
    values(10,'nba',2,'athlete','G','espn','1',false,${quote(e1)})`;
  assert.throws(()=>pg.sql(membership),/foreign key/); // Evidence belongs to player 1, not 2.
  assert.throws(()=>pg.sql(membership.replace("values(10,'nba',2,","values(10,'nba',1,")),/foreign key/); // No final header: deferred FK fails at commit.
  assert.equal(pg.sql('select count(*) from slate_player_eligibility'),'0');
  assert.throws(()=>pg.sql('delete from players where id=1'),/foreign key/);
  assert.throws(()=>pg.sql('delete from professional_player_roster_evidence'),/immutable/);
});
isolated('Allgeier documented -1 and all three signed yard categories persist; counts stay nonnegative',()=>{
  const row=normalizeEspnNflGameLog(allgeier,{espnPlayerId:'4373626',season:2026,position:'RB',fetchedAt:'2026-10-01T12:00:00Z'}).observations[0];
  const actual=observationRecordFromNflObservation(buildNflObservation({gameLog:row,eligible:[{localPlayerId:101,providerPlayerId:'4373626',position:'RB'}],
    finalEvents:[{providerEventId:row.eventId,season:2026,phase:'regular',completed:true}],fumbles:[],knownAt:'2026-10-01T12:00:00Z',normalizationVersion:'espn_nfl_gamelog_fumbles_v1'}));
  assert.equal(actual.provider_event_id,'401872958'); assert.equal(actual.rushing_yards,-1); assert.equal(actual.rushing_attempts,2);
  append([actual]); assert.equal(rowsFor('401872958')[0].rushing_yards,-1);
  const signedRow=nfl('992001',1,-1,{passing_yards:-3,receiving_yards:-4}); append([signedRow]);
  assert.equal(rowsFor('992001')[0].passing_yards,-3); assert.equal(rowsFor('992001')[0].receiving_yards,-4);
  for(const field of ['completions','passing_attempts','passing_touchdowns','interceptions','rushing_attempts','rushing_touchdowns','receiving_targets','receptions','receiving_touchdowns','fumbles_lost']) {
    const bad={...signedRow,provider_event_id:'992002',[field]:-1}; assert.throws(()=>append([bad]),/check constraint/);
  }
  assert.equal(rowsFor('992002').length,0); assert.equal(rowsFor('990003')[0].rushing_yards,0);
  assert.throws(()=>insertLegacy({...nfl('992003'),semantic_receipt_id:crypto.randomUUID(),semantic_ordinal:null}),/check constraint/);
});
isolated('NFL A to B to A preserves three transitions with original fact hashes and correct latest/as-of reads',()=>{
  const a=nfl('993001',1,10),b=nfl('993001',2,11),again=nfl('993001',3,10);
  assert.equal(a.observation_hash,again.observation_hash);
  assert.equal(append([again,a,b]).appended_this_call,3);
  const versions=rowsFor('993001'); assert.deepEqual(versions.map(v=>v.rushing_yards),[10,11,10]);
  for(const [cutoff,yards] of [['2026-10-02T00:00:00Z',10],['2026-10-03T00:00:00Z',11],['2026-10-04T00:00:00Z',10]]) {
    assert.equal(Number(pg.sql(`select rushing_yards from nfl_player_game_observation_versions where provider_event_id='993001' and known_at<=${quote(cutoff)} order by known_at desc,game_log_fetched_at desc,id desc limit 1`)),yards);
    assert.equal(selectNflAsOfObservationVersions({rows:versions,playerId:101,targetSeason:2026,asOf:cutoff})[0].rushing_yards,yards);
  }
  assert.equal(pg.sql("select rushing_yards from nfl_player_game_observations where provider_event_id='993001'"),'10');
  assert.throws(()=>pg.sql("update nfl_player_game_observation_versions set rushing_yards=0 where provider_event_id='993001'"),/immutable/);
});
isolated('repeated identical NFL facts append zero; receipt replay is immutable and exact',()=>{
  const id=crypto.randomUUID(),a=nfl('993002'); assert.equal(append([a],id).appended_this_call,1);
  assert.equal(append([a],id).replayed,true); assert.equal(append([a],id).appended_this_call,0);
  assert.throws(()=>append([nfl('993002',2)],id),/reused/);
  for(let day=2;day<=12;day++) assert.equal(append([nfl('993002',day)]).appended_this_call,0);
  assert.equal(append([nfl('993002',13,10,{normalization_version:'label_only_v2',game_log_source_url:'https://sports.example.test/new-url'})]).appended_this_call,0);
  assert.equal(rowsFor('993002').length,1);
});
isolated('out-of-order, tied conflicting and invalid late rows reject atomically including receipt and head',()=>{
  append([nfl('993003',5)]); append([nfl('993003',10)]);
  assert.throws(()=>append([nfl('993003',7,11)]),/Out-of-order/);
  assert.throws(()=>append([nfl('993003',10,11)]),/ambiguous/);
  assert.throws(()=>append([nfl('993003',9,11,{known_at:'2026-10-11T12:00:00Z',fumble_summary_source_url:'https://sports.example.test/summary',fumble_summary_fetched_at:'2026-10-11T12:00:00Z'})]),/Out-of-order/);
  const id=crypto.randomUUID();
  assert.throws(()=>append([nfl('993004',1),{...nfl('993004',2,11),receptions:-1}],id),/check constraint/);
  assert.equal(rowsFor('993004').length,0);
  assert.equal(pg.sql(`select count(*) from nfl_observation_append_receipts where id=${quote(id)}`),'0');
  assert.equal(pg.sql("select count(*) from nfl_observation_append_heads where provider_event_id='993004'"),'0');
  assert.throws(()=>append([{...nfl('993003',11),observation_hash:null}]),/provenance/);
});
isolated('NFL unknown, explicit zero and positive fumbles remain distinct immutable facts',()=>{
  append([nfl('993006',1,10,{fumbles_lost:null}),nfl('993006',2,10,{fumbles_lost:0}),nfl('993006',3,10,{fumbles_lost:1})]);
  assert.deepEqual(rowsFor('993006').map(v=>v.fumbles_lost),[null,0,1]);
});
isolated('concurrent NFL same-receipt replay and overlapping workers produce one transition each',async()=>{
  const row=nfl('993005'),id=crypto.randomUUID();
  const same=await Promise.all([pg.asyncSql(appendSql([row],id)),pg.asyncSql(appendSql([row],id))]);
  assert.deepEqual(same.map(s=>JSON.parse(s).appended_this_call).sort(),[0,1]);
  const b=nfl('993005',2,11);
  const more=await Promise.all([pg.asyncSql(appendSql([b])),pg.asyncSql(appendSql([b]))]);
  assert.deepEqual(more.map(s=>JSON.parse(s).appended_this_call).sort(),[0,1]);
  const a=nfl('993005',3,10); await Promise.all([pg.asyncSql(appendSql([a])),pg.asyncSql(appendSql([a]))]);
  assert.deepEqual(rowsFor('993005').map(v=>v.rushing_yards),[10,11,10]);
});
isolated('legacy positive/zero rows and IDs survive new corrections without rewriting history',()=>{
  const original=rowsFor('990003')[0]; assert.equal(append([nfl('990003',2,1),nfl('990003',3,0)]).appended_this_call,2);
  assert.deepEqual(rowsFor('990003')[0],original);
  assert.equal(pg.sql("select rushing_yards from nfl_player_game_observations where provider_event_id='990003'"),'0');
});
isolated('rollback after new usage refuses without deleting any historical record',()=>{
  const before=rowsFor('993001');
  assert.throws(()=>apply('phase2/03-unused-only-rollback.proposed.sql','rehearsal:unused_rollback_v1'),/rollback refused/);
  assert.deepEqual(rowsFor('993001'),before); assert.deepEqual(sqlJson(oldRecordsSql),initialRecords);
  rosterBaseline(); sqlJson(freezeSql(8)); // Leave representative roster/pool rows for physical-size receipt.
});

isolated('bounded 600 NBA / 1000 NFL fixture catalogs freeze complete pools without appearance or active-flag inference',()=>{
  const addedNba=594,addedNfl=996;
  try {
    pg.sql(`insert into players select 10000+i,50000+i,'Scale NBA '||i,'G','OLD',true from generate_series(1,${addedNba}) i;
      insert into players_nfl select 10000+i,80000+i,'Scale NFL '||i,'RB','OLD',true from generate_series(1,${addedNfl}) i;`);
    rosterBaseline();
    for(const id of [101,102,103,104]) save(evidence(id,{position:id===101?'RB':id===102?'QB':id===103?'K':'D/ST',entity_kind:id===104?'team_defense':'athlete'}));
    for(const [sport,n] of [['nba',addedNba],['nfl',addedNfl]]) {
      const base=evidence(sport==='nba'?1:101);
      pg.sql(`select public.propose_append_roster_evidence(${json(base)}||jsonb_build_object('id',gen_random_uuid(),
        ${quote(sport==='nba'?'nba_player_id':'nfl_player_id')},10000+i)) from generate_series(1,${n}) i;`);
    }
    const started=performance.now(); sqlJson(freezeSql(9)); const nbaMs=performance.now()-started;
    const nflStarted=performance.now(); sqlJson(freezeSql(200,'clock_timestamp()','nfl')); const nflMs=performance.now()-nflStarted;
    assert.equal(pool(9).players.length,599);
    assert.equal(pg.sql('select count(*) from slate_player_eligibility where slate_id=200'),'998');
    receipt.scale={fixtureOnly:true,nbaCatalog:600,nflCatalog:1000,nbaPool:599,nflPool:998,
      admissionWallMilliseconds:{nba:Math.round(nbaMs),nfl:Math.round(nflMs)},includesPsqlOverhead:true,tables:[]};
    for(const table of ['professional_player_roster_evidence','slate_player_pool_snapshots','slate_player_eligibility']) {
      receipt.scale.tables.push(sqlJson(`select jsonb_build_object('table',${quote(table)},'rows',count(*),'averageTupleBytes',round(avg(pg_column_size(v)),1),
        'totalBytes',pg_total_relation_size(${quote('public.'+table)}::regclass),'indexBytes',pg_indexes_size(${quote('public.'+table)}::regclass)) from public.${table} v`));
    }
  } finally {
    pg.sql('truncate slate_player_eligibility,slate_player_pool_snapshots,professional_player_roster_evidence;delete from players where id>=10000;delete from players_nfl where id>=10000');
  }
});

test('repository contracts preserve sport namespaces, team entities and explicit legacy review',()=>{
  assert.deepEqual(rosterIdentityColumns({sport:'nba',playerId:101,kind:'athlete'}),{sport:'nba',nba_player_id:101,nfl_player_id:null,entity_kind:'athlete'});
  assert.deepEqual(rosterIdentityColumns({sport:'nfl',playerId:101,kind:'athlete'}),{sport:'nfl',nba_player_id:null,nfl_player_id:101,entity_kind:'athlete'});
  assert.throws(()=>rosterIdentityColumns({sport:'nba',playerId:1,kind:'team_defense'}),/identity/);
  assert.throws(()=>assertFrozenPoolScope({state:'legacy_requires_review'},{slateId:90,groupId:group,leagueId:league,sport:'nba'}),/compatibility review/);
});
