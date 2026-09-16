/* GitHub worker: ESPN acquisition/normalization happens outside Vercel. */
const fs=require('fs'),path=require('path'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {fetchEspnNbaGameLog}=require(path.join(__dirname,'../lib/analytics/providers/espnNbaGameLog.ts'));
const base=process.env.NBA_PROJECTION_INGEST_BASE_URL?.trim(),secret=process.env.NBA_PROJECTION_INGEST_SECRET?.trim();
if(!base||!secret) throw new Error('NBA projection worker requires base URL and ingest secret');
const season=Number(process.env.NBA_PROJECTION_SEASON||new Date().getUTCFullYear());
const MAX_OBSERVATIONS_PER_REQUEST=1000;
async function post(body){const r=await fetch(new URL('/api/internal/nba/projection-ingest',base),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const p=await r.json();if(!r.ok)throw new Error(p.error||`HTTP ${r.status}`);return p;}
const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,(index+1)*size));
(async()=>{const ids=(await post({action:'eligible'})).providerPlayerIds; const observations=[],failed=[];
for(const id of ids){for(const year of [season-1,season])try{observations.push(...(await fetchEspnNbaGameLog({espnPlayerId:String(id),season:year})).observations)}catch(error){failed.push({id,year,error:String(error)})}}
const ingested=[];
for(const batch of chunks(observations,MAX_OBSERVATIONS_PER_REQUEST))ingested.push(await post({action:'observations',season,observations:batch,generate:false}));
const generated=await post({action:'generate',season});console.log(JSON.stringify({observationCount:observations.length,batchCount:ingested.length,ingested,generated,failed},null,2));})().catch(error=>{console.error(error.message);process.exitCode=1});
