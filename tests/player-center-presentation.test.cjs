/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args);};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const {presentProfile,scoringBreakdown}=require('../lib/player-center/presentation.ts');
const {compareHistories,actualFantasyPoints}=require('../lib/player-center/comparison.ts');
const {gameStatus,gameColumns,gameCell,formatStat,venueLabel,signedPoints,gameIdentifier}=require('../lib/player-center/display.ts');
const {seasonTables}=require('../lib/player-center/seasonTables.ts');
const {slateCenterSeason}=require('../lib/player-center/types.ts');
const capture=require('../data/player-center-preview/captured.json'),asOf=capture.capturedAt;
const rules=sport=>({sport,settings:null,basis:'legacy_defaults'}),history=(sport,position,season)=>structuredClone(capture.histories.find(h=>h.player.sport===sport&&h.player.position===position&&(!season||h.season===season)));
const input=(overrides={})=>({sport:'nba',season:2027,window:'season',metric:'fantasy_points',ascending:false,scoring:rules('nba'),...overrides});

test('captured identities, seasons and provider IDs stay exact across the shared profile contract',()=>{
 for(const h of capture.histories){const p=presentProfile(h,rules(h.player.sport),asOf);assert.equal(p.player.playerId,h.player.playerId);assert.ok(p.games.every(g=>g.providerPlayerId===p.player.providerPlayerId&&g.season===p.season));assert.equal(p.asOf,asOf);}
 const nba=history('nba','F/C',2027),prior=history('nba','F/C',2026);
 assert.equal(nba.games.length,2);assert.equal(prior.games.length,60);
 assert.equal(presentProfile(nba,rules('nba'),asOf).windows.last5.metricComparable.fantasy_points,false);
 assert.equal(presentProfile(prior,rules('nba'),asOf).windows.season.sampleSize,60);
});
test('breakdowns use canonical frozen coefficients and agree with the canonical total',()=>{
 for(const h of capture.histories){const scoring={sport:h.player.sport,settings:{sport:h.player.sport,scoring:h.player.sport==='nba'?{points:2,assists:3}:{receptions:0.5,passingTouchdowns:6}},basis:'slate_snapshot'};
 for(const g of h.games){const total=actualFantasyPoints(g,h.player.position,scoring),parts=scoringBreakdown(g,h.player.position,scoring);if(total!==null)assert.ok(Math.abs(parts.reduce((sum,p)=>sum+p.points,0)-total)<1e-8);}}
});
test('unknown fumbles remain unavailable in both total and detailed fantasy presentation',()=>{
 const h=history('nfl','QB'),g=h.games.find(g=>g.status==='final');g.stats.fumbles_lost=null;
 const p=presentProfile(h,rules('nfl'),asOf);assert.equal(p.gameFantasyPoints[g.eventId],null);
 const part=p.gameBreakdowns[g.eventId].find(p=>p.label==='Fumbles lost');assert.equal(part.value,null);assert.equal(part.points,null);
 assert.equal(p.windows.season.metricComparable.fantasy_points,false);
});
test('kicker real stats are preserved while fantasy scores and breakdowns stay unavailable',()=>{
 const h=history('nfl','K'),p=presentProfile(h,rules('nfl'),asOf);
 assert.equal(p.fantasyScoringAvailable,false);assert.ok(p.games.some(g=>g.stats.field_goals_made!==null));
 assert.ok(Object.values(p.gameFantasyPoints).every(v=>v===null));assert.ok(Object.values(p.gameBreakdowns).every(v=>v.length===0));
 assert.match(p.kickerScoringDecision,/not been configured/);
});
test('window comparisons retain their pool coverage gate, observed samples and missing-last ordering',()=>{
 const pool=capture.histories.filter(h=>h.player.sport==='nba'&&h.season===2027);
 const last5=compareHistories(input({window:'last5'}),pool,asOf,asOf);assert.equal(last5.coverage.canSort,false);assert.deepEqual(last5.players.map(p=>p.player.name),['LeBron James','Stephen Curry']);
 const season=compareHistories(input(),pool,asOf,asOf);assert.equal(season.coverage.canSort,true);assert.equal(season.players.length,2);assert.ok(season.players[0].rankableAverage>=season.players[1].rankableAverage);
 const stale=structuredClone(pool);stale[0].coverage.freshness='stale';assert.equal(compareHistories(input(),stale,asOf,asOf).coverage.canSort,false);
 const unknown=structuredClone(pool);unknown[0].coverage.expectedGames=null;assert.equal(compareHistories(input({metric:'points'}),unknown,asOf,asOf).coverage.canSort,false);
 const kicker=capture.histories.filter(h=>h.player.position==='K');assert.equal(compareHistories(input({sport:'nfl',season:2026,position:'K',scoring:rules('nfl')}),kicker,asOf,asOf).coverage.canSort,false);
});
test('position-specific columns, real zeros, missing fields, DNP and live statuses remain distinct',()=>{
 const h=history('nba','F/C',2027),g=h.games[0];assert.match(gameCell(g,'FG'),/^\d+–\d+$/);assert.equal(formatStat(0),'0');assert.equal(formatStat(null),'—');
 assert.ok(gameColumns('nfl','QB').includes('passing_yards'));assert.ok(!gameColumns('nfl','WR').includes('passing_yards'));assert.ok(gameColumns('nfl','K').includes('long_field_goal'));
 assert.equal(venueLabel({...g,homeAway:null}),'·');assert.equal(venueLabel({...g,homeAway:'away'}),'@');assert.equal(gameStatus({...g,participation:'dnp'}),'DNP');assert.equal(gameStatus({...g,status:'live'}),'Live');assert.equal(gameStatus({...g,status:'unknown'}),'Unverified');assert.equal(gameStatus({...g,status:'scheduled'}),'Scheduled');
});
test('slate profile context preserves NBA ending years and NFL named/January starting years',()=>{
 assert.equal(slateCenterSeason('nba',{date:'2026-10-23'}),2027);assert.equal(slateCenterSeason('nba',{date:'2026-05-23'}),2026);
 assert.equal(slateCenterSeason('nfl',{date:'2027-01-01',display_name:'2026 Week 18'}),2026);assert.equal(slateCenterSeason('nfl',{date:'2027-01-01'}),2026);
});


test('NBA season tables preserve provider averages, counts, shooting units and missing totals without deriving values',()=>{
 const h=history('nba','F/C',2027),before=structuredClone(h.seasonStats),tables=seasonTables(h.seasonStats,'nba','F/C');
 assert.deepEqual(h.seasonStats,before,'presentation never mutates source');
 const avg=tables.find(t=>t.title==='Season averages'),total=tables.find(t=>t.title==='Season totals'),shoot=tables.find(t=>t.title==='Shooting per game');
 assert.equal(avg.secondary,false);assert.ok(total.secondary&&shoot.secondary);
 assert.equal(avg.rows[0].values[avg.columns.findIndex(c=>c.label==='PTS')],'15.5');
 assert.equal(avg.columns.find(c=>c.label==='GP').unit,'games');assert.equal(avg.columns.find(c=>c.label==='MIN').unit,'min/G');
 assert.ok(!avg.columns.some(c=>c.label==='FG'));assert.ok(!total.columns.some(c=>c.label==='GP'),'missing totals GP is not synthesized');
 assert.equal(shoot.columns.find(c=>c.label==='FG').unit,'made–att/G');assert.equal(shoot.columns.find(c=>c.label==='FG%').unit,'%');
 const nulls=structuredClone(h.seasonStats);nulls.categories[0].fields.find(f=>f.label==='PTS').value=null;
 const missing=seasonTables(nulls,'nba','F/C')[0];assert.equal(missing.rows[0].values[missing.columns.findIndex(c=>c.label==='PTS')],null);
});
test('season tables keep different team splits, repeated fields and professional seasons intact',()=>{
 const stats=history('nba','F/C',2026).seasonStats;const first=structuredClone(stats.categories[0]);first.teamId='999';stats.categories.push(first);
 const avg=seasonTables(stats,'nba','F/C').find(t=>t.title==='Season averages');assert.ok(avg.rows.length>=2);assert.ok(avg.rows.some(r=>r.team==='999'));
 const defense={season:2026,phase:'regular',expectedGames:null,issues:[],categories:[{name:'defensive',teamId:'12',fields:[{label:'YDS',value:'10'},{label:'YDS',value:null}]}]};
 const dst=seasonTables(defense,'nfl','D/ST')[0];assert.deepEqual(dst.rows[0].values,['10',null]);assert.equal(dst.columns.length,2);
 const unknown={...defense,categories:[{...defense.categories[0],fields:[{label:'NEW PROVIDER STAT',value:'1.4'}]}]};assert.equal(seasonTables(unknown,'nfl','D/ST')[0].columns[0].unit,'','unknown units are not guessed');
});
test('NFL position tables label per-attempt yards, preserve kicking points and omit irrelevant zero passing rows',()=>{
 const qb=seasonTables(history('nfl','QB').seasonStats,'nfl','QB');assert.deepEqual(qb.map(t=>t.title),['passing','rushing']);
 assert.equal(qb[0].columns.find(c=>c.label==='AVG').unit,'yd/att');assert.equal(qb[1].columns.find(c=>c.label==='AVG').unit,'yd/carry');
 const rb=seasonTables(history('nfl','RB').seasonStats,'nfl','RB');assert.deepEqual(rb.map(t=>t.title),['rushing','receiving']);
 const receiver=rb.find(t=>t.title==='receiving');assert.equal(receiver.columns.find(c=>c.label==='AVG').unit,'yd/rec');
 const k=seasonTables(history('nfl','K').seasonStats,'nfl','K');assert.deepEqual(k.map(t=>t.title),['kicking']);
 assert.equal(k[0].rows[0].values[k[0].columns.findIndex(c=>c.label==='PTS')],'44');assert.equal(k[0].columns.find(c=>c.label==='PTS').unit,'kick points');
 assert.ok(k[0].columns.some(c=>c.label==='1-19'&&c.unit==='made–att'));
});
test('signed fantasy contributions distinguish missing, zero, positive and negative canonical points',()=>{
 assert.equal(signedPoints(null),'—');assert.equal(signedPoints(undefined),'—');assert.equal(signedPoints(NaN),'—');
 assert.equal(signedPoints(0),'0');assert.equal(signedPoints(-0),'0');assert.equal(signedPoints(1.25),'+1.25');assert.equal(signedPoints(-2),'-2');
 const h=history('nba','F/C',2027),p=presentProfile(h,rules('nba'),asOf),g=h.games[0];
 assert.ok(p.gameBreakdowns[g.eventId].some(part=>signedPoints(part.points).startsWith('+')));
 assert.ok(p.gameBreakdowns[g.eventId].some(part=>signedPoints(part.points).startsWith('-')));
});


test('compact game identifiers keep local date, NFL week, venue and opponent without guessing missing metadata',()=>{
 const nba=history('nba','F/C',2027).games.find(g=>g.eventId==='401909093');assert.equal(gameIdentifier(nba,'nba'),'Oct 22 vs CLE');
 const nfl=history('nfl','QB').games.find(g=>g.eventId==='401872945');assert.equal(gameIdentifier(nfl,'nfl'),'W2 · Sep 20 vs IND');
 assert.match(gameIdentifier({...nfl,week:null,homeAway:null,opponent:null},'nfl'),/^Sep 20 · Opponent unavailable$/);
});
test('verified recovery fixtures provide complete season fantasy samples without changing scorer coefficients',()=>{
 for(const [position,event,expected]of [['RB','401872991',3.6],['QB','401872945',28.98],['WR','401872991',12]]){
  const h=history('nfl',position),p=presentProfile(h,rules('nfl'),asOf);
  assert.ok(Math.abs(p.gameFantasyPoints[event]-expected)<1e-9);assert.equal(p.windows.season.metricComparable.fantasy_points,true);
 }
});

const {fantasyTrendGames,defaultTrendPeriod,fantasyTrend,trendGeometry}=require('../lib/player-center/fantasyTrend.ts');
test('fantasy trends order completed games chronologically, respect identity/season/phase, and exclude DNP/live/future games',()=>{
 for(const sport of ['nba','nfl']){
  const h=history(sport,sport==='nba'?'F/C':'QB',sport==='nba'?2026:2026),p=presentProfile(h,rules(sport),asOf);
  const original=fantasyTrendGames(p);assert.ok(original.every((p,i)=>i===0||original[i-1].game.gameAt<=p.game.gameAt));
  for(const change of [{season:2001},{phase:'postseason'},{providerPlayerId:'other'},{status:'live'},{participation:'dnp'},{gameAt:'2030-01-01T00:00:00Z'}]){
   p.games=[{...h.games[0],...change}];assert.equal(fantasyTrendGames(p).length,0);
  }
 }
});
test('trend defaults and periods use verified counts without skipping an incomplete game to fill the window',()=>{
 const p=presentProfile(history('nba','F/C',2026),rules('nba'),asOf),all=fantasyTrendGames(p);
 assert.equal(defaultTrendPeriod(all),'last10');assert.equal(fantasyTrend(p,'last10').points.length,10);
 const last=all.at(-1);p.gameFantasyPoints[last.game.eventId]=null;
 const selected=fantasyTrend(p,'last5');assert.equal(selected.points.length,5);assert.equal(selected.points.at(-1).points,null);assert.equal(selected.verified,4);assert.equal(selected.complete,false);
 for(const size of [0,1,2,9])assert.equal(defaultTrendPeriod(all.slice(0,size)),'season');
 const onlyNine=all.slice(0,10).map((p,i)=>({...p,points:i===3?null:p.points}));assert.equal(defaultTrendPeriod(onlyNine),'season');
 assert.equal(defaultTrendPeriod(all.slice(0,11).map((p,i)=>({...p,points:i===10?null:p.points}))),'last10');
});
test('trend average/high/low use actual known values, retaining zero and negative scores while leaving gaps',()=>{
 const p=presentProfile(history('nfl','QB'),rules('nfl'),asOf),ordered=fantasyTrendGames(p);
 for(let i=0;i<ordered.length;i++)p.gameFantasyPoints[ordered[i].game.eventId]=[0,null,-2,10,2][i];
 const trend=fantasyTrend(p,'season');assert.equal(trend.verified,4);assert.equal(trend.average,2.5);assert.equal(trend.high,10);assert.equal(trend.low,-2);assert.equal(trend.complete,false);
 const geometry=trendGeometry(trend.points);assert.equal(geometry.path.split('M').length-1,2,'a gap starts a new line segment');assert.equal(geometry.coordinates[1].y,null);assert.ok(geometry.y(-2)>geometry.y(0));
 assert.equal(p.windows.season.metricComparable.fantasy_points,true,'chart never changes server comparison gates');
});
test('trend scores follow current Group and frozen snapshot canonical scoring with no cross-context reuse',()=>{
 for(const sport of ['nba','nfl']){
  const h=history(sport,sport==='nba'?'F/C':'QB',sport==='nba'?2027:2026);
  const settings={sport,scoring:sport==='nba'?{points:2,assists:3}:{passingTouchdowns:6,receptions:.5}};
  const group=presentProfile(h,{sport,settings,basis:'league_settings'},asOf),snapshot=presentProfile(h,{sport,settings,basis:'slate_snapshot'},asOf),defaults=presentProfile(h,rules(sport),asOf);
  const trend=fantasyTrend(group,'season');assert.notEqual(trend.average,fantasyTrend(defaults,'season').average);assert.equal(trend.average,fantasyTrend(snapshot,'season').average);
  for(const point of trend.points)assert.equal(point.points,actualFantasyPoints(point.game,h.player.position,{sport,settings,basis:'league_settings'}));
 }
});
test('empty/single/two-game/zero-score trend geometry stays finite and does not fabricate data',()=>{
 const p=presentProfile(history('nba','F/C',2027),rules('nba'),asOf);
 for(const size of [0,1,2]){
  const clone={...p,games:p.games.slice(0,size)},trend=fantasyTrend(clone,'season'),geometry=trendGeometry(trend.points);
  assert.equal(trend.points.length,size);assert.equal(defaultTrendPeriod(trend.points),'season');assert.ok(!/NaN|Infinity/.test(geometry.path));
  if(!size){assert.equal(trend.average,null);assert.equal(trend.high,null);assert.equal(trend.low,null);}
  if(size===1)assert.equal(geometry.coordinates[0].x,50);
 }
 for(const g of p.games)p.gameFantasyPoints[g.eventId]=0;
 assert.equal(fantasyTrend(p,'season').average,0);assert.ok(!/NaN|Infinity/.test(trendGeometry(fantasyTrend(p,'season').points).path));
 for(const g of p.games)p.gameFantasyPoints[g.eventId]=null;
 assert.equal(fantasyTrend(p,'season').average,null);assert.equal(trendGeometry(fantasyTrend(p,'season').points).path.trim(),'');
});
test('partial or stale seasons qualify observed trends without certifying a full period or ranking',()=>{
 const h=history('nba','F/C',2027);h.coverage.expectedGames=null;
 let p=presentProfile(h,rules('nba'),asOf),trend=fantasyTrend(p,'season');assert.equal(trend.average,38.9);assert.equal(trend.complete,false);assert.equal(p.windows.season.metricComparable.fantasy_points,false);
 h.coverage.freshness='stale';p=presentProfile(h,rules('nba'),asOf);assert.equal(fantasyTrend(p,'season').complete,false);
 const kicker=presentProfile(history('nfl','K'),rules('nfl'),asOf);assert.equal(fantasyTrendGames(kicker).length,0);
});
