/* eslint-disable @typescript-eslint/no-require-imports */
/* GitHub worker: ESPN acquisition stays outside Vercel; this script only appends factual evidence. */
const fs=require('fs'),path=require('path'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);
const {fetchEspnNflGameLog}=require(path.join(__dirname,'../lib/analytics/providers/espnNflGameLog.ts'));
const {fetchEspnNflEventFumbles}=require(path.join(__dirname,'../lib/analytics/providers/espnNflEventFumbles.ts'));
const {espnNflRegularSeasonScoreboardWeekUrl,normalizeEspnNflRegularSeasonScoreboard,mergeEspnNflRegularSeasonScoreboards}=require(path.join(__dirname,'../lib/analytics/providers/espnNflScoreboard.ts'));
const {acquireNflObservations}=require(path.join(__dirname,'../lib/analytics/nfl/observationAcquisition.ts'));
const base=process.env.NFL_PROJECTION_INGEST_BASE_URL?.trim(),secret=process.env.NFL_PROJECTION_INGEST_SECRET?.trim();
if(!base||!secret)throw new Error('NFL observation worker requires NFL_PROJECTION_INGEST_BASE_URL and NFL_PROJECTION_INGEST_SECRET');
const season=Number(process.env.NFL_PROJECTION_SEASON||2026),dryRun=process.argv.includes('--dry-run');
if(!Number.isInteger(season)||season<2000||season>2100)throw new Error('NFL_PROJECTION_SEASON must be a valid season');
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
async function post(body){const r=await fetch(new URL('/api/internal/nfl/projection-ingest',base),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});let p;try{p=await r.json()}catch{throw new Error(`NFL ingest returned non-JSON HTTP ${r.status}`)}if(!r.ok)throw new Error(p.error||`NFL ingest HTTP ${r.status}`);return p}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i])}});await Promise.all(workers);return out}
async function scoreboard(){const weeks=Array.from({length:18},(_,index)=>index+1);const groups=await mapLimit(weeks,4,async week=>{const url=espnNflRegularSeasonScoreboardWeekUrl(season,week),r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`ESPN NFL scoreboard HTTP ${r.status}: week ${week}`);return normalizeEspnNflRegularSeasonScoreboard(await r.json(),season,week)});return mergeEspnNflRegularSeasonScoreboards(groups)}
(async()=>{
  const players=(await post({action:'eligible'})).players;
  if(!Array.isArray(players))throw new Error('NFL eligible endpoint returned no player list');
  const [events,logsByPlayer]=await Promise.all([scoreboard(),mapLimit(players,8,async player=>{const parsed=await fetchEspnNflGameLog({espnPlayerId:String(player.providerPlayerId),season,position:player.position});if(parsed.conflicts.length)throw new Error(`Conflicting NFL game-log rows: ${parsed.conflicts.join(',')}`);return parsed.observations})]);
  const gameLogs=logsByPlayer.flat(),statusIds=new Set(events.map(event=>event.providerEventId));
  const missingStatus=[...new Set(gameLogs.map(row=>row.eventId).filter(eventId=>!statusIds.has(eventId)))];
  if(missingStatus.length)throw new Error(`ESPN scoreboard omitted game-log events: ${missingStatus.join(',')}`);
  const observations=await acquireNflObservations({eligible:players,season,finalEvents:events.filter(event=>event.completed),gameLogs,fetchFumbles:fetchEspnNflEventFumbles});
  const report={season,eligiblePlayers:players.length,gameLogRows:gameLogs.length,finalEvents:events.filter(event=>event.completed).length,completedObservations:observations.length,qbSummaryRequests:new Set(observations.filter(row=>row.position==='QB').map(row=>row.providerEventId)).size,dryRun,batches:[]};
  if(!dryRun)for(const batch of chunks(observations,500))report.batches.push(await post({action:'observations',observations:batch}));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1});
