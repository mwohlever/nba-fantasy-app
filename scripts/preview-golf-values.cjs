/* Local preview only: node scripts/preview-golf-values.cjs /tmp/season.json EVENT_ID */
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename,
}).outputText,filename);
const {golfValueInputsFromEspn}=require('../lib/golf/valueEspn.ts');
const {buildGolfValues}=require('../lib/golf/valueModel.ts');
const [file,eventId,metadataFile]=process.argv.slice(2);
if(!file||!eventId)throw new Error('Supply local ESPN season JSON and target event ID');
const input=golfValueInputsFromEspn(JSON.parse(fs.readFileSync(file,'utf8')),eventId);
// Optional local array keyed by ESPN ID; export existing stored/provider metadata, not names.
if(metadataFile){
 const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
 const byId=new Map(metadata.map(p=>[String(p.espn_player_id),p]));
 input.players=input.players.map(p=>{const m=byId.get(p.playerId);return {...p,owgrRank:m?.owgr_rank,owgrUpdatedAt:m?.owgr_updated_at,isAmateur:m?.is_amateur===true};});
}
const result=buildGolfValues(input);
const n=result.players.length;
const statusCounts={};for(const p of input.players)for(const h of p.history)statusCounts[h.status]=(statusCounts[h.status]??0)+1;
const roster=indices=>{const players=indices.map(i=>result.players[i]);const prices=players.map(p=>p.pricing.suggestedSalary);return {players:players.map(p=>p.name),suggestedTotal:prices.some(p=>p===null)?null:prices.reduce((a,b)=>a+b,0)};};
const prices=result.players.map(p=>p.pricing.suggestedSalary).filter(p=>p!==null);
console.log(JSON.stringify({version:result.version,tournament:input.eventName,cutoff:input.startsAt,field:n,events:input.usedEvents.length,
 skippedEvents:input.skippedEvents,statusCounts,owgrCoverage:result.owgrCoverage,top10:result.players.slice(0,10),
 salaryRange:prices.length?[Math.min(...prices),Math.max(...prices)]:null,unpriced:result.players.filter(p=>p.pricing.status==='unpriced').length,
 limitedHistory:result.players.filter(p=>p.limitedHistory).length,
 examples:n>=4?[roster([0,1,2,3]),roster([0,Math.floor(n/3),Math.floor(2*n/3),n-1]),roster([Math.floor(n/2)-2,Math.floor(n/2)-1,Math.floor(n/2),Math.floor(n/2)+1])]:[],
},null,2));
