/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {normalizeEspnNflEventFumbles}=require('../lib/analytics/providers/espnNflEventFumbles.ts');
const {acquireNflObservations}=require('../lib/analytics/nfl/observationAcquisition.ts');
const captured=require('./fixtures/player-center/nfl-summary-401872991.json');
const request={eventId:'401872991',fetchedAt:'2026-10-30T00:00:00Z'};
test('derived captured response with omitted groups produces unknown evidence, not a transport failure or zero',()=>{
  const value=structuredClone(captured);for(const team of value.boxscore.players)team.statistics=team.statistics.filter(g=>g.name!=='fumbles');
  for(const team of value.boxscore.teams)team.statistics=team.statistics.filter(s=>s.name!=='fumblesLost');
  const actual=normalizeEspnNflEventFumbles(value,request);assert.deepEqual(actual.athletes,[]);assert.deepEqual(actual.zeroEligibleTeams,[]);assert.ok(actual.issues.includes('fumbles_evidence_unavailable'));
});
test('captured explicit zero/positive LOST survive, and only reconciled team lists authorize absence zeros',()=>{
  const actual=normalizeEspnNflEventFumbles(captured,request);assert.ok(actual.athletes.some(a=>a.fumblesLost===0));assert.ok(actual.zeroEligibleTeams.includes('8'));assert.ok(actual.zeroEligibleTeams.includes('22')); // Independently verified final team LOST=0.
  const other=require('./fixtures/player-center/nfl-summary.json');const result=normalizeEspnNflEventFumbles(other,{...request,eventId:other.header.id});assert.ok(result.athletes.some(a=>a.fumblesLost>0));
});
test('a nonreconciled team total never authorizes zeros for omitted athletes',()=>{
  const value=structuredClone(captured);value.boxscore.players[0].statistics.find(g=>g.name==='fumbles').totals=['99','1','3'];
  for(const team of value.boxscore.teams)team.statistics=team.statistics.filter(s=>s.name!=='fumblesLost');
  assert.deepEqual(normalizeEspnNflEventFumbles(value,request).zeroEligibleTeams,[]);
});
test('malformed LOST, duplicate categories and wrong event remain fatal',()=>{
  const value=structuredClone(captured);const group=value.boxscore.players[0].statistics.find(g=>g.name==='fumbles');group.athletes[0].stats[1]='--';assert.throws(()=>normalizeEspnNflEventFumbles(value,request),/invalid/);
  const duplicate=structuredClone(captured);duplicate.boxscore.players[0].statistics.push(structuredClone(duplicate.boxscore.players[0].statistics.find(g=>g.name==='fumbles')));assert.throws(()=>normalizeEspnNflEventFumbles(duplicate,request),/Duplicate/);
  assert.throws(()=>normalizeEspnNflEventFumbles(captured,{...request,eventId:'1'}),/identity/);
});
test('unknown QB LOST withholds that row, reports incomplete coverage and retains factual RB acquisition',async()=>{
  const qb={provider:'espn',providerPlayerId:'1',position:'QB',season:2026,phase:'regular',week:1,eventId:'10',gameAt:'2026-09-14T17:00:00Z',team:{providerId:'8',abbreviation:'DET'},opponent:{providerId:'22',abbreviation:'ARI'},homeAway:'home',stats:{completions:1,passingAttempts:1,passingYards:10,passingTouchdowns:0,interceptions:0,rushingAttempts:1,rushingYards:1,rushingTouchdowns:0,receivingTargets:null,receptions:null,receivingYards:null,receivingTouchdowns:null,fumblesLost:null},provenance:{source:'https://espn.test/log',fetchedAt:request.fetchedAt,knownAt:null}};
  const rb={...qb,providerPlayerId:'2',position:'RB',stats:{...qb.stats,completions:null,passingAttempts:null,passingYards:null,passingTouchdowns:null,interceptions:null,receivingTargets:0,receptions:0,receivingYards:0,receivingTouchdowns:0,fumblesLost:0}};
  const incomplete=[];const rows=await acquireNflObservations({eligible:[{localPlayerId:1,providerPlayerId:'1',position:'QB'},{localPlayerId:2,providerPlayerId:'2',position:'RB'}],season:2026,finalEvents:[{providerEventId:'10',season:2026,phase:'regular',completed:true}],gameLogs:[qb,rb],fetchFumbles:async()=>({eventId:'10',source:'https://espn.test/summary',fetchedAt:request.fetchedAt,athletes:[],zeroEligibleTeams:[]}),onIncomplete:i=>incomplete.push(i)});
  assert.equal(rows.length,1);assert.equal(rows[0].position,'RB');assert.deepEqual(incomplete,[{eventId:'10',providerPlayerId:'1',reason:'fumbles_lost_unknown'}]);
});
