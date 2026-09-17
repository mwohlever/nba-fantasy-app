/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),path=require('node:path');
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){return request.startsWith('@/')?resolve(path.join(process.cwd(),request.slice(2)),parent,...rest):resolve(request,parent,...rest)};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const {hasNflResearchPositionOpportunity}=require('../lib/analytics/nfl/researchCandidates.ts');
const {NFL_PROJECTION_V2,NFL_PROJECTION_V2_COLDSTART_V1,NFL_PROJECTION_V2_CURRENT_SEASON_V1,projectNflV2O1Raw,nflProjectionCacheRecord}=require('../lib/analytics/nfl/projectionInfrastructure.ts');
const {generateNflProjectionStatCache}=require('../lib/analytics/nfl/projectionGeneration.server.ts');
function row({id,season=2025,day=1,knownDay=2,event,player=7,provider='42',position='RB',attempts=10,yards=10,phase='regular'}={}) { const stamp=`${season}-09-${String(day).padStart(2,'0')}T17:00:00Z`, known=`${season}-${season===2026?'09':'10'}-${String(knownDay).padStart(2,'0')}T17:00:00Z`; return {id:id??season*100+day,provider:'espn',provider_player_id:provider,provider_event_id:event??`${season}-${day}`,local_player_id:player,position,season,week:day,phase,game_at:stamp,known_at:known,completions:position==='QB'?20:null,passing_attempts:position==='QB'?30:null,passing_yards:position==='QB'?240:null,passing_touchdowns:position==='QB'?2:null,interceptions:position==='QB'?1:null,rushing_attempts:attempts,rushing_yards:yards,rushing_touchdowns:0,receiving_targets:position==='QB'?null:4,receptions:position==='QB'?null:2,receiving_yards:position==='QB'?null:16,receiving_touchdowns:0,fumbles_lost:0}; }
const asOf='2026-10-01T00:00:00Z';
const previous=count=>Array.from({length:count},(_,index)=>row({season:2025,day:index+1,knownDay:index+2,attempts:10,yards:10,event:`p${index+1}`}));
const current=count=>Array.from({length:count},(_,index)=>row({season:2026,day:index+1,knownDay:index+2,attempts:100,yards:200,event:`c${index+1}`}));
function project(history,position='RB'){return projectNflV2O1Raw({playerId:7,providerPlayerId:'42',position,season:2026,asOf,history});}
test('cold start fills O1 windows independently from only the immediately preceding season',()=>{
  for (const currentCount of [0,1,2,3,4,5,6,7,8]) { const result=project([...previous(8),...current(currentCount)]); assert.ok(result); assert.equal(result.sample.opportunity_current_games,Math.min(5,currentCount)); assert.equal(result.sample.opportunity_prior_games,Math.max(0,5-Math.min(5,currentCount))); assert.equal(result.sample.production_current_games,Math.min(8,currentCount)); assert.equal(result.sample.production_prior_games,Math.max(0,8-Math.min(8,currentCount))); assert.equal(result.sample.opportunity_window_games,5); assert.equal(result.sample.production_window_games,8); assert.equal(result.confidence,currentCount<5?'low':'normal'); }
  const one=project([...previous(8),...current(1)]); assert.equal(one.components.rushing_attempts,28); assert.equal(one.projectedStats.rushing_yards,28*(270/170)); // 1x 100 + 4x 10 opportunity; ratio totals: (1x 200 + 7x 10) / (1x 100 + 7x 10)
});
test('prior-only history supports a Bowers-style absence, but no history abstains',async()=>{
  const priorOnly=project(previous(5)); assert.ok(priorOnly); assert.equal(priorOnly.confidence,'low'); assert.equal(priorOnly.sample.current_season_games,0); assert.equal(priorOnly.sample.prior_season_games,5);
  assert.equal(project([]),null);
  const writes=[]; const output=await generateNflProjectionStatCache({targetSeason:2026,asOf,players:[{localPlayerId:7,providerPlayerId:'42',position:'RB'},{localPlayerId:8,providerPlayerId:'43',position:'TE'}],repository:{loadHistories:async()=>new Map([[7,previous(5)],[8,[]]]),appendStatCache:async rows=>writes.push(...rows)}});
  assert.equal(output.cached,1); assert.deepEqual(output.unavailable,[{playerId:8,reason:'zero_current_or_prior_season_history'}]); assert.equal(writes[0].model_version,NFL_PROJECTION_V2);
});
test('cold start never reaches an older season or postseason and preserves strict as-of correction semantics',()=>{
  const old=row({season:2024,day:1,attempts:999,yards:999,event:'old'}), onlyThreePrior=previous(3), postseason=row({season:2025,day:12,attempts:999,yards:999,event:'post',phase:'postseason'}), futureGame=row({season:2026,day:20,attempts:999,yards:999,event:'future'}), laterCorrection=row({id:999,season:2025,day:1,knownDay:30,attempts:999,yards:999,event:'p1'}); futureGame.game_at='2026-10-02T17:00:00Z'; laterCorrection.known_at='2026-10-02T17:00:00Z';
  const result=project([old,...onlyThreePrior,postseason,futureGame,laterCorrection]); assert.ok(result); assert.equal(result.sample.prior_season_games,3); assert.equal(result.sample.opportunity_window_games,3); assert.equal(result.components.rushing_attempts,10); assert.equal(result.projectedStats.rushing_yards,10);
});
test('zero offensive opportunity never consumes an O1 opportunity slot, including a special-teams fumble',()=>{
  const qualifying=previous(5), newestZero=row({season:2025,day:10,event:'zero',attempts:0,yards:0}); newestZero.receiving_targets=0; newestZero.fumbles_lost=1;
  const currentGame=current(1)[0], result=project([...qualifying,newestZero,currentGame]); assert.ok(result);
  assert.equal(result.sample.opportunity_current_games,1); assert.equal(result.sample.opportunity_prior_games,4); assert.equal(result.components.rushing_attempts,28);
  // Production remains the existing independent 8-row window, including the factual zero-opportunity fumble row.
  assert.equal(result.sample.production_window_games,7); assert.equal(result.sample.production_prior_games,6);
});
test('QB/RB/WR/TE use their frozen position-relevant opportunity adapters',()=>{
  const values={QB:{passing_attempts:0,rushing_attempts:1},RB:{rushing_attempts:0,receiving_targets:1},WR:{rushing_attempts:1,receiving_targets:0},TE:{rushing_attempts:0,receiving_targets:1}};
  for(const [position,stats] of Object.entries(values)){const inactive=row({season:2025,position,attempts:0,yards:0,event:`zero-${position}`}), active=row({season:2025,position,attempts:0,yards:0,event:`active-${position}`}); inactive.passing_attempts=0; inactive.rushing_attempts=0; inactive.receiving_targets=0; Object.assign(active,stats); assert.equal(hasNflResearchPositionOpportunity(position,{stats:{passingAttempts:inactive.passing_attempts,rushingAttempts:inactive.rushing_attempts,receivingTargets:inactive.receiving_targets}}),false); assert.equal(hasNflResearchPositionOpportunity(position,{stats:{passingAttempts:active.passing_attempts,rushingAttempts:active.rushing_attempts,receivingTargets:active.receiving_targets}}),true); const result=project([inactive,active],position); assert.ok(result); assert.equal(result.sample.opportunity_window_games,1);}
  const noOpportunity=row({season:2025,position:'WR',attempts:0,yards:0,event:'no-opportunity'}); noOpportunity.receiving_targets=0; const result=project([noOpportunity],'WR'); assert.equal(result,null);
});
test('all supported positions retain raw-stat bridge generation; D/ST and K remain outside the active population contract',()=>{
  for (const position of ['QB','RB','WR','TE']) assert.ok(project(previous(8),position));
  const source=fs.readFileSync('lib/analytics/nfl/observationRepository.server.ts','utf8'); assert.match(source,/\["QB", "RB", "WR", "TE"\]/); assert.doesNotMatch(source,/"D\/ST"|"K"/);
});
test('cold-start cache rows are raw-only and model versions remain distinguishable',()=>{
  const p=project(previous(8)), cache=nflProjectionCacheRecord({playerId:7,providerPlayerId:'42',position:'RB',season:2026,asOf,generatedAt:asOf,projection:p});
  assert.equal(NFL_PROJECTION_V2_CURRENT_SEASON_V1,'nfl-v2-o1-opportunity5-production8-v1'); assert.equal(NFL_PROJECTION_V2_COLDSTART_V1,'nfl-v2-o1-opportunity5-production8-coldstart-v1'); assert.equal(NFL_PROJECTION_V2,'nfl-v2-o1-opportunity5-production8-coldstart-v2'); assert.equal(cache.model_version,NFL_PROJECTION_V2); assert.equal(cache.fantasy_points,undefined); assert.equal(cache.group_id,undefined); assert.equal(cache.slate_id,undefined);
});
