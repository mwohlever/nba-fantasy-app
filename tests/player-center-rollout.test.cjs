/* eslint-disable @typescript-eslint/no-require-imports */
// SQL executes ONLY against a new Unix-socket-only temporary PostgreSQL cluster.
// No Supabase client, .env loader, production DSN or network listener is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {test,before,after,beforeEach}=require('node:test');
const {mappingPlan,mappingFiles,registerTypescript,quote}=require('../scripts/lib/playerCenterRollout.cjs');
registerTypescript();
const {buildBatch,batchFiles}=require('../scripts/lib/playerCenterNbaBatch.cjs');
const root=path.resolve(__dirname,'..'),bundle=path.join(root,'supabase/manual/player-center/20261023-review');
const snapshot=JSON.parse(fs.readFileSync(path.join(bundle,'review-snapshot.json'))),audit=require('../data/player-center/nba-identity-audit.json');
const plan=mappingPlan(audit,snapshot),canary=require('../supabase/manual/player-center/20261023-canary/batch-manifest.json');
const acquired=require('../supabase/manual/player-center/20261023-canary/provider-acquisition.json');
const bin=process.env.PLAYER_CENTER_PG_BIN;let dir,socket,env,receipt,files;
const pgtest=(name,fn)=>test(name,{skip:!bin&&'Set PLAYER_CENTER_PG_BIN to isolated PostgreSQL binaries'},fn);
function tool(name,args,input){return execFileSync(path.join(bin,name),args,{env,cwd:receipt??dir,encoding:'utf8',input,stdio:['pipe','pipe','pipe']});}
function sql(text){return tool('psql',['-X','-q','-At','-h',socket,'-p','55447','-U','pc_test','-d','postgres','-v','ON_ERROR_STOP=1','-f','-'],text).trim();}
function runFile(file,approval='',backup=plan.snapshotSha256){return sql(`set sports111.rollout_approval=${quote(approval)};set sports111.backup_receipt=${quote(backup)};\n\\i ${file}\n`);}
function writeFiles(name,contents){const out=path.join(dir,name);fs.mkdirSync(out);for(const[n,s]of Object.entries(contents))fs.writeFileSync(path.join(out,n),s);return out;}
function applyMappings(){return runFile(path.join(files,'02-apply-mappings.sql'),`apply:${plan.manifestSha256}`);}
function cacheSchema(){return runFile(path.join(root,'supabase/manual/player-center/season-cache-v1.sql'),'schema:player-center-season-cache-v1');}
function buildCopy(input,before=[]){return buildBatch(plan,input,before);}

test('all 98 mappings have exact before/after targets and two independent matching provider sources',()=>{
  assert.deepEqual(plan,JSON.parse(fs.readFileSync(path.join(bundle,'mapping-manifest.json'))));
  assert.equal(plan.targets.length,98);assert.equal(plan.unresolved.length,65);assert.equal(plan.universe.length,465);
  const team=value=>({GS:'GSW',NO:'NOP',NY:'NYK',SA:'SAS',UTAH:'UTA',WSH:'WAS'})[value]??value;
  for(const t of plan.targets){assert.equal(t.identityBefore,null);assert.deepEqual(t.localBefore,t.localAfter);assert.ok(t.evidence.nativeSource.startsWith('https://stats.nba.com/'));assert.ok(t.evidence.espn.source.startsWith('https://site.api.espn.com/'));assert.equal(team(t.evidence.native.team),team(t.evidence.espn.team));}
  const bad=structuredClone(snapshot);bad.native.find(p=>p.nbaPlayerId===plan.targets[0].localBefore.nba_player_id).team='INVALID';
  assert.throws(()=>mappingPlan(audit,bad),/teams disagree/);
});
test('stage builder rejects season/identity mistakes and preserves unknown coverage',()=>{
  assert.deepEqual(buildCopy(acquired),canary);
  const bad=structuredClone(acquired);bad[0].providerPlayerId='999';assert.throws(()=>buildCopy(bad),/identity mismatch/);
  const wrong=structuredClone(acquired);wrong[0].log.filters.find(f=>f.name==='season').value='2026';assert.throws(()=>buildCopy(wrong),/season mismatch/);
  const missing=structuredClone(acquired);missing[0].stats.categories=[];
  const staged=buildCopy(missing);assert.equal(staged.cache[0].complete,false);assert.equal(staged.cache[0].expected_games,null);
  assert.ok(staged.cache[0].issues.includes('independent_gp_unknown'));
});
before(()=>{
  if(!bin)return;
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-rollout-pg-'));socket=path.join(dir,'socket');fs.mkdirSync(socket);
  env={...process.env,PGHOST:socket,PGHOSTADDR:'',PGSERVICE:'',PGSERVICEFILE:'',PGOPTIONS:'',PGPORT:'55447',PGUSER:'pc_test',PGDATABASE:'postgres',PGPASSWORD:'',PGSSLMODE:'disable',LD_LIBRARY_PATH:[path.resolve(bin,'../../../x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
  delete env.PGSERVICE;delete env.PGSERVICEFILE;
  tool('initdb',['-D',path.join(dir,'data'),'-L',path.resolve(bin,'../../../../share/postgresql',tool('postgres',['--version']).match(/PostgreSQL\) (\d+)/)[1]),'--auth=trust','--username=pc_test','--no-locale','--encoding=UTF8']);
  tool('pg_ctl',['-D',path.join(dir,'data'),'-l',path.join(dir,'postgres.log'),'-o',`-k ${socket} -p 55447 -c listen_addresses='' -c jit=off`,'-w','start']);
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create table players(id bigint primary key,name text,nba_player_id bigint,team_abbreviation text,is_active boolean,position_group text);
    create table players_nfl(id bigint primary key,name text,nfl_player_id text,position text,is_active boolean);
    create table lineup_sentinel(id int primary key,score int);insert into lineup_sentinel values(1,111);`);
  sql(fs.readFileSync(path.join(root,'supabase/migrations/20260925000100_nba_projection_observation_foundation.sql'),'utf8'));
  sql(fs.readFileSync(path.join(root,'supabase/migrations/20260925000200_nba_current_observations.sql'),'utf8'));
  files=writeFiles('mappings',mappingFiles(plan,snapshot));
});
beforeEach(()=>{
  if(!bin)return;
  receipt=fs.mkdtempSync(path.join(dir,'receipt-'));
  sql(`drop table if exists player_center_season_cache;
    truncate nba_player_game_current_observations,nba_player_game_observation_versions,nba_projection_stat_cache,nba_player_provider_identities,players restart identity cascade;
    insert into players select * from jsonb_populate_recordset(null::players,${quote(JSON.stringify(snapshot.players))}::jsonb);
    insert into nba_player_provider_identities select * from jsonb_populate_recordset(null::nba_player_provider_identities,${quote(JSON.stringify(snapshot.identities))}::jsonb);`);
});
after(()=>{if(!dir)return;receipt=dir;try{if(fs.existsSync(path.join(dir,'data/postmaster.pid')))tool('pg_ctl',['-D',path.join(dir,'data'),'-m','immediate','-w','stop']);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

pgtest('mapping approval/backup guards fail closed before permanent mutations',()=>{
  assert.throws(()=>runFile(path.join(files,'02-apply-mappings.sql')),/Missing exact reviewed operation approval/);
  assert.throws(()=>runFile(path.join(files,'02-apply-mappings.sql'),`apply:${plan.manifestSha256}`,'wrong'),/backup receipt/);
  assert.equal(sql('select count(*) from nba_player_provider_identities'),'367');
});
pgtest('preflight backups, atomic 98 inserts, replay, post-receipt and pre-ingest rollback are executable',()=>{
  runFile(path.join(files,'01-preflight-and-backup.sql'));assert.ok(fs.existsSync(path.join(receipt,'nba-identities-before.csv')));
  applyMappings();assert.equal(sql('select count(*) from nba_player_provider_identities'),'465');
  const first=sql('select jsonb_agg(i order by provider_player_id) from nba_player_provider_identities i');
  applyMappings();assert.equal(sql('select jsonb_agg(i order by provider_player_id) from nba_player_provider_identities i'),first);
  runFile(path.join(files,'03-postflight-and-receipt.sql'));
  runFile(path.join(files,'04-rollback-mappings.sql'),`rollback-mappings:${plan.manifestSha256}`);
  runFile(path.join(files,'04-rollback-mappings.sql'),`rollback-mappings:${plan.manifestSha256}`);
  assert.equal(sql('select count(*) from nba_player_provider_identities'),'367');assert.equal(sql('select score from lineup_sentinel'),'111');
});
pgtest('mapping conflict or local native-ID drift aborts the whole insert',()=>{
  const t=plan.targets[0];sql(`update players set nba_player_id=999999 where id=${t.localBefore.id}`);
  assert.throws(applyMappings,/Player catalog drift/);assert.equal(sql('select count(*) from nba_player_provider_identities'),'367');
});
pgtest('a provider ID claimed by another player is preserved and blocks every planned insert',()=>{
  const t=plan.targets[0],other=plan.unresolved[0];
  sql(`insert into nba_player_provider_identities(provider,provider_player_id,player_id,resolution_status,resolution_method,evidence,is_locked) values('espn',${quote(t.identityAfter.provider_player_id)},${other.playerId},'resolved','reviewed_provider_evidence','external change',true)`);
  assert.throws(applyMappings,/Target ID claimed or changed/);
  assert.equal(sql('select count(*) from nba_player_provider_identities'),'368');
  assert.equal(sql(`select player_id from nba_player_provider_identities where provider_player_id=${quote(t.identityAfter.provider_player_id)}`),String(other.playerId));
});
pgtest('rollback refuses edited mappings and never discards the other 97 inserts',()=>{
  applyMappings();runFile(path.join(files,'03-postflight-and-receipt.sql'));
  sql(`update nba_player_provider_identities set is_locked=false where provider_player_id=${quote(plan.targets[0].identityAfter.provider_player_id)}`);
  assert.throws(()=>runFile(path.join(files,'04-rollback-mappings.sql'),`rollback-mappings:${plan.manifestSha256}`),/Target ID claimed or changed/);
  assert.equal(sql('select count(*) from nba_player_provider_identities'),'465');
});
pgtest('mapping rollback refuses a dependent projection cache rather than erasing evidence',()=>{
  applyMappings();runFile(path.join(files,'03-postflight-and-receipt.sql'));
  sql(`insert into nba_projection_stat_cache(player_id,model_version,as_of,generated_at,projected_stats,projected_participation,confidence,sample) values(${plan.targets[0].localBefore.id},'test',now(),now(),'{}','{}','low','{}')`);
  assert.throws(()=>runFile(path.join(files,'04-rollback-mappings.sql'),`rollback-mappings:${plan.manifestSha256}`),/Dependent evidence/);
  assert.equal(sql('select count(*) from nba_player_provider_identities'),'465');
});
pgtest('proposed schema is additive/idempotent and grants service-role SELECT only',()=>{
  assert.throws(()=>runFile(path.join(root,'supabase/manual/player-center/season-cache-v1.sql')),/Missing schema approval/);
  cacheSchema();cacheSchema();
  assert.equal(sql("select has_table_privilege('service_role','player_center_season_cache','SELECT'),has_table_privilege('service_role','player_center_season_cache','INSERT'),has_table_privilege('anon','player_center_season_cache','SELECT')"),'t|f|f');
  assert.equal(sql("select relrowsecurity from pg_class where oid='player_center_season_cache'::regclass"),'t');
});
pgtest('canary inserts two observations and one cache atomically; exact replay creates no duplicates',()=>{
  cacheSchema();const out=writeFiles('canary-'+Date.now(),batchFiles(plan,canary));
  assert.throws(()=>runFile(path.join(out,'01-apply-batch.sql')),/Missing exact reviewed operation approval/);
  runFile(path.join(out,'01-apply-batch.sql'),`ingest:${canary.batchSha256}`);
  runFile(path.join(out,'01-apply-batch.sql'),`ingest:${canary.batchSha256}`);
  runFile(path.join(out,'02-postflight.sql'));
  assert.equal(sql('select count(*) from nba_player_game_observation_versions'),'2');
  assert.equal(sql('select count(*),bool_and(complete) from player_center_season_cache'),'1|t');
  assert.equal(sql('select count(*) from nba_projection_stat_cache'),'0');assert.equal(sql('select score from lineup_sentinel'),'111');
});
pgtest('fresh re-acquisition of identical facts updates coverage without timestamp-only versions',()=>{
  cacheSchema();const out=writeFiles('initial-'+Date.now(),batchFiles(plan,canary));runFile(path.join(out,'01-apply-batch.sql'),`ingest:${canary.batchSha256}`);
  const before=JSON.parse(sql('select jsonb_agg(c) from player_center_season_cache c')),nextInput=structuredClone(acquired);
  nextInput[0].fetchedAt=new Date(Date.parse(acquired[0].checkedAt)+60000).toISOString();nextInput[0].checkedAt=new Date(Date.parse(nextInput[0].fetchedAt)+1000).toISOString();
  const next=buildCopy(nextInput,before),nextOut=writeFiles('recheck-'+Date.now(),batchFiles(plan,next));
  runFile(path.join(nextOut,'01-apply-batch.sql'),`ingest:${next.batchSha256}`);
  assert.equal(sql('select count(*) from nba_player_game_observation_versions'),'2');
  assert.equal(sql('select rollout_batch_id from player_center_season_cache'),next.batchId);
});
pgtest('corrections append a version; cache withdrawal retains all immutable evidence',()=>{
  cacheSchema();const out=writeFiles('before-correction-'+Date.now(),batchFiles(plan,canary));runFile(path.join(out,'01-apply-batch.sql'),`ingest:${canary.batchSha256}`);
  const before=JSON.parse(sql('select jsonb_agg(c) from player_center_season_cache c')),nextInput=structuredClone(acquired),p=nextInput[0];
  const row=p.log.seasonTypes.find(t=>t.displayName.includes('Regular Season')).categories[0].events[0];row.stats[p.log.names.indexOf('points')]=String(Number(row.stats[p.log.names.indexOf('points')])+1);
  p.fetchedAt=new Date(Date.parse(p.checkedAt)+60000).toISOString();p.checkedAt=new Date(Date.parse(p.fetchedAt)+1000).toISOString();
  const next=buildCopy(nextInput,before),nextOut=writeFiles('correction-'+Date.now(),batchFiles(plan,next));runFile(path.join(nextOut,'01-apply-batch.sql'),`ingest:${next.batchSha256}`);
  assert.equal(sql('select count(*) from nba_player_game_observation_versions'),'3');
  assert.throws(()=>runFile(path.join(out,'03-rollback-cache-only.sql'),`rollback-cache:${canary.batchSha256}`),/Cache changed after this batch/);
  runFile(path.join(nextOut,'03-rollback-cache-only.sql'),`rollback-cache:${next.batchSha256}`);
  runFile(path.join(nextOut,'03-rollback-cache-only.sql'),`rollback-cache:${next.batchSha256}`);
  assert.equal(sql('select count(*) from player_center_season_cache'),'0');assert.equal(sql('select count(*) from nba_player_game_observation_versions'),'3');
});
pgtest('row-count/trigger failures roll back all observations and cache rows in the batch',()=>{
  cacheSchema();sql('alter table nba_player_game_observation_versions disable trigger nba_observation_versions_sync_current');
  const out=writeFiles('bad-trigger-'+Date.now(),batchFiles(plan,canary));
  assert.throws(()=>runFile(path.join(out,'01-apply-batch.sql'),`ingest:${canary.batchSha256}`),/trigger verification failed|Unexpected NBA observation triggers/);
  assert.equal(sql('select count(*) from nba_player_game_observation_versions'),'0');assert.equal(sql('select count(*) from player_center_season_cache'),'0');
  sql('alter table nba_player_game_observation_versions enable trigger nba_observation_versions_sync_current');
});

const {buildNflBatch,nflBatchFiles}=require('../scripts/lib/playerCenterNflBatch.cjs');
const nflCapture=require('../data/player-center-preview/captured.json');
function nflSample(){
 const histories=nflCapture.histories.filter(h=>h.player.sport==='nfl'&&['QB','K','D/ST'].includes(h.player.position)).map(h=>structuredClone(h));
 const targets=histories.map(h=>({playerId:h.player.playerId,providerPlayerId:h.player.providerPlayerId,position:h.player.position,name:h.player.name}));
 return{targets,histories,options:{season:2026,asOf:nflCapture.capturedAt,checkedAt:'2026-10-26T15:10:00Z'}};
}
test('NFL cache preparation preserves signed/off-position/K/DST facts and never invents kicker scores',()=>{
 const {targets,histories,options}=nflSample(),batch=buildNflBatch(targets,histories,options);
 assert.equal(batch.cache.length,3);assert.ok(!JSON.stringify(batch.cache).includes('fantasy_points'));assert.equal(batch.cache.find(c=>c.provider_player_id==='100000012').season_stats.byeWeeks[0],5);
 const qb=batch.cache.find(c=>c.provider_player_id==='3139477');assert.equal(qb.games.find(g=>g.eventId==='401872945').stats.fumbles_lost,0);
 const bad=structuredClone(histories);bad[0].games[0].stats.fumbles_lost=null;assert.equal(buildNflBatch(targets,bad,options).cache[0].complete,false);
 assert.throws(()=>buildNflBatch(targets.map((t,i)=>i? t:{...t,providerPlayerId:'99'}),histories,options),/identity/);
 const files=nflBatchFiles(batch);assert.match(files['02-apply-cache.sql'],/Before-cache drift/);assert.ok(!files['02-apply-cache.sql'].includes('projection_stat_cache'));assert.ok(!files['02-apply-cache.sql'].includes('game_observation'));
});
pgtest('NFL cache-only publication is guarded, atomic, idempotent, drift-checked and safely withdrawn',()=>{
 cacheSchema();const {targets,histories,options}=nflSample(),batch=buildNflBatch(targets,histories,options),directory=writeFiles('nfl-cache',nflBatchFiles(batch));
 sql(`insert into players_nfl(id,nfl_player_id,position,is_active) values ${targets.map(t=>`(${t.playerId},${quote(t.providerPlayerId)},${quote(t.position)},true)`).join(',')} on conflict(id) do nothing;`);
 const file=path.join(directory,'02-apply-cache.sql');assert.throws(()=>runFile(file),/Missing exact reviewed operation approval/);
 runFile(path.join(directory,'01-preflight-backup.sql'));runFile(file,`ingest-cache:${batch.batchSha256}`,batch.backupReceiptSha256);runFile(file,`ingest-cache:${batch.batchSha256}`,batch.backupReceiptSha256);
 assert.equal(sql("select count(*) from player_center_season_cache where sport='nfl'"),'3');runFile(path.join(directory,'03-postflight.sql'));
 sql(`\\set sport nfl\n\\set season 2026\n\\i ${path.join(root,'supabase/manual/player-center/verify-cache-coverage.sql')}\n`);
 sql("update player_center_season_cache set rollout_batch_id='newer' where sport='nfl'");assert.throws(()=>runFile(path.join(directory,'04-rollback-cache.sql'),`rollback-cache:${batch.batchSha256}`,batch.backupReceiptSha256),/Newer cache/);
 sql(`update player_center_season_cache set rollout_batch_id=${quote(batch.batchId)} where sport='nfl'`);
 runFile(path.join(directory,'04-rollback-cache.sql'),`rollback-cache:${batch.batchSha256}`,batch.backupReceiptSha256);assert.equal(sql('select count(*) from player_center_season_cache'),'0');assert.equal(sql('select score from lineup_sentinel where id=1'),'111');
});
test('NFL acquisition fills distinct summary gaps with at most three bounded passes and refuses failed logs',async()=>{
 const {acquireNflHistory}=require('../scripts/lib/playerCenterNflBatch.cjs');let calls=0;
 const reader={history:async()=>({coverage:{freshness:'fresh',issues:++calls<3?['summary_coverage_budget_limited']:[]}})};
 const result=await acquireNflHistory(reader,{},2026);assert.equal(calls,3);assert.deepEqual(result.coverage.issues,[]);
 calls=0;await acquireNflHistory({history:async()=>{calls++;return{coverage:{freshness:'fresh',issues:['summary_coverage_budget_limited']}};}},{},2026);assert.equal(calls,3);
 await assert.rejects(acquireNflHistory({history:async()=>({coverage:{freshness:'unavailable',issues:[]}})},{},2026),/acquisition failed/);
});
