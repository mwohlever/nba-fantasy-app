/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit reviewed targets -> bounded ESPN GETs -> LOCAL review bundle only. No production write capability.
const fs=require('node:fs'),path=require('node:path');
const {assert,hash,registerTypescript}=require('./lib/playerCenterRollout.cjs');registerTypescript();
const {CenterEspnReader}=require('../lib/player-center/espn.ts');
const {buildNflBatch,nflBatchFiles,acquireNflHistory}=require('./lib/playerCenterNflBatch.cjs');
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
async function main(){
 if(!['--targets','--season','--as-of','--out'].every(flag=>args.includes(flag))){console.log('Usage: node scripts/stage-player-center-nfl.cjs --targets REVIEWED_TARGETS_JSON --season START_YEAR --as-of COMMON_UTC_CUTOFF [--before-cache-json FILE] --out NEW_DIRECTORY');return;}
 const targets=JSON.parse(fs.readFileSync(option('--targets'),'utf8')),season=Number(option('--season')),asOf=option('--as-of'),out=option('--out');
 assert(Array.isArray(targets)&&targets.length>0&&targets.length<=5,'Select 1–5 reviewed NFL identities');assert(!fs.existsSync(out),'New output directory required');
 assert(Number.isInteger(season)&&season>=2000&&season<=new Date().getUTCFullYear()&&Number.isFinite(Date.parse(asOf))&&Date.parse(asOf)<=Date.now(),'Explicit valid season/cutoff required');
 for(const p of targets)assert(Number.isSafeInteger(p.playerId)&&p.playerId>0&&typeof p.providerPlayerId==='string'&&/^[1-9]\d*$/.test(p.providerPlayerId)&&['QB','RB','WR','TE','K','D/ST'].includes(p.position)&&typeof p.name==='string','Exact catalog IDs/position/name required');
 let requests=0,last=0,limitHit=false;
 const reader=new CenterEspnReader(async(url,init)=>{
  if(requests>=40){limitHit=true;throw Error('40-provider-request batch cap');}requests++;
  const delay=Math.max(0,2100-(Date.now()-last));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));last=Date.now();
  const response=await fetch(url,init);assert(response.ok,`Provider HTTP ${response.status}`);return response;
 });
 const histories=[];
 for(const p of targets){
  const player={sport:'nfl',playerId:p.playerId,name:p.name,position:p.position,active:true,nativePlayerId:p.providerPlayerId,providerPlayerId:p.providerPlayerId,identity:'resolved'},before=requests;
  // Three bounded passes reuse cached summaries; the global 40-GET cap still applies.
  const history=await acquireNflHistory(reader,player,season);
  assert(!limitHit,'40-request cap reached: reduce target batch size');
  history.providerRequests=requests-before;histories.push(history);
 }
 const beforeCache=args.includes('--before-cache-json')?JSON.parse(fs.readFileSync(option('--before-cache-json'),'utf8')):[];
 const batch=buildNflBatch(targets,histories,{season,asOf,checkedAt:new Date().toISOString(),beforeCache});
 const files={'batch-manifest.json':JSON.stringify(batch,null,2)+'\n','provider-normalization.json':JSON.stringify(histories,null,2)+'\n',...nflBatchFiles(batch)};
 fs.mkdirSync(out,{recursive:true});for(const[name,body]of Object.entries(files))fs.writeFileSync(path.join(out,name),body,{flag:'wx'});
 fs.writeFileSync(path.join(out,'SHA256SUMS'),Object.keys(files).sort().map(name=>`${hash(files[name])}  ${name}`).join('\n')+'\n',{flag:'wx'});
 console.log(JSON.stringify({out,providerRequests:requests,databaseWrites:0,batchSha256:batch.batchSha256,rows:batch.cache.map(c=>({provider:c.provider_player_id,complete:c.complete,observed:c.observed_games,expected:c.expected_games}))},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
