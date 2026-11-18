/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {normalizeNflFantasyPage,supplementNflFumbles,nflFantasyBulkFilter}=require('../lib/player-center/nflFantasyBulk.ts');
const {normalizeCoreSeasonFacts,SeasonFactsReader}=require('../lib/player-center/seasonFacts.ts');
const {PlayerCenterService}=require('../lib/player-center/service.ts');
const fixture=name=>structuredClone(require('./fixtures/player-center/nfl-fantasy-source/'+name+'.json'));
const at='2026-11-16T21:00:00Z',season=2026;
const payload=()=>({players:fixture('fantasy-sample').players.map(p=>({id:p.id,player:p}))});
const base=()=>[3915511,3918298,4362628].map(id=>({...normalizeCoreSeasonFacts(fixture('core-'+id),'nfl',String(id),season,'regular',at),stats:{...normalizeCoreSeasonFacts(fixture('core-'+id),'nfl',String(id),season,'regular',at).stats,fumbles_lost:null}}));
test('bounded actual-season source reconciles all eight common inputs before decoding sparse fumble zeros',()=>{
 const actual=normalizeNflFantasyPage(payload(),season).rows,rows=supplementNflFumbles(base(),actual);
 assert.deepEqual(rows.map(r=>r.stats.fumbles_lost),[1,1,0]);assert.ok(rows[2].issues.includes('fumbles_lost_sparse_zero'));
 assert.deepEqual(JSON.parse(nflFantasyBulkFilter(2026,2000)).players.filterStatsForTopScoringPeriodIds.additionalValue,['002026']);
 for(const mutate of [r=>r.gamesPlayed++,r=>r.stats.passing_yards++,r=>r.stats.receiving_tds=null,r=>r.providerPlayerId='999',r=>r.phase='postseason',r=>r.stats.receptions=1]){
  const rows=base();mutate(rows[0]);assert.equal(supplementNflFumbles(rows,actual)[0].stats.fumbles_lost,null);
 }
 const missing=base();assert.equal(supplementNflFumbles(missing,[])[0].stats.fumbles_lost,null);
 const invalid=structuredClone(actual);invalid.find(r=>r.id==='3915511').stats['72']=-1;assert.equal(supplementNflFumbles(base(),invalid)[0].stats.fumbles_lost,null);
});
test('projections, other years, weekly records, absent GP and duplicate identities never imply zero',()=>{
 for(const patch of [{statSourceId:1},{seasonId:2025},{statSplitTypeId:1},{scoringPeriodId:10},{id:'102026'}]){
  const d=payload();Object.assign(d.players[0].player.stats[0],patch);assert.ok(!normalizeNflFantasyPage(d,season).rows.some(r=>r.id===String(d.players[0].id)));
 }
 const d=payload();delete d.players[0].player.stats[0].stats['210'];assert.equal(normalizeNflFantasyPage(d,season).rows.length,2);
 const duplicate=payload();duplicate.players.push(duplicate.players[0]);assert.throws(()=>normalizeNflFantasyPage(duplicate,season),/identity/);
 const noStats=payload();delete noStats.players[0].player.stats[0].stats;assert.equal(normalizeNflFantasyPage(noStats,season).rows.length,2);
});
function bulkPage(){const rows=base();const map={general:['gamesPlayed'],passing:['passingYards','passingTouchdowns','interceptions'],rushing:['rushingYards','rushingTouchdowns'],receiving:['receivingYards','receivingTouchdowns','receptions']};return{league:{slug:'nfl'},requestedSeason:{year:2026,type:{type:2}},pagination:{count:3,page:1,pages:1,limit:100},categories:Object.entries(map).map(([name,names])=>({name,names})),athletes:rows.map(r=>({athlete:{id:r.providerPlayerId},categories:[{name:'general',values:[r.gamesPlayed]},{name:'passing',values:[r.stats.passing_yards,r.stats.passing_tds,r.stats.passing_ints]},{name:'rushing',values:[r.stats.rushing_yards,r.stats.rushing_tds]},{name:'receiving',values:[r.stats.receiving_yards,r.stats.receiving_tds,r.stats.receptions]}]}))};}
test('complement cache deduplicates, retains valid stale totals, retries failures boundedly, and preserves basic facts on cold failure',async()=>{
 let now=Date.parse(at),calls=0,fail=false;const reader=new SeasonFactsReader(async url=>{calls++;if(url.includes('fantasy.espn')&&fail)throw Error('offline');return new Response(JSON.stringify(url.includes('fantasy.espn')?payload():bulkPage()));},()=>now);
 const [a,b]=await Promise.all([reader.bulk('nfl',season),reader.bulk('nfl',season)]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.value[2].stats.fumbles_lost,0);assert.equal(a.freshness,'fresh');
 now+=900001;fail=true;const stale=await reader.bulk('nfl',season);assert.equal(stale.freshness,'stale');assert.equal(stale.value[0].stats.fumbles_lost,1);const count=calls;await reader.bulk('nfl',season);assert.equal(calls,count);
 const cold=new SeasonFactsReader(async url=>{if(url.includes('fantasy.espn'))throw Error('offline');return new Response(JSON.stringify(bulkPage()));},()=>now);const fallback=await cold.bulk('nfl',season);assert.equal(fallback.value[0].stats.passing_yards,2795);assert.equal(fallback.value[0].stats.fumbles_lost,null);
});
test('eligible ID mapping supports complete and explicitly partial NFL fantasy rankings without profile requests',async()=>{
 const facts=supplementNflFumbles(base(),normalizeNflFantasyPage(payload(),season).rows),players=facts.map((f,i)=>({sport:'nfl',playerId:i+10,providerPlayerId:f.providerPlayerId,nativePlayerId:f.providerPlayerId,name:['Burrow','Allen','Chase'][i],position:i===2?'WR':'QB',active:true,identity:'resolved'}));players.push({...players[0],playerId:99,providerPlayerId:'999999',name:'Missing'});
 const service=new PlayerCenterService({catalog:async()=>({players,readAt:at})},{bulkSeason:async()=>({value:facts,freshness:'fresh',fetchedAt:at,error:null}),history:async()=>{throw Error('No profile fanout');}},()=>Date.parse(at)+1000);
 const input={sport:'nfl',season,metric:'fantasy_points',ascending:false,scoring:{sport:'nfl',basis:'legacy_defaults',settings:null}};
 const partial=await service.seasonCatalog(input);assert.equal(partial.fantasySortAvailable,true);assert.equal(partial.fantasySortComplete,false);assert.equal(partial.coverage.canSort,false);assert.equal(partial.players.at(-1).player.playerId,99);
 const complete=await service.seasonCatalog({...input,eligiblePlayerIds:[10,11,12]});assert.equal(complete.fantasySortComplete,true);assert.equal(complete.coverage.canSort,true);
 for(const ascending of [true,false]){const r=await service.seasonCatalog({...input,ascending});assert.equal(r.players.at(-1).player.playerId,99);const nums=r.players.slice(0,-1).map(p=>p.observedAverage);assert.deepEqual(nums,[...nums].sort((a,b)=>ascending?a-b:b-a));}
 const collision=new PlayerCenterService({catalog:async()=>({players:[...players,{...players[0],playerId:100}],readAt:at})},{bulkSeason:async()=>({value:facts,freshness:'fresh',fetchedAt:at,error:null})},()=>Date.parse(at)+1000);const r=await collision.seasonCatalog(input);assert.equal(r.players.find(p=>p.player.playerId===10).observedAverage,null);
});


test('sparse-zero evidence is field-specific: captured zero omission agrees with Core, positive totals stay explicit',()=>{
 const actual=normalizeNflFantasyPage(payload(),season).rows;
 const original=base(),positiveOnly=original.map(f=>({...f,stats:{...f.stats,fumbles_lost:actual.find(a=>a.id===f.providerPlayerId)?.stats['72']??null}}));
 const joined=supplementNflFumbles(original,actual);
 const count=(rows,position)=>rows.filter(f=>(position==='QB'?['3915511','3918298']:['4362628']).includes(f.providerPlayerId)&&f.stats.fumbles_lost!==null).length;
 assert.deepEqual(['QB','WR'].map(p=>[p,count(positiveOnly,p),count(joined,p)]),[['QB',2,2],['WR',0,1]]);
 for(const fact of joined){const core=normalizeCoreSeasonFacts(fixture('core-'+fact.providerPlayerId),'nfl',fact.providerPlayerId,season,'regular',at);assert.equal(fact.stats.fumbles_lost,core.stats.fumbles_lost);}
 const burrow=fixture('core-3915511');assert.equal(joined.find(f=>f.providerPlayerId==='3915511').stats.fumbles_lost,1);assert.equal(burrow.splits.categories.find(c=>c.name==='rushing').stats.find(s=>s.name==='rushingFumblesLost').value,0);
});
test('GP-only sparse payloads and cross-season joins stay unknown, even when published offensive inputs are zero',()=>{
 const f=base()[0];for(const key of Object.keys(f.stats))if(key!=='fumbles_lost')f.stats[key]=0;
 const incomplete={id:f.providerPlayerId,season,gamesPlayed:f.gamesPlayed,stats:{'210':f.gamesPlayed}};
 assert.equal(supplementNflFumbles([f],[incomplete])[0].stats.fumbles_lost,null);
 const valid=normalizeNflFantasyPage(payload(),season).rows;
 assert.equal(supplementNflFumbles(base(),valid.map(a=>({...a,season:season-1})))[0].stats.fumbles_lost,null);
});
