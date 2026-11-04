/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit operator preparation/publication only. Importing this file never runs it.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {registerTypescript,guard,json,quote}=require('./lib/playerCenterRollout.cjs');registerTypescript();
const {createCanaryTransport,ORIGIN}=require('./lib/playerCenterCanaryTransport.cjs');
const {providerReader}=require('./run-nba-player-center-refresh.cjs');
const {buildNbaRefreshPublication}=require('../lib/player-center/nbaRefresh.ts');
const {professionalSeason}=require('../lib/player-center/types.ts');
const {CenterEspnReader}=require('../lib/player-center/espn.ts');
const {acquireNflHistory,buildNflBatch,nflBatchFiles}=require('./lib/playerCenterNflBatch.cjs');
const {assertNbaRefreshStorage}=require('../lib/player-center/refreshStorage.ts');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>hash(a)===hash(b);
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
}
function cacheFacts(cache) {
  const{games,...rest}=cache;
  // The installed RPC intentionally retains original game fetchedAt on fact-identical
  // polls; every other cache value and every raw game fact must match postflight.
  return canonical({...rest,as_of:new Date(rest.as_of).toISOString(),checked_at:new Date(rest.checked_at).toISOString(),
    games:games.map(({fetchedAt,...game})=>{void fetchedAt;return game;}).sort((a,b)=>a.eventId.localeCompare(b.eventId))});
}

function toolingHash(root=path.join(__dirname,'..')) {
  const files=[];
  function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(ts|cjs|js)$/.test(p))files.push(p);}}
  walk('lib');walk('scripts');
  return hash(files.sort().map(p=>[p.replaceAll(path.sep,'/'),createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
}
function assertSeason(sport,season,now) {
  if(!['nba','nfl'].includes(sport)||!Number.isInteger(season)||season<2000||season>professionalSeason(sport,new Date(now)))throw Error('Exact supported professional season required');
}
function fullHealth(value,now) {
  assertNbaRefreshStorage(value,0,now);
  if(value.integrity_protocol!=='paged-v1'||value.reference_errors!==0||!Number.isSafeInteger(value.history_count)||!Number.isSafeInteger(value.current_count)||!value.current_checksum?.startsWith('paged-v1:sha256:'))throw Error('Complete paged integrity receipt required');
}
const targetsOf=players=>players.map(({playerId,nativePlayerId,providerPlayerId,name,position})=>({playerId,nativePlayerId,providerPlayerId,name,position}));
function withdrawalSql(bundle) {
  const caches=bundle.publications.map(p=>p.cache),backup=hash(bundle.before);
  return guard('withdraw-nba-cache',bundle.bundleSha256,backup)+`
-- Cache withdrawal only; no observation, result, status or saved-pick deletion.
lock table public.player_center_season_cache in share row exclusive mode;
lock table public.player_center_nba_refresh_status in share mode;
create temp table _expected on commit drop as select * from jsonb_populate_recordset(null::public.player_center_season_cache,${json(caches)});
do $check$ begin
 if (select count(*) from _expected) not between 1 and 3 then raise exception 'Invalid canary cache targets'; end if;
 if exists(select 1 from _expected e left join public.player_center_nba_refresh_status s on s.player_id=e.nba_local_player_id and s.season=e.season where s.run_id is distinct from ${quote(bundle.runId)}::uuid or s.as_of is distinct from ${quote(bundle.asOf)}::timestamptz) then raise exception 'Newer/missing publication receipt'; end if;
 if exists(select 1 from _expected e left join public.player_center_season_cache c on c.sport=e.sport and c.provider=e.provider and c.provider_player_id=e.provider_player_id and c.season=e.season and c.phase=e.phase where to_jsonb(c) is distinct from to_jsonb(e)) then raise exception 'Cache changed; withdrawal refused'; end if;
end $check$;
delete from public.player_center_season_cache c using _expected e where c.sport=e.sport and c.provider=e.provider and c.provider_player_id=e.provider_player_id and c.season=e.season and c.phase=e.phase;
commit;
-- Before images are retained in bundle.json; no stale prior cache is restored.
`;
}

/** GET-only, <=3 reviewed identities. The transport supplied by CLI cannot POST. */
async function prepareCanary({sport,season,targets,transport,request=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),toolHash=toolingHash()}) {
  assertSeason(sport,season,now());
  if(!Array.isArray(targets)||targets.length<1||targets.length>3||new Set(targets.map(p=>p.playerId)).size!==targets.length)throw Error('Select 1–3 exact distinct targets');
  const players=await transport.resolveTargets(sport,targets),healthBefore=await transport.health(true);fullHealth(healthBefore,now());
  const before=await transport.snapshot(sport,season,players),asOf=new Date(now()).toISOString(),runId=randomUUID();
  const evidence=[],deadline=now()+180000;
  let requests=0,last=0;
  const providerRequest=async(url,init={})=>{
    const parsed=new URL(url);
    if((init.method??'GET')!=='GET'||!['site.web.api.espn.com','site.api.espn.com'].includes(parsed.hostname)||parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('Provider transport only permits ESPN GETs');
    if(now()>=deadline||requests>=40)throw Error('Canary acquisition request/deadline cap');
    await sleep(Math.max(0,last+2100-now()));
    if(now()>=deadline)throw Error('Canary acquisition deadline reached');last=now();requests++;
    const timeout=AbortSignal.timeout(Math.min(10000,Math.max(1,deadline-now())));
    const result=await request(url,{...init,method:'GET',redirect:'error',signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
    // Record exact raw response hashes separately from normalized facts, with no credentials.
    const reader=result.body?.getReader(),parts=[];let size=0;
    if(!reader)throw Error('Empty provider response');
    try{for(;;){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>3000000)throw Error('Provider response byte cap');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    const raw=Buffer.concat(parts);
    evidence.push({url:String(url),status:result.status,fetchedAt:new Date(now()).toISOString(),sha256:createHash('sha256').update(raw).digest('hex')});
    return new Response(raw,{status:result.status,headers:result.headers});
  };
  let publications=[],nflBatch=null;
  if(sport==='nba'){
    const reader=providerReader({request:providerRequest,now,sleep,maxRequests:Math.ceil(players.length*2*1.25),deadline});
    for(const player of players){
      const [log,summary]=await Promise.all([reader.read(player,season,'log'),reader.read(player,season,'summary')]);
      publications.push(buildNbaRefreshPublication({player,season,asOf,runId,attemptedAt:new Date(now()).toISOString(),log,summary}));
    }
  }else{
    const reader=new CenterEspnReader(providerRequest,now),histories=[];
    for(const player of players)histories.push(await acquireNflHistory(reader,player,season));
    nflBatch=buildNflBatch(targetsOf(players),histories,{season,asOf,checkedAt:new Date(now()).toISOString(),beforeCache:before.cache});
  }
  const freshPlayers=await transport.resolveTargets(sport,targetsOf(players));
  if(!same(players,freshPlayers)||!same(before,await transport.snapshot(sport,season,players)))throw Error('Catalog/cache/status drift during acquisition');
  const healthAfter=await transport.health(true);fullHealth(healthAfter,now());
  if(healthBefore.history_count!==healthAfter.history_count||healthBefore.current_checksum!==healthAfter.current_checksum)throw Error('Observations changed during write-free preparation');
  const clean=sport==='nba'?publications.every(p=>['verified_data','verified_zero_appearances'].includes(p.outcome)&&p.cache?.complete):nflBatch.cache.every(c=>c.complete);
  const bundle={version:1,target:ORIGIN,sport,season,runId,asOf,preparedAt:new Date(now()).toISOString(),toolingHash:toolHash,players,before,healthBefore,healthAfter,evidence,requests,clean,publications,nflBatch};
  return{...bundle,bundleSha256:hash(bundle)};
}

function validateBundle(bundle,{approval,toolHash,now}) {
  const{bundleSha256,...body}=bundle;
  if(bundle.version!==1||bundle.target!==ORIGIN||bundleSha256!==hash(body)||approval!==bundleSha256||bundle.toolingHash!==toolHash)throw Error('Exact bundle/tooling approval mismatch');
  assertSeason(bundle.sport,bundle.season,now());
  const age=now()-Date.parse(bundle.preparedAt);
  if(!Number.isFinite(age)||age<0||age>3600000||!bundle.clean||bundle.players.length<1||bundle.players.length>3||!bundle.evidence.length)throw Error('Incomplete/stale canary requires a new dry run and approval');
  if(bundle.sport==='nba'&&(!Array.isArray(bundle.publications)||bundle.publications.length!==bundle.players.length||new Set(bundle.publications.map(p=>p.player_id)).size!==bundle.players.length||bundle.publications.some(p=>{
    const player=bundle.players.find(player=>player.playerId===p.player_id);
    return !player||p.native_player_id!==player.nativePlayerId||p.provider_player_id!==player.providerPlayerId||!['verified_data','verified_zero_appearances'].includes(p.outcome)||!p.cache?.complete||p.cache.season!==bundle.season||p.cache.as_of!==bundle.asOf||p.cache.rollout_batch_id!==bundle.runId;
  })))throw Error('Approved publication target/envelope mismatch');
}

/** One atomic installed-RPC call; never acquires new facts or silently retries a write. */
async function publishNbaCanary({bundle,approval,transport,now=Date.now,toolHash=toolingHash(),save=()=>{}}) {
  validateBundle(bundle,{approval,toolHash,now});
  if(bundle.sport!=='nba')throw Error('NFL requires separately reviewed owner SQL; no generic cache writer');
  const players=await transport.resolveTargets('nba',targetsOf(bundle.players));
  if(!same(players,bundle.players))throw Error('Approved target identity changed');
  const state=await transport.snapshot('nba',bundle.season,players);
  const replay=state.status.length===players.length&&state.status.every(s=>s.run_id===bundle.runId&&Date.parse(s.as_of)===Date.parse(bundle.asOf));
  if(!replay&&!same(state,bundle.before))throw Error('Before-image drift; obtain a new review');
  const before=await transport.health(true);fullHealth(before,now());
  const bytes=Buffer.byteLength(JSON.stringify(bundle.publications));assertNbaRefreshStorage(before,bytes,now());
  const report={bundleSha256:bundle.bundleSha256,runId:bundle.runId,season:bundle.season,status:'PUBLICATION_PENDING',before,replay};save(report);
  try{
    const receipt=await transport.publishNba(bundle);report.receipt=receipt;report.status='ACKNOWLEDGED';save(report);
    if(receipt.players!==players.length||!Number.isSafeInteger(receipt.appended)||receipt.appended<0||!Number.isSafeInteger(receipt.accepted)||receipt.accepted<receipt.appended||receipt.not_appended!==receipt.accepted-receipt.appended||receipt.replayed_players!==(replay?players.length:0)||receipt.accepted!==(replay?0:bundle.publications.reduce((sum,p)=>sum+p.observations.length,0)))throw Error('Unexpected RPC receipt');
    const afterRows=await transport.snapshot('nba',bundle.season,players);
    for(const p of bundle.publications){
      const status=afterRows.status.find(s=>s.player_id===p.player_id),cache=afterRows.cache.find(c=>c.nba_local_player_id===p.player_id);
      if(status?.run_id!==bundle.runId||status?.outcome!==p.outcome||!status.receipt_hash||Date.parse(status.as_of)!==Date.parse(bundle.asOf)||!cache?.complete||cache.content_hash!==p.cache.content_hash||cache.rollout_batch_id!==bundle.runId)throw Error('Publication postflight receipt/cache mismatch');
      if(!same(cacheFacts(cache),cacheFacts(p.cache)))throw Error('Publication raw cache facts differ');
    }
    const after=await transport.health(true);fullHealth(after,now());report.after=after;report.rows=afterRows;
    if(after.history_count-before.history_count!==receipt.appended||!receipt.appended&&after.current_checksum!==before.current_checksum)throw Error('Unexpected history/current growth');
    report.withdrawalSql=withdrawalSql({...bundle,publications:bundle.publications.map(p=>({...p,cache:afterRows.cache.find(c=>c.nba_local_player_id===p.player_id)}))});
    report.status='VERIFIED';save(report);return report;
  }catch(error){report.status='STOPPED_RECONCILE_RECEIPTS';report.error=String(error.message);save(report);throw error;}
}

async function main(args=process.argv.slice(2)) {
  const command=args.shift(),options={};
  const permitted=command==='prepare'?new Set(['--sport','--season','--targets','--out']):new Set(['--bundle','--approve','--out']);
  if(!['prepare','preflight','publish-nba'].includes(command))throw Error('Use prepare, preflight or publish-nba; execution is always explicit');
  for(let i=0;i<args.length;i+=2){if(!permitted.has(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error('Unknown/duplicate/missing option');options[args[i]]=args[i+1];}
  if(!options['--out']||fs.existsSync(options['--out']))throw Error('A new output path is required');
  if(command!=='prepare'&&(!options['--bundle']||!options['--approve']))throw Error('Frozen bundle and exact approval hash required');
  if(command==='prepare'&&['--sport','--season','--targets'].some(k=>!options[k]))throw Error('Sport, professional season and exact targets required');
  const bundle=command!=='prepare'?JSON.parse(fs.readFileSync(options['--bundle'],'utf8')):null;
  if(bundle)validateBundle(bundle,{approval:options['--approve'],toolHash:toolingHash(),now:Date.now}); // Before creating a writer.
  const transport=createCanaryTransport({origin:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,allowPublication:command==='publish-nba'});
  if(command==='prepare'){
    const result=await prepareCanary({sport:options['--sport'],season:Number(options['--season']),targets:JSON.parse(fs.readFileSync(options['--targets'],'utf8')),transport});
    const files={'bundle.json':JSON.stringify(result,null,2)+'\n','rollback-plan.json':JSON.stringify({backupReceipt:hash(result.before),preserve:'All observations, versions, scoring and saved picks; cache withdrawal only',before:result.before},null,2)+'\n'};
    if(result.clean&&result.sport==='nba')files['withdraw-cache-REVIEW_ONLY.sql']=withdrawalSql(result);
    else if(result.clean)Object.assign(files,nflBatchFiles(result.nflBatch,{requireComplete:true}));
    fs.mkdirSync(options['--out'],{recursive:false,mode:0o700});
    for(const[name,body]of Object.entries(files))fs.writeFileSync(path.join(options['--out'],name),body,{flag:'wx',mode:0o600});
    console.log(JSON.stringify({clean:result.clean,sport:result.sport,season:result.season,players:result.players.length,requests:result.requests,bundleSha256:result.bundleSha256,publicationExecuted:false}));
    if(!result.clean)process.exitCode=1;
  }else if(command==='preflight'){
    const players=await transport.resolveTargets(bundle.sport,targetsOf(bundle.players));
    if(!same(players,bundle.players)||!same(bundle.before,await transport.snapshot(bundle.sport,bundle.season,players)))throw Error('Before-image drift; obtain a new review');
    const health=await transport.health(true);fullHealth(health,Date.now());
    assertNbaRefreshStorage(health,Buffer.byteLength(JSON.stringify(bundle.sport==='nfl'?bundle.nflBatch.cache:bundle.publications)));
    fs.writeFileSync(options['--out'],JSON.stringify({bundleSha256:bundle.bundleSha256,health,operatorSettings:bundle.sport==='nfl'?{'sports111.cache_metrics_receipt':bundle.nflBatch.batchSha256,'sports111.cache_metrics_at':health.metrics_at}:null},null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({preflightPassed:true,publicationExecuted:false,metricsAt:health.metrics_at}));
  }else{
    const reportPath=options['--out'];fs.writeFileSync(reportPath,'{}\n',{flag:'wx',mode:0o600});
    const result=await publishNbaCanary({bundle,approval:options['--approve'],transport,save:report=>{fs.writeFileSync(reportPath+'.partial',JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.renameSync(reportPath+'.partial',reportPath);}});
    console.log(JSON.stringify({status:result.status,runId:result.runId,receipt:result.receipt}));
  }
}
module.exports={prepareCanary,publishNbaCanary,validateBundle,withdrawalSql,toolingHash,hash,main};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
