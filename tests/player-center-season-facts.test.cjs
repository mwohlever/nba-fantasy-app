/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),test=require('node:test');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {normalizeCoreSeasonFacts,normalizeBulkSeasonPage,SeasonFactsReader,seasonReadFacts}=require('../lib/player-center/seasonFacts.ts');
const {normalizeCenterLog,normalizeCenterNflSummary,enrichNflGame,CenterEspnReader}=require('../lib/player-center/espn.ts');
const {summarizeHistory,compareHistories,draftSortStats,comparisonStats,actualFantasyPoints}=require('../lib/player-center/comparison.ts');
const {PlayerCenterService}=require('../lib/player-center/service.ts');
const {presentProfile}=require('../lib/player-center/presentation.ts');
const {fantasyTrend}=require('../lib/player-center/fantasyTrend.ts');
const fixture=name=>structuredClone(require(`./fixtures/player-center/season-facts/${name}.json`));
const at='2026-11-06T20:00:00.000Z',now=Date.parse(at),scoring=sport=>({sport,settings:null,basis:'legacy_defaults'});
function history(name,sport,id,year){const games=normalizeCenterLog(fixture(name+'-log'),{sport,providerPlayerId:id,season:year,phase:'regular',fetchedAt:at}).games;
 return {player:{sport,playerId:Number(id),providerPlayerId:id,nativePlayerId:id,name,position:sport==='nba'?'G':'QB',active:true,identity:'resolved'},season:year,phase:'regular',source:'provider',games,seasonFacts:normalizeCoreSeasonFacts(fixture(name+'-core'),sport,id,year,'regular',at),seasonStats:null,byeWeeks:null,providerRequests:0,coverage:{kind:'appearance_log',expectedGames:games.length,fetchedAt:at,freshness:'fresh',issues:[]}};}
function bulkPage(sport,rows,page=1,count=rows.length){const d=fixture(sport+'-bulk-sample');d.athletes=rows;d.pagination={page,count,limit:100,pages:Math.max(1,Math.ceil(count/100))};return d;}
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
for(const [name,id,year,total,gp]of [['castle','4845367',2027,237.8,8],['curry','3975',2027,294.7,7]])test(name+' published six scoring totals reconcile exactly with completed logs and canonical scorer',()=>{
 const h=history(name,'nba',id,year),p=presentProfile(h,scoring('nba'),at);assert.equal(p.windows.season.basis,'published_season');assert.equal(p.windows.season.totals.fantasy_points,total);assert.equal(p.windows.season.observedAverages.fantasy_points,total/gp);
 assert.equal(h.games.filter(g=>g.status==='final').length,gp);assert.ok(Math.abs(h.games.reduce((n,g)=>n+actualFantasyPoints(g,'G',scoring('nba')),0)-total)<1e-9);
 const partial={...h,games:h.games.slice(0,1)};assert.equal(summarizeHistory(partial,'season',scoring('nba'),at).averages.fantasy_points,total/gp);
});
test('Burrow all seven summaries including September 13 reconcile to published 169.60 and 24.23/game',()=>{
 const h=history('burrow','nfl','3915511',2026);h.games=h.games.map(g=>enrichNflGame(g,normalizeCenterNflSummary(fixture('burrow-summary-'+g.eventId),g.eventId),'captured summary'));
 const p=presentProfile(h,scoring('nfl'),at);assert.equal(p.windows.season.expectedGames,7);assert.equal(h.seasonFacts.stats.fumbles_lost,1);assert.equal(h.games.find(g=>g.eventId==='401872925').gameAt.slice(0,10),'2026-09-13');
 assert.ok(Math.abs(h.games.reduce((n,g)=>n+actualFantasyPoints(g,'QB',scoring('nfl')),0)-169.6)<1e-9);assert.equal(p.windows.season.averages.fantasy_points.toFixed(2),'24.23');
 const frozen={sport:'nfl',basis:'slate_snapshot',settings:{sport:'nfl',scoring:{passingYards:0.08}}};assert.ok(summarizeHistory(h,'season',frozen,at).totals.fantasy_points>p.windows.season.totals.fantasy_points);
});
test('missing fumbles, turnovers or GP never become zero or fall back to a limited log average',()=>{
 for(const [name,sport,id,year,field]of [['burrow','nfl','3915511',2026,'fumbles_lost'],['castle','nba','4845367',2027,'turnovers']]){
 const h=history(name,sport,id,year);h.seasonFacts.stats[field]=null;const s=summarizeHistory(h,'season',scoring(sport),at);assert.equal(s.averages.fantasy_points,null);assert.equal(s.metricComparable.fantasy_points,false);assert.equal(s.totals[field],null);
 h.seasonFacts.gamesPlayed=null;assert.ok(Object.values(summarizeHistory(h,'season',scoring(sport),at).averages).every(v=>v===null));
 }
 const d=fixture('burrow-core');d.splits.categories.find(c=>c.name==='general').stats.find(s=>s.name==='fumblesLost').value='0';assert.equal(normalizeCoreSeasonFacts(d,'nfl','3915511',2026,'regular',at).stats.fumbles_lost,null);
});
test('core identity, season, phase and ambiguous duplicate inputs are rejected',()=>{
 const d=fixture('castle-core');for(const [id,year,phase]of [['3975',2027,'regular'],['4845367',2026,'regular'],['4845367',2027,'postseason']])assert.throws(()=>normalizeCoreSeasonFacts(d,'nba',id,year,phase,at));
 d.splits.categories[0].stats.push(d.splits.categories[0].stats[0]);assert.throws(()=>normalizeCoreSeasonFacts(d,'nba','4845367',2027,'regular',at));
});
test('NFL live reader enriches only latest five, keeps all seven log rows and verifies recent independently',async()=>{
 const calls=[],reader=new CenterEspnReader(async url=>{calls.push(url);if(url.includes('/statistics'))return json(fixture('burrow-core'));if(url.includes('/gamelog'))return json(fixture('burrow-log'));if(url.includes('/stats?'))return json(fixture('burrow-stats'));return json(fixture('burrow-summary-'+new URL(url).searchParams.get('event')));},()=>now);
 const h=await reader.history(history('burrow','nfl','3915511',2026).player,2026,'regular');assert.equal(calls.length,8);assert.equal(calls.filter(u=>u.includes('/summary?')).length,5);assert.ok(!calls.some(u=>u.includes('event=401872925')));assert.equal(h.games.length,7);assert.equal(h.games.filter(g=>g.status==='final').length,5);assert.equal(h.coverage.recentVerified,true);
 const p=presentProfile(h,scoring('nfl'),at);assert.equal(p.windows.last5.metricComparable.fantasy_points,true);assert.equal(p.windows.season.averages.fantasy_points.toFixed(2),'24.23');assert.equal(fantasyTrend(p,'season').complete,false);assert.equal(fantasyTrend(p,'last5').complete,true);
});
test('season facts remain available when the game-log provider fails',async()=>{
 const reader=new CenterEspnReader(async url=>url.includes('/statistics')?json(fixture('burrow-core')):new Response('',{status:503}),()=>now);
 const h=await reader.history(history('burrow','nfl','3915511',2026).player,2026,'regular');assert.equal(h.games.length,0);assert.equal(presentProfile(h,scoring('nfl'),at).windows.season.averages.fantasy_points.toFixed(2),'24.23');
});
test('bulk parsing uses category-qualified numeric fields; NFL total fumbles stay unknown',()=>{
 const d=fixture('nfl-bulk-sample'),n=normalizeBulkSeasonPage(bulkPage('nfl',d.athletes),'nfl',2026,'regular',1,at);const burrow=n.rows.find(r=>r.providerPlayerId==='3915511');assert.equal(burrow.stats.passing_ints,6);assert.equal(burrow.stats.fumbles_lost,null);
 const h=history('burrow','nfl','3915511',2026);h.seasonFacts=burrow;assert.equal(summarizeHistory(h,'season',scoring('nfl'),at).averages.fantasy_points,null);assert.equal(summarizeHistory(h,'season',scoring('nfl'),at).averages.passing_yards,2115/7);
});
test('bulk cache paginates, deduplicates concurrent callers, publishes atomically and retains stale success on failure',async()=>{
 let time=now,calls=0,fail=false;const sample=fixture('nba-bulk-sample').athletes[0];const rows=Array.from({length:101},(_,i)=>({...structuredClone(sample),athlete:{id:String(i+1)}}));
 const reader=new SeasonFactsReader(async url=>{calls++;if(fail&&new URL(url).searchParams.get('page')==='2')return new Response('',{status:500});const page=Number(new URL(url).searchParams.get('page'));return json(bulkPage('nba',rows.slice((page-1)*100,page*100),page,101));},()=>time);
 const [a,b]=await Promise.all([reader.bulk('nba',2027),reader.bulk('nba',2027)]);assert.equal(calls,2);assert.equal(a.value.length,101);assert.equal(b.value.length,101);await reader.bulk('nba',2027);assert.equal(calls,2);
 time+=900001;fail=true;const stale=await reader.bulk('nba',2027);assert.equal(stale.freshness,'stale');assert.equal(stale.value.length,101);assert.ok(stale.error);await reader.bulk('nba',2027);assert.equal(calls,4);
 time+=30001;fail=false;const recovered=await reader.bulk('nba',2027);assert.equal(recovered.freshness,'fresh');assert.equal(recovered.value.length,101);
});
test('failed or conflicting bulk pages never publish a partial pool; malformed/mismatched schemas fail closed',async()=>{
 const rows=Array.from({length:100},(_,i)=>({...fixture('nba-bulk-sample').athletes[0],athlete:{id:String(i+1)}}));
 for(const mode of ['failure','duplicate','changed']){const reader=new SeasonFactsReader(async url=>{const page=Number(new URL(url).searchParams.get('page'));if(page===1)return json(bulkPage('nba',rows,1,101));if(mode==='failure')throw Error('ESPN down');const d=bulkPage('nba',[{...rows[0],athlete:{id:mode==='duplicate'?'1':'101'}}],2,101);if(mode==='changed')d.categories[0].names[0]='wrong';return json(d);},()=>now);assert.equal((await reader.bulk('nba',2027)).value,null);}
 const d=bulkPage('nba',fixture('nba-bulk-sample').athletes);d.requestedSeason.year=2026;assert.throws(()=>normalizeBulkSeasonPage(d,'nba',2027,'regular',1,at));
});
test('individual cache preserves factual freshness and never caches Group scores',async()=>{
 let time=now,calls=0,fail=false;const reader=new SeasonFactsReader(async()=>{calls++;if(fail)throw Error('offline');return json(fixture('castle-core'));},()=>time);
 const first=await reader.profile('nba','4845367',2027,'regular');assert.equal(seasonReadFacts(first).stats.turnovers,18);await reader.profile('nba','4845367',2027,'regular');assert.equal(calls,1);time+=900001;fail=true;const stale=seasonReadFacts(await reader.profile('nba','4845367',2027,'regular'));assert.equal(stale.freshness,'stale');assert.equal(stale.stats.turnovers,18);
});
test('eligible Draft IDs reconcile without name/native-ID guessing; NBA sorting is numeric with missing last',async()=>{
 const h=history('castle','nba','4845367',2027),c=history('curry','nba','3975',2027),unknown=structuredClone(h);unknown.player={...unknown.player,playerId:999,providerPlayerId:null,identity:'unresolved',name:'Unknown'};unknown.games=[];unknown.seasonFacts=null;
 const bulk=normalizeBulkSeasonPage(bulkPage('nba',fixture('nba-bulk-sample').athletes),'nba',2027,'regular',1,at).rows;
 const histories=[h,c,unknown].map(x=>({...x,seasonFacts:null}));let profiles=0,batches=0;
 const repo={catalog:async()=>({players:histories.map(x=>x.player),readAt:at}),histories:async()=>structuredClone(histories)};
 const service=new PlayerCenterService(repo,{bulkSeason:async()=>{batches++;return{value:bulk,freshness:'fresh',fetchedAt:at,error:null};},history:async()=>{profiles++;throw Error('no individual fanout');}},()=>now);
 const input={sport:'nba',season:2027,window:'season',metric:'fantasy_points',ascending:false,scoring:scoring('nba'),eligiblePlayerIds:[h.player.playerId,c.player.playerId]};
 const a=await service.comparisons(input);assert.equal(a.coverage.canSort,true);assert.deepEqual(a.players.map(r=>r.player.name),['curry','castle']);assert.equal(profiles,0);assert.equal(batches,1);
 const b=await service.comparisons({...input,ascending:true,eligiblePlayerIds:[...input.eligiblePlayerIds,999]});assert.equal(b.coverage.canSort,false);assert.deepEqual(b.players.map(r=>r.player.name),['castle','curry','Unknown']);assert.equal(b.players.at(-1).observedAverage,null);
});
test('duplicate provider mappings cannot borrow bulk facts, even when local IDs differ',async()=>{
 const h=history('castle','nba','4845367',2027),duplicate=structuredClone(h);duplicate.player.playerId=999;const histories=[h,duplicate].map(x=>({...x,seasonFacts:null,games:[]}));
 const repo={catalog:async()=>({players:histories.map(x=>x.player),readAt:at}),histories:async()=>histories};const service=new PlayerCenterService(repo,{bulkSeason:async()=>({value:[h.seasonFacts],freshness:'fresh',fetchedAt:at,error:null})},()=>now);
 const result=await service.comparisons({sport:'nba',season:2027,window:'season',metric:'points',ascending:false,scoring:scoring('nba')});assert.equal(result.coverage.canSort,false);assert.ok(result.players.every(r=>r.observedAverage===null));
});
test('NFL factual sorting can certify eligible QBs while missing total fumbles disables complete FP sorting',()=>{
 const h=history('burrow','nfl','3915511',2026);h.seasonFacts=normalizeBulkSeasonPage(bulkPage('nfl',fixture('nfl-bulk-sample').athletes),'nfl',2026,'regular',1,at).rows.find(r=>r.providerPlayerId==='3915511');
 const input={sport:'nfl',season:2026,window:'season',metric:'passing_yards',ascending:false,scoring:scoring('nfl')};assert.equal(compareHistories(input,[h],at,at).coverage.canSort,true);assert.equal(compareHistories({...input,metric:'fantasy_points'},[h],at,at).coverage.canSort,false);
});
test('profile retains stored older appearances when live enrichment only covers the latest five',async()=>{
 const h=history('burrow','nfl','3915511',2026);const older=enrichNflGame(h.games.find(g=>g.eventId==='401872925'),normalizeCenterNflSummary(fixture('burrow-summary-401872925'),'401872925'),'stored');
 const repo={catalog:async()=>({players:[h.player],readAt:at}),profileHistory:async()=>({...h,games:[older]})};const service=new PlayerCenterService(repo,{history:async()=>structuredClone(h)},()=>now);const p=await service.profile({sport:'nfl',playerId:h.player.playerId,season:2026,phase:'regular',scoring:scoring('nfl')});assert.equal(p.games.length,7);assert.equal(p.gameFantasyPoints['401872925'],14.16);
});
test('Draft dropdown simplification leaves negative inputs in scoring/profile contracts',()=>{
 assert.ok(!draftSortStats(comparisonStats.nba).includes('turnovers'));assert.ok(!draftSortStats(comparisonStats.QB).includes('passing_ints'));assert.ok(comparisonStats.nba.includes('turnovers'));assert.ok(comparisonStats.QB.includes('passing_ints'));
 for(const k of ['points','rebounds','assists','steals','blocks','fantasy_points'])assert.ok(draftSortStats(comparisonStats.nba).includes(k));
});
test('bulk acquisition timestamps are compared against completion time, not the earlier database-read cutoff',async()=>{
 let time=now;const h=history('castle','nba','4845367',2027),raw={...h,seasonFacts:null,games:[]};const repo={catalog:async()=>({players:[h.player],readAt:at}),histories:async()=>[raw]};
 const service=new PlayerCenterService(repo,{bulkSeason:async()=>{time+=1000;return{value:[{...h.seasonFacts,fetchedAt:new Date(time).toISOString()}],freshness:'fresh',fetchedAt:new Date(time).toISOString(),error:null};}},()=>time);
 const r=await service.comparisons({sport:'nba',season:2027,window:'season',metric:'fantasy_points',ascending:false,scoring:scoring('nba')});assert.equal(r.coverage.canSort,true);assert.equal(r.source,'bulk_provider');
});
test('stale published values stay visible but never certify a complete Draft ranking',()=>{
 const h=history('castle','nba','4845367',2027);h.seasonFacts.freshness='stale';const r=compareHistories({sport:'nba',season:2027,window:'season',metric:'fantasy_points',ascending:false,scoring:scoring('nba')},[h],at,at);assert.equal(r.coverage.canSort,false);assert.equal(r.players[0].observedAverage,29.725);assert.equal(r.players[0].coverage.freshness,'stale');
});
test('zero GP is explicit known absence; unknown GP and missing eligible players cannot be inferred as zero',()=>{
 const h=history('castle','nba','4845367',2027),zero=structuredClone(h);zero.player={...zero.player,playerId:2,providerPlayerId:'2'};zero.seasonFacts={...zero.seasonFacts,providerPlayerId:'2',gamesPlayed:0};zero.games=[];const input={sport:'nba',season:2027,window:'season',metric:'points',ascending:false,scoring:scoring('nba')};assert.equal(compareHistories(input,[h,zero],at,at).coverage.canSort,true);assert.equal(summarizeHistory(zero,'season',scoring('nba'),at).averages.points,null);zero.seasonFacts.gamesPlayed=null;assert.equal(compareHistories(input,[h,zero],at,at).coverage.canSort,false);
});
test('recent verification does not require complete season GP or season fantasy inputs',async()=>{
 const core=fixture('burrow-core');core.splits.categories.find(c=>c.name==='general').stats=core.splits.categories.find(c=>c.name==='general').stats.filter(s=>!['gamesPlayed','fumblesLost'].includes(s.name));const stats=fixture('burrow-stats');for(const c of stats.categories)for(const row of c.statistics??[])if(row.season.year===2026&&c.labels.includes('GP'))row.stats[c.labels.indexOf('GP')]='--';
 const reader=new CenterEspnReader(async url=>url.includes('/statistics')?json(core):url.includes('/gamelog')?json(fixture('burrow-log')):url.includes('/stats?')?json(stats):json(fixture('burrow-summary-'+new URL(url).searchParams.get('event'))),()=>now);
 const h=await reader.history(history('burrow','nfl','3915511',2026).player,2026,'regular'),p=presentProfile(h,scoring('nfl'),at);assert.equal(p.windows.season.averages.fantasy_points,null);assert.equal(p.windows.last5.metricComparable.fantasy_points,true);
});
test('large bulk pools fetch bounded pages with at most three network requests in flight',async()=>{
 const sample=fixture('nba-bulk-sample').athletes[0],rows=Array.from({length:301},(_,i)=>({...structuredClone(sample),athlete:{id:String(i+1)}}));let active=0,max=0,calls=0;
 const reader=new SeasonFactsReader(async url=>{calls++;active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));const page=Number(new URL(url).searchParams.get('page'));active--;return json(bulkPage('nba',rows.slice((page-1)*100,page*100),page,rows.length));},()=>now);
 const result=await reader.bulk('nba',2027);assert.equal(result.value.length,301);assert.equal(calls,4);assert.equal(max,3);
});
test('a stale durable snapshot retains older history even when the observation table has no rows',async()=>{
 const h=history('burrow','nfl','3915511',2026),snapshot={...structuredClone(h),coverage:{...h.coverage,freshness:'stale'}};const live={...structuredClone(h),games:h.games.slice(0,5)};const repo={catalog:async()=>({players:[h.player],readAt:at}),profileSnapshot:async()=>snapshot,profileHistory:async()=>({...h,games:[]})};const service=new PlayerCenterService(repo,{history:async()=>live},()=>now);
 const p=await service.profile({sport:'nfl',playerId:h.player.playerId,season:2026,phase:'regular',scoring:scoring('nfl')});assert.equal(p.games.length,7);assert.ok(p.games.some(g=>g.eventId==='401872925'));
});
