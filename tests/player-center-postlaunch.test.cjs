/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic Burrow 6/7 and Castle complete-coverage cases; no live data or writes.
const assert=require('node:assert/strict'),test=require('node:test');
const {host,nodes,context}=require('./helpers/scores-harness.cjs');
require('react').useId=()=> 'postlaunch';
const {presentProfile}=require('../lib/player-center/presentation.ts');
const {PlayerCenterService}=require('../lib/player-center/service.ts');
const {compareHistories}=require('../lib/player-center/comparison.ts');
const {seasonTables}=require('../lib/player-center/seasonTables.ts');
const Browser=require('../components/player-center/ResearchBrowser.tsx').default;
const Profile=require('../components/player-center/PlayerCenter.tsx').default;
const capture=require('../data/player-center-preview/captured.json');
const now=Date.parse('2026-11-06T12:00:00Z'),asOf=new Date(now).toISOString();
const scoring=sport=>({sport,basis:'legacy_defaults',settings:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=t=>Array.isArray(t)?t.map(text).join(' '):t&&typeof t==='object'?text(t.props?.children):t==null?'':String(t);
function history(sport){
 const h=structuredClone(capture.histories.find(h=>h.player.sport===sport&&h.player.position===(sport==='nfl'?'QB':'F/C')));
 h.player.name=sport==='nfl'?'Joe Burrow':'Stephon Castle';h.season=sport==='nfl'?2026:2027;
 h.coverage={kind:'appearance_log',expectedGames:sport==='nfl'?7:6,fetchedAt:asOf,freshness:'fresh',issues:[]};
 h.games=Array.from({length:6},(_,i)=>({...structuredClone(h.games[0]),season:h.season,eventId:String(500+i),gameAt:`2026-10-${20+i}T20:00:00Z`,status:'final',participation:'played',issues:[],stats:sport==='nfl'?{passing_yards:100*(i+1),passing_tds:0,passing_ints:0,rushing_yards:0,rushing_tds:0,receiving_yards:0,receiving_tds:0,receptions:0,fumbles_lost:0}:{points:10,rebounds:0,assists:0,steals:0,blocks:0,turnovers:0}}));
 return h;
}
test('Burrow partial coverage shows observed averages and nullable metrics consistently across windows',async()=>{
 context.group='a';const h=history('nfl'),p=presentProfile(h,scoring('nfl'),asOf);
 assert.equal(p.windows.season.metricComparable.fantasy_points,false);
 for(const [w,value]of [['season',14],['last3',20],['last5',16]])assert.equal(p.windows[w].observedAverages.fantasy_points,value);
 const props={sport:'nfl',season:2026,identity:{id:h.player.playerId,name:h.player.name},loader:{profile:async()=>({...p,groupId:'a'})}};
 const component=host(Profile(props).type);component.render(props,true);await tick();const tree=component.render(props,true);
 assert.match(text(tree),/14/);assert.match(text(tree),/6 scored \/ 6 observed.*1 missing games.*Observed average/);component.unmount();
 h.games[5].stats.fumbles_lost=null;const unknown=presentProfile(h,scoring('nfl'),asOf);
 assert.equal(unknown.gameFantasyPoints['505'],null);assert.equal(unknown.windows.last3.metricSamples.fantasy_points,2);assert.equal(unknown.windows.last3.observedAverages.fantasy_points,18);
 assert.equal(h.games[5].stats.fumbles_lost,null);
});
test('Castle complete coverage retains certified averages; NBA details remain present but secondary',()=>{
 const h=history('nba'),p=presentProfile(h,scoring('nba'),asOf);assert.equal(p.windows.season.metricComparable.fantasy_points,true);assert.equal(p.windows.season.observedAverages.fantasy_points,10);
 const tables=seasonTables(h.seasonStats,'nba','F/C');assert.ok(tables.filter(t=>!t.secondary).every(t=>t.columns.every(c=>['GP','MIN','PTS','REB','AST','STL','BLK','TO'].includes(c.label))));
 assert.ok(tables.some(t=>t.title==='Shooting per game'&&t.secondary));assert.ok(tables.some(t=>t.title==='Season totals'&&t.secondary));
});
test('bounded catalog reads use the same raw facts and canonical scoring as profiles, without mixing seasons',async()=>{
 const h=history('nfl'),calls=[],repo={catalog:async()=>({players:[h.player],readAt:asOf}),histories:async(sport,season)=>[{...structuredClone(h),season,games:[],coverage:{...h.coverage,freshness:'unavailable'}}]};
 const service=new PlayerCenterService(repo,{history:async(player,season)=>{calls.push(season);return {...structuredClone(h),season};}},()=>now);
 const input={sport:'nfl',season:2026,window:'last5',metric:'fantasy_points',ascending:false,scoring:scoring('nfl')};
 assert.equal((await service.comparisons(input)).players[0].observedAverage,null);
 assert.equal((await service.comparisons({...input,playerIds:[h.player.playerId]})).players[0].observedAverage,16);
 assert.equal((await service.comparisons({...input,window:'last3'})).players[0].observedAverage,20);
 const custom={...input.scoring,basis:'slate_snapshot',settings:{sport:'nfl',scoring:{passingYards:0.08}}};
 assert.equal((await service.comparisons({...input,scoring:custom})).players[0].observedAverage,32);
 assert.equal((await service.comparisons({...input,season:2025})).players[0].observedAverage,null);assert.deepEqual(calls,[2026]);
 await assert.rejects(service.comparisons({...input,playerIds:[1,2,3,4]}),/Invalid profile batch/);
});
test('catalog explicitly loads missing facts and numerically sorts the returned observed values',async()=>{
 context.group='a';const h=history('nfl'),empty={...structuredClone(h),games:[]},requests=[];
 const props={sport:'nfl',season:2026,onInspect(){},loader:{comparisons:async input=>{requests.push(input);return {groupId:'a',...compareHistories({...input,scoring:scoring('nfl')},[input.playerIds?h:empty],asOf,asOf)};}}};
 const component=host(Browser);component.render(props,true);await tick();let tree=component.render(props,true);
 const button=nodes(tree).find(n=>n.type==='button'&&text(n).includes('Load missing game stats'));assert.ok(button);button.props.onClick();component.render(props,true);await tick();tree=component.render(props,true);
 assert.equal(requests.at(-1).playerIds,String(h.player.playerId));assert.match(text(tree),/16/);assert.match(text(tree),/Observed-data sorting/);component.unmount();
});
for(const sport of ['nba','nfl'])test(`${sport}: one shared sample/coverage caption across all summary windows`,async()=>{
 context.group='a';const h=history(sport);if(sport==='nfl')h.games[5].stats.fumbles_lost=null;else for(const game of h.games)game.stats.minutes=30;
 const profile=presentProfile(h,scoring(sport),asOf),props={sport,season:h.season,identity:{id:h.player.playerId,name:h.player.name},loader:{profile:async()=>({...profile,groupId:'a'})}};
 const {WindowControl}=require('../components/player-center/PlayerCenter.tsx');
 const component=host(Profile(props).type);component.render(props,true);await tick();let tree=component.render(props,true);
 for(const window of ['season','last1','last3','last5']){
  nodes(tree).find(n=>n.type===WindowControl).props.onChange(window);tree=component.render(props);
  const caption=nodes(tree).filter(n=>n.props?.['aria-label']==='Summary sample and coverage');assert.equal(caption.length,1);
  assert.match(text(caption[0]),/observed games/);assert.match(text(caption[0]),sport==='nfl'?/partial coverage/:/Verified window/);
  const metrics=nodes(tree).find(n=>n.props?.className==='pc-metrics');assert.equal(nodes(metrics).filter(n=>n.type==='small').length,0);
  assert.ok(nodes(metrics).filter(n=>n.type==='span').every(n=>text(n).endsWith('/game')));
  if(sport==='nfl')assert.match(text(caption[0]),/Available samples:/);
 }
 if(sport==='nfl'){assert.equal(profile.windows.season.metricSamples.fantasy_points,5);assert.equal(profile.gameFantasyPoints['505'],null);}
 component.unmount();
});
