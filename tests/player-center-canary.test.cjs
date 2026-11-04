/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {input,player,build}=require('./helpers/nba-refresh-fixtures.cjs');
const {prepareCanary,publishNbaCanary,validateBundle,hash,main}=require('../scripts/player-center-canary.cjs');
const {createCanaryTransport,ORIGIN}=require('../scripts/lib/playerCenterCanaryTransport.cjs');
const {nflBatchFiles,buildNflBatch}=require('../scripts/lib/playerCenterNflBatch.cjs');
const {NBA_APPEND_SOURCE_MD5}=require('../lib/player-center/nbaRefresh.ts');
const capture=require('../data/player-center-preview/captured.json');
const targetsOf=p=>({playerId:p.playerId,nativePlayerId:p.nativePlayerId,providerPlayerId:p.providerPlayerId,name:p.name,position:p.position});
function fixture(){
  let clock=Date.now(),writes=0,snapshot={cache:[],status:[]};const calls=[];
  const health=()=>({schema_ok:true,append_source_hash:NBA_APPEND_SOURCE_MD5,database_bytes:240000000,cache_bytes:32768,wal_bytes:1000,available_bytes:1400000000,metrics_at:new Date(clock).toISOString(),reference_errors:0,history_count:10,current_count:10,current_checksum:'paged-v1:sha256:abc',integrity_protocol:'paged-v1'});
  const transport={resolveTargets:async(s,targets)=>{calls.push('targets');assert.ok(targets.length>0&&targets.length<=3);return targets.map(t=>({...player,...t,sport:s}));},health:async()=>health(),snapshot:async()=>structuredClone(snapshot),publishNba:async bundle=>{
    writes++;const replay=snapshot.status.length>0;
    snapshot={cache:bundle.publications.map(p=>p.cache),status:bundle.publications.map(p=>({player_id:p.player_id,run_id:bundle.runId,as_of:bundle.asOf,outcome:p.outcome,receipt_hash:'database-jsonb-receipt',appended_versions:0}))};
    const accepted=replay?0:bundle.publications.reduce((n,p)=>n+p.observations.length,0);
    return{players:bundle.players.length,accepted,appended:0,not_appended:accepted,replayed_players:replay?bundle.players.length:0};
  }};
  const request=async url=>{calls.push(String(url));const source=input();return Response.json(String(url).includes('/gamelog?')?source.log.payload:source.summary.payload);};
  return{transport,request,now:()=>clock,sleep:async ms=>{clock+=ms;},toolHash:'reviewed-tools',calls,writes:()=>writes,setSnapshot:v=>{snapshot=v;},advance:ms=>{clock+=ms;}};
}
test('NBA bounded preparation reads exact current-season targets and cannot publish',async()=>{
  const f=fixture();const b=await prepareCanary({...f,sport:'nba',season:2027,targets:[targetsOf(player)]});
  assert.equal(b.clean,true);assert.equal(b.players.length,1);assert.equal(b.publications[0].cache.season,2027);assert.equal(f.writes(),0);assert.equal(b.requests,2);assert.equal(b.evidence.length,2);assert.equal(b.bundleSha256,hash(Object.fromEntries(Object.entries(b).filter(([k])=>k!=='bundleSha256'))));
  assert.ok(f.calls.filter(x=>x.startsWith('https:')).every(x=>x.includes('season=2027')));
});
test('NBA canary uses one installed RPC, validates postflight and permits exact replay without new acquisition',async()=>{
  const f=fixture(),b=await prepareCanary({...f,sport:'nba',season:2027,targets:[targetsOf(player)]});let requests=f.calls.filter(x=>x.startsWith('https:')).length;
  const first=await publishNbaCanary({...f,bundle:b,approval:b.bundleSha256});assert.equal(first.status,'VERIFIED');assert.equal(f.writes(),1);assert.match(first.withdrawalSql,/Newer\/missing publication receipt/);assert.ok(!/delete from public\.nba_player/.test(first.withdrawalSql));
  const second=await publishNbaCanary({...f,bundle:b,approval:b.bundleSha256});assert.equal(second.receipt.replayed_players,1);assert.equal(f.calls.filter(x=>x.startsWith('https:')).length,requests);
});
test('three exact NBA players share one cutoff and one atomic RPC; zero/four targets never acquire',async()=>{
  const f=fixture(),targets=Array.from({length:3},(_,i)=>({...targetsOf(player),playerId:6+i,nativePlayerId:String(2544+i),providerPlayerId:String(1966+i),name:`Fixture NBA ${i}`}));
  const b=await prepareCanary({...f,sport:'nba',season:2027,targets});assert.equal(b.clean,true);assert.equal(b.players.length,3);assert.equal(b.requests,6);assert.equal(new Set(b.publications.map(p=>p.cache.as_of)).size,1);
  const result=await publishNbaCanary({...f,bundle:b,approval:b.bundleSha256});assert.equal(result.receipt.players,3);assert.equal(result.receipt.accepted,6);assert.equal(f.writes(),1);
  const empty=fixture();for(const bad of [[],[...targets,{...targets[0],playerId:99}]])await assert.rejects(prepareCanary({...empty,sport:'nba',season:2027,targets:bad}),/1–3/);assert.equal(empty.calls.length,0);
});
test('changed approval, payload, tools, season, age or before image abort before publication',async()=>{
  const f=fixture(),b=await prepareCanary({...f,sport:'nba',season:2027,targets:[targetsOf(player)]});
  await assert.rejects(publishNbaCanary({...f,bundle:b,approval:'wrong'}),/approval/);
  const changed=structuredClone(b);changed.publications[0].observations[0].points++;await assert.rejects(publishNbaCanary({...f,bundle:changed,approval:b.bundleSha256}),/approval/);
  const wrongTarget=structuredClone(b);wrongTarget.publications[0].player_id=999;delete wrongTarget.bundleSha256;wrongTarget.bundleSha256=hash(wrongTarget);
  await assert.rejects(publishNbaCanary({...f,bundle:wrongTarget,approval:wrongTarget.bundleSha256}),/target\/envelope/);
  assert.throws(()=>validateBundle(b,{approval:b.bundleSha256,toolHash:'changed',now:f.now}),/approval/);
  f.setSnapshot({cache:[{newer:true}],status:[]});await assert.rejects(publishNbaCanary({...f,bundle:b,approval:b.bundleSha256}),/Before-image/);
  f.advance(3600001);await assert.rejects(publishNbaCanary({...f,bundle:b,approval:b.bundleSha256}),/stale/);assert.equal(f.writes(),0);
  await assert.rejects(prepareCanary({...fixture(),sport:'nba',season:2099,targets:[targetsOf(player)]}),/season/);
});
test('ambiguous acknowledgements stop with durable reconciliation status and no automatic retry',async()=>{
  const f=fixture(),b=await prepareCanary({...f,sport:'nba',season:2027,targets:[targetsOf(player)]});let calls=0;const reports=[];
  f.transport.publishNba=async()=>{calls++;throw Error('response lost');};
  await assert.rejects(publishNbaCanary({...f,bundle:b,approval:b.bundleSha256,save:r=>reports.push(structuredClone(r))}),/response lost/);
  assert.equal(calls,1);assert.equal(reports.at(-1).status,'STOPPED_RECONCILE_RECEIPTS');
});
test('incomplete NBA acquisition yields an explicit non-publishable review bundle',async()=>{
  const f=fixture();f.request=async()=>Response.json({filters:[{name:'league',value:'nba'}]});
  const b=await prepareCanary({...f,sport:'nba',season:2027,targets:[targetsOf(player)]});assert.equal(b.clean,false);await assert.rejects(publishNbaCanary({...f,bundle:b,approval:b.bundleSha256}),/Incomplete/);assert.equal(f.writes(),0);
});
test('real NFL response shapes pass through the bounded enrichment path without any writer',async()=>{
  const f=fixture(),p=capture.histories.find(h=>h.player.sport==='nfl'&&h.player.position==='QB').player;
  const log=require('./fixtures/player-center/nfl-log-3139477-401872945.json'),summary=require('./fixtures/player-center/nfl-summary-401872945.json'),stats=structuredClone(require('./fixtures/player-center/nfl-season.json'));
  for(const cat of stats.categories)for(const row of cat.statistics??[]){const i=cat.labels.indexOf('GP');if(i>=0)row.stats[i]='1';}
  f.request=async url=>Response.json(String(url).includes('/gamelog?')?log:String(url).includes('/stats?')?stats:summary);
  const b=await prepareCanary({...f,sport:'nfl',season:2026,targets:[targetsOf(p)]});
  assert.equal(b.clean,true,JSON.stringify(b.nflBatch.cache[0].issues));assert.ok(b.nflBatch.cache.length===1);assert.ok(b.nflBatch.cache[0].season_stats.categories.length);assert.ok(b.nflBatch.cache[0].games.length);assert.ok(b.requests<=40);assert.equal(f.writes(),0);
  assert.ok(b.nflBatch.cache[0].games.some(g=>g.sources.some(s=>s.includes('/summary?'))));
});
test('NFL publication SQL binds complete cache, before images, exact approvals and fresh disk receipt',()=>{
  const history=structuredClone(capture.histories.find(h=>h.player.sport==='nfl'&&h.player.position==='QB'));
  const batch=buildNflBatch([targetsOf(history.player)],[history],{season:2026,asOf:new Date().toISOString(),checkedAt:new Date().toISOString()});
  const files=nflBatchFiles(batch,{requireComplete:true});assert.match(files['02-apply-cache.sql'],/Canary requires complete factual coverage/);assert.match(files['02-apply-cache.sql'],/Before-cache drift/);assert.match(files['02-apply-cache.sql'],/Fresh reviewed disk\/WAL receipt required/);
  assert.match(files['04-rollback-cache.sql'],/Newer cache publication exists/);assert.ok(!/nba_player_game|nfl_player_game/.test(files['04-rollback-cache.sql']));
});
test('NFL missing summary evidence retains an incomplete cache and cannot authorize publication',async()=>{
  const f=fixture(),p=capture.histories.find(h=>h.player.sport==='nfl'&&h.player.position==='QB').player;
  const log=require('./fixtures/player-center/nfl-log-3139477-401872945.json'),summary=structuredClone(require('./fixtures/player-center/nfl-summary-401872945.json')),stats=structuredClone(require('./fixtures/player-center/nfl-season.json'));
  for(const team of summary.boxscore.players)team.statistics=team.statistics.filter(g=>g.name!=='fumbles');delete summary.boxscore.teams;
  for(const cat of stats.categories)for(const row of cat.statistics??[]){const i=cat.labels.indexOf('GP');if(i>=0)row.stats[i]='1';}
  f.request=async url=>Response.json(String(url).includes('/gamelog?')?log:String(url).includes('/stats?')?stats:summary);
  const b=await prepareCanary({...f,sport:'nfl',season:2026,targets:[targetsOf(p)]});assert.equal(b.clean,false);assert.ok(b.nflBatch.cache[0].issues.includes('incomplete_position_statistics'));assert.equal(b.nflBatch.cache[0].games[0].stats.fumbles_lost,null);
  assert.throws(()=>validateBundle(b,{approval:b.bundleSha256,toolHash:f.toolHash,now:f.now}),/Incomplete/);
});
test('production transport defaults write-free and rejects target drift before requests',async()=>{
  let requests=0;const transport=createCanaryTransport({origin:ORIGIN,key:'fixture-only',request:async()=>{requests++;throw Error('Unexpected request');}});
  await assert.rejects(transport.publishNba({sport:'nba',publications:[]}),/Write-free/);assert.equal(requests,0);
  assert.throws(()=>createCanaryTransport({origin:'https://wrong.supabase.co',key:'fixture-only'}),/Exact reviewed/);
  await assert.rejects(transport.resolveTargets('nba',Array.from({length:4},(_,i)=>({playerId:i+1}))),/1–3/);assert.equal(requests,0);
});
test('direct transport publication can POST only the installed bounded RPC after fresh storage checks',async()=>{
  const calls=[];const metrics=`node_filesystem_avail_bytes{mountpoint="/data"} 1400000000\nnode_filesystem_readonly{mountpoint="/data"} 0\npg_wal_size_mb{} 1\npg_database_size_bytes{datname="postgres"} 240000000\n`;
  const request=async(url,init)=>{calls.push([String(url),init.method??'GET']);if(String(url).includes('/metrics'))return new Response(metrics,{headers:{Date:new Date().toUTCString()}});if(String(url).includes('health'))return Response.json({schema_ok:true,append_source_hash:NBA_APPEND_SOURCE_MD5,database_bytes:240000000,cache_bytes:32768,wal_bytes:1048576});return Response.json({players:1});};
  const t=createCanaryTransport({origin:ORIGIN,key:'fixture-only',allowPublication:true,request});
  await t.publishNba({sport:'nba',runId:'00000000-0000-4000-8000-000000000001',season:2027,asOf:new Date().toISOString(),publications:[build(input())]});
  assert.deepEqual(calls.filter(([,m])=>m==='POST').map(([u])=>u),[ORIGIN+'/rest/v1/rpc/publish_player_center_nba_refresh']);assert.ok(!calls.some(([u])=>u.includes('111sports.app')));
});
test('CLI rejects implicit commands and unapproved publication before credentials or network access',async()=>{
  await assert.rejects(main([]),/explicit/);await assert.rejects(main(['publish-nba','--out','unused-canary-report.json']),/Frozen bundle/);
});
