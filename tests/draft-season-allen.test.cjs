/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),test=require('node:test');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {PlayerCenterService}=require('../lib/player-center/service.ts');
const {CenterEspnReader,normalizeCenterLog,normalizeCenterNflSummary,enrichNflGame}=require('../lib/player-center/espn.ts');
const {presentProfile}=require('../lib/player-center/presentation.ts');
const {loadVisibleGameStats}=require('../components/player-center/visibleGameStats.ts');
const fixture=name=>structuredClone(require('./fixtures/player-center/allen-2026/'+name+'.json'));
const now=Date.parse('2026-11-16T20:00:00Z'),at=new Date(now).toISOString(),scoring=sport=>({sport,basis:'legacy_defaults',settings:null});
const player=(id,name,position,sport='nba',extra={})=>({playerId:id,providerPlayerId:String(id+100),nativePlayerId:String(id+1000),name,position,sport,active:true,identity:'resolved',...extra});
const fact=(p,stats,gp=10)=>({sport:p.sport,providerPlayerId:p.providerPlayerId,season:p.sport==='nba'?2027:2026,phase:'regular',gamesPlayed:gp,stats,source:'https://espn.test/published',fetchedAt:at,freshness:'fresh',issues:[]});
const nbaStats=n=>({points:n,rebounds:20,assists:10,steals:5,blocks:2,turnovers:3,minutes:200});
const nflStats=n=>({passing_yards:n,passing_tds:10,passing_ints:1,rushing_yards:20,rushing_tds:0,receiving_yards:0,receiving_tds:0,receptions:0,fumbles_lost:null});
function service(players,facts){let bulkCalls=0;const s=new PlayerCenterService({catalog:async()=>({players,readAt:at}),histories:async()=>{throw Error('Catalog must not depend on observation history');}}, {bulkSeason:async()=>{bulkCalls++;return{value:facts,fetchedAt:at,freshness:'fresh',error:null};},history:async()=>{throw Error('No per-player catalog requests');}},()=>now);return{s,calls:()=>bulkCalls};}
for(const sport of ['nba','nfl'])test(sport+' season catalog sorts all numeric values in both directions, including explicit zero, before unknowns',async()=>{
 const pos=sport==='nba'?'G':'QB',players=[player(1,'Zulu',pos,sport),player(2,'Alpha',pos,sport),player(3,'Beta',pos,sport),player(4,'A missing',pos,sport),player(5,'Middle',pos,sport)],values=[300,120,0,undefined,220];
 const facts=players.flatMap((p,i)=>values[i]===undefined?[]:[fact(p,sport==='nba'?nbaStats(values[i]):nflStats(values[i]))]);const {s}=service(players,facts);const input={sport,season:sport==='nba'?2027:2026,metric:sport==='nba'?'points':'passing_yards',scoring:scoring(sport),eligiblePlayerIds:players.map(p=>p.playerId)};
 for(const [ascending,expected]of [[false,[1,5,2,3,4]],[true,[3,2,5,1,4]]]){const r=await s.seasonCatalog({...input,ascending});assert.deepEqual(r.players.map(p=>p.player.playerId),expected);assert.equal(r.players.at(-1).observedAverage,null);assert.equal(r.window,'season');assert.equal(r.coverage.canSort,false);}
 const complete=await s.seasonCatalog({...input,eligiblePlayerIds:[1,2,3,5],ascending:false});assert.equal(complete.coverage.canSort,true);
});
test('eligible IDs, inactive eligible rows, positions, unresolved mappings and duplicate provider IDs are handled explicitly',async()=>{
 const players=[player(1,'Guard','G'),player(2,'Forward','F/C'),player(3,'Inactive eligible','G','nba',{active:false}),player(4,'Unknown','G','nba',{identity:'unresolved',providerPlayerId:null}),player(5,'Collision','G','nba',{providerPlayerId:'101'})];const facts=players.filter(p=>p.providerPlayerId).map(p=>fact(p,nbaStats(p.playerId*10)));const {s}=service(players,facts);
 const r=await s.seasonCatalog({sport:'nba',season:2027,metric:'points',position:'G',ascending:false,scoring:scoring('nba'),eligiblePlayerIds:[1,3,4,999]});assert.deepEqual(r.players.map(p=>p.player.playerId),[3,1,4]);assert.equal(r.players.find(p=>p.player.playerId===1).observedAverage,null);assert.equal(r.coverage.missingEligiblePlayers,1);assert.equal(r.coverage.canSort,false);
});
test('NBA fantasy catalog retains all negative scoring inputs and frozen rules; NFL bulk fantasy is disabled',async()=>{
 const nba=player(1,'NBA','G'),nfl=player(2,'NFL','QB','nfl');const a=service([nba],[fact(nba,nbaStats(100))]).s;const input={sport:'nba',season:2027,metric:'fantasy_points',ascending:false,scoring:scoring('nba')};const defaultResult=await a.seasonCatalog(input);assert.equal(defaultResult.players[0].observedAverage,15);const custom=await a.seasonCatalog({...input,scoring:{sport:'nba',basis:'slate_snapshot',settings:{sport:'nba',scoring:{points:2}}}});assert.equal(custom.players[0].observedAverage,25);
 const b=service([nfl],[fact(nfl,nflStats(1000))]).s;const r=await b.seasonCatalog({sport:'nfl',season:2026,metric:'fantasy_points',ascending:false,scoring:scoring('nfl')});assert.equal(r.fantasySortAvailable,false);assert.equal(r.coverage.canSort,false);assert.equal(r.players[0].observedAverage,null);
});
test('season requests never mix historical provider facts or opened-profile scores into the catalog',async()=>{
 const p=player(1,'Exact ID','G');const {s}=service([p],[fact(p,nbaStats(100))]);s.profileFacts.set('nba:2027:1',{at:now,history:{player:p,seasonFacts:fact(p,nbaStats(99999))}});
 const r=await s.seasonCatalog({sport:'nba',season:2027,metric:'points',ascending:false,scoring:scoring('nba')});assert.equal(r.players[0].observedAverage,10);
});
const allen=player(1,'Josh Allen','QB','nfl',{providerPlayerId:'3918298',nativePlayerId:'3918298'});
function reader(){const calls=[];return{calls,reader:new CenterEspnReader(async url=>{calls.push(url);const name=url.includes('/statistics')?'core':url.includes('/gamelog')?'log':url.includes('/stats?')?'stats':'summary-'+new URL(url).searchParams.get('event');return new Response(JSON.stringify(fixture(name)));},()=>now)};}
test('Allen Weeks 1/2 lack receiving and fumble inputs in the raw log; actual summaries yield 35.66 and 40.82',()=>{
 const games=normalizeCenterLog(fixture('log'),{sport:'nfl',providerPlayerId:'3918298',season:2026,phase:'regular',fetchedAt:at}).games;
 for(const [week,fp]of [[1,35.66],[2,40.82]]){const g=games.find(g=>g.week===week);for(const key of ['receptions','receiving_yards','receiving_tds','fumbles_lost'])assert.equal(g.stats[key],null);assert.equal(g.status,'unknown');const verified=enrichNflGame(g,normalizeCenterNflSummary(fixture('summary-'+g.eventId),g.eventId),'captured ESPN');const h={player:allen,season:2026,phase:'regular',games:[verified],coverage:{kind:'appearance_log',freshness:'fresh',expectedGames:1,issues:[]},seasonStats:null,byeWeeks:null,providerRequests:0};assert.equal(presentProfile(h,scoring('nfl'),at).gameFantasyPoints[g.eventId],fp);}
});
test('initial five-game cap is preserved; displayed older games complete in a cached bounded batch',async()=>{
 const {reader:r,calls}=reader();const base=await r.history(allen,2026,'regular');assert.equal(calls.filter(u=>u.includes('/summary?')).length,5);assert.equal(base.games.length,9);assert.equal(base.games.find(g=>g.week===1).stats.fumbles_lost,null);
 const ids=base.games.filter(g=>g.week<=4).map(g=>g.eventId);const complete=await r.history(allen,2026,'regular',undefined,ids);assert.equal(calls.filter(u=>u.includes('/summary?')).length,9);const p=presentProfile(complete,scoring('nfl'),at);assert.equal(p.gameFantasyPoints['401872660'],35.66);assert.equal(p.gameFantasyPoints['401872932'],40.82);const before=calls.length;const again=await r.history(allen,2026,'regular');assert.equal(calls.length,before);assert.equal(presentProfile(again,scoring('nfl'),at).gameFantasyPoints['401872660'],35.66);
});
test('Player Center automatically fills the visible older rows and retains its four windows',async()=>{
 const {reader:r}=reader();let requests=0;const loader={profile:async input=>{requests++;return presentProfile(await r.history(allen,2026,'regular',undefined,input.events?.split(',')),scoring('nfl'),at);}};const p=await loadVisibleGameStats(loader,{sport:'nfl',playerId:1,season:2026},new AbortController().signal,10);assert.equal(requests,2);assert.equal(p.gameFantasyPoints['401872660'],35.66);assert.equal(p.gameFantasyPoints['401872932'],40.82);assert.deepEqual(Object.keys(p.windows),['last1','last3','last5','season']);
});
test('older-game failure preserves known scores; unknown fields remain null; arbitrary events never fetch summaries',async()=>{
 const {reader:r,calls}=reader();const h=await r.history(allen,2026,'regular'),base=presentProfile(h,scoring('nfl'),at);let n=0;const loader={profile:async()=>{if(n++)throw Error('ESPN unavailable');return base;}};const p=await loadVisibleGameStats(loader,{sport:'nfl',playerId:1,season:2026},new AbortController().signal,10);assert.equal(p.gameFantasyPoints['401872660'],null);assert.ok(p.coverage.issues.includes('older_game_statistics_unavailable'));const before=calls.length;await assert.rejects(r.history(allen,2026,'regular',undefined,['123456789']),/not in this player log/);assert.equal(calls.length,before);
});
