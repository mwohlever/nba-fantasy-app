/* eslint-disable @typescript-eslint/no-require-imports */
// Public provider GETs -> local JSON/SQL only. No SQL connection or apply mode.
const fs=require('node:fs'),path=require('node:path');
const {assert,hash,registerTypescript}=require('./lib/playerCenterRollout.cjs');
registerTypescript();
const {buildBatch,batchFiles}=require('./lib/playerCenterNbaBatch.cjs');
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
async function main(){
  if(!args.includes('--manifest')||(!args.includes('--out')&&!args.includes('--list-targets'))||(!args.includes('--canary')&&!args.includes('--batch'))){console.log('Usage: node scripts/stage-player-center-nba.cjs --manifest FILE (--canary | --batch N) [--batch-size 25] [--as-of UTC] [--before-cache-json FILE] (--list-targets | --out NEW_DIRECTORY)');return;}
  const plan=JSON.parse(fs.readFileSync(option('--manifest'),'utf8')),{manifestSha256,...body}=plan;assert(hash(body)===manifestSha256,'Mapping manifest checksum mismatch');
  const size=args.includes('--batch-size')?Number(option('--batch-size')):25,index=Number(option('--batch'));
  assert(Number.isInteger(size)&&size>=1&&size<=25,'Batch size must be 1–25');
  const selected=args.includes('--canary')?plan.universe.filter(p=>p.nbaPlayerId===2544&&p.providerPlayerId==='1966'):plan.universe.slice((index-1)*size,index*size);
  assert(args.includes('--canary')||Number.isInteger(index)&&index>=1&&index<=Math.ceil(plan.universe.length/size),'Invalid batch index');
  assert(selected.length>0&&selected.length<=25,'Empty/oversized selection');
  if(args.includes('--list-targets')){console.log(JSON.stringify(selected.map(p=>p.providerPlayerId)));return;}
  const out=option('--out');assert(out&&!fs.existsSync(out),'A new output directory is required');
  const asOf=args.includes('--as-of')?option('--as-of'):undefined;
  assert(args.includes('--canary')||asOf&&Number.isFinite(Date.parse(asOf)),'Bulk batches require a shared --as-of UTC cutoff');
  const before=args.includes('--before-cache-json')?JSON.parse(fs.readFileSync(option('--before-cache-json'),'utf8')):[];
  let requests=0,lastRequest=0;
  async function get(url){
    assert(++requests<=50,'50-request acquisition cap');
    const delay=Math.max(0,2100-(Date.now()-lastRequest));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));lastRequest=Date.now();
    const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});assert(r.ok,`Provider HTTP ${r.status}`);
    const text=await r.text();assert(Buffer.byteLength(text)<=3_000_000,'Provider response size cap');return JSON.parse(text);
  }
  const acquired=[];
  for(const p of selected){
    assert(/^\d+$/.test(p.providerPlayerId),'Invalid reviewed ID');
    const base=`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${p.providerPlayerId}`;
    const log=await get(`${base}/gamelog?season=2027`),fetchedAt=new Date().toISOString();
    const stats=await get(`${base}/stats?season=2027&seasontype=2`),checkedAt=new Date().toISOString();
    acquired.push({...p,log,stats,fetchedAt,checkedAt,...(asOf?{asOf}: {})});
  }
  const batch=buildBatch(plan,acquired,before),files={'batch-manifest.json':JSON.stringify(batch,null,2)+'\n','provider-acquisition.json':JSON.stringify(acquired,null,2)+'\n',...batchFiles(plan,batch)};
  fs.mkdirSync(out,{recursive:true});for(const[name,content]of Object.entries(files))fs.writeFileSync(path.join(out,name),content,{flag:'wx'});
  fs.writeFileSync(path.join(out,'SHA256SUMS'),Object.keys(files).sort().map(name=>`${hash(files[name])}  ${name}`).join('\n')+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,batchId:batch.batchId,batchSha256:batch.batchSha256,providerRequests:requests,databaseWrites:0,review:batch.review},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
