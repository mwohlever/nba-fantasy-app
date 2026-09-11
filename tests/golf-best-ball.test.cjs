/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const repositoryRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(repositoryRoot, request.slice(2))
    : request;

  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });

  module._compile(compiled.outputText, filename);
};

const { scoreBestBall } = require('../lib/golf/bestBall.ts');
const { scoreGolfCompetition } = require('../lib/golf/scoring.ts');
const { eligibleGolfPlayerIds } = require('../lib/golf/eligibleRoster.ts');
const { calculateGolfTeamResults } = require('../lib/golf/teamResults.ts');
const { acceptGolfHole } = require('../lib/golf/holeAcceptance.ts');
const h = (strokes, number=1) => ({hole_number:number,strokes,relative_to_par:strokes == null ? null : strokes-4});
const event = (id, holes, round=1, status='active') => ({player_id:id,status,fantasy_score:0,golf_rounds:[{round_number:round,golf_holes:holes}]});
const roster = {teamId:20,periods:[{period:'full_tournament',playerIds:[1,2,3,4]}]};
const input = events => ({slateId:7,acceptedEvents:events,roster,rosterPeriodType:'full_tournament',rounds:[1]});
const score = events => scoreBestBall(input(events));
const first = events => score(events).rounds[0].holes[0];

test('birdie wins with attribution; all four contributions finalize the hole',()=>{
 const result=first([3,4,5,4].map((s,i)=>event(i+1,[h(s)])));
 assert.equal(result.strokes,3);assert.equal(result.relativeToPar,-1);assert.deepEqual(result.contributorPlayerIds,[1]);assert.equal(result.status,'final');
});
test('eagle beats birdie and lowest strokes wins independently of display text',()=>{
 assert.equal(first([event(1,[{...h(3),score_display:'Eagle'}]),event(2,[h(2)])]).primaryContributorPlayerId,2);
});
test('ties preserve sorted contributors and stable primary regardless of input ordering',()=>{
 const events=[event(4,[h(3)]),event(2,[h(3)]),event(1,[h(4)])];
 assert.deepEqual(first(events).contributorPlayerIds,[2,4]);assert.equal(first(events).primaryContributorPlayerId,2);
 assert.deepEqual(first(events),first([...events].reverse()));
});
test('one score provisional, later better improves and worse does not',()=>{
 const events=[event(1,[h(4)])];assert.equal(first(events).status,'provisional');
 assert.deepEqual(first(events).unresolvedPlayerIds,[2,3,4]);
 assert.equal(first([...events,event(2,[h(3)])]).strokes,3);
 assert.equal(first([...events,event(2,[h(5)])]).strokes,4);
});
test('missing/retracted results are unscored, winning retraction falls back',()=>{
 assert.equal(first([]).status,'unscored');assert.equal(score([]).strokes,null);assert.equal(score([]).toPar,null);
 assert.equal(first([event(1,[h(null)]),event(2,[h(4)])]).primaryContributorPlayerId,2);
 assert.equal(first([event(1,[h(null)]),event(2,[h(null)])]).status,'unscored');
});
test('split tees compare actual hole 10, never sequence index',()=>{
 const result=score([event(1,[h(3,10),h(5,1)]),event(2,[h(4,1),h(4,10)])]);
 assert.equal(result.rounds[0].holes[0].strokes,4);assert.equal(result.rounds[0].holes[9].strokes,3);
});
test('full tournament uses same roster across all four regulation rounds',()=>{
 const e=event(1,[]);e.golf_rounds=[1,2,3,4].map(round_number=>({round_number,golf_holes:[h(3)]}));
 const result=scoreBestBall({...input([e]),rounds:[4,2,1,3]});
 assert.deepEqual(result.rounds.map(r=>r.period),Array(4).fill('full_tournament'));
 assert.equal(result.strokes,12);assert.equal(result.toPar,-4);assert.equal(result.holesScored,4);
});
test('split periods use independent opening/weekend golfers solely by round',()=>{
 const split={teamId:20,periods:[{period:'opening',playerIds:[1]},{period:'weekend',playerIds:[2]}]};
 const events=[1,2].map(id=>({...event(id,[]),golf_rounds:[1,2,3,4].map(round_number=>({round_number,tee_time:'2026-09-14',golf_holes:[h(id===1?3:4)]}))}));
 const result=scoreBestBall({...input(events),roster:split,rosterPeriodType:'split_after_round_2',rounds:[1,2,3,4]});
 assert.deepEqual(result.rounds.map(r=>r.strokes),[3,3,4,4]);
 assert.deepEqual(result.rounds.map(r=>r.period),['opening','opening','weekend','weekend']);
 assert.deepEqual(eligibleGolfPlayerIds(split,'split_after_round_2',3),[2]);
 assert.equal(result.toPar,-2);
});
for (const status of ['cut','withdrawn','disqualified','did_not_start']) {
 test(`${status}: only actual accepted holes contribute; no invented weekend scores or false finality`,()=>{
  const result=scoreBestBall({...input([event(1,status==='did_not_start'?[]:[h(3)],1,status)]),rounds:[1,3]});
  assert.equal(result.holesScored,status==='did_not_start'?0:1);
  assert.equal(result.rounds[1].strokes,null);
  assert.equal(result.rounds[0].holes[1].status,'unscored');
  if(status!=='did_not_start')assert.equal(result.rounds[0].holes[0].status,'provisional');
 });
}
test('accepted corrections can improve or worsen the selected score',()=>{
 assert.equal(first([event(1,[h(4)]),event(2,[h(5)])]).strokes,4);
 assert.equal(first([event(1,[h(3)]),event(2,[h(5)])]).strokes,3);
 assert.equal(first([event(1,[h(6)]),event(2,[h(5)])]).strokes,5);
});
test('rejected stale provider observation has no path into scoring accepted state',()=>{
 const accepted={...h(4),reconciliation:{source:'espn',observedAt:'2026-09-10T12:00:00Z',final:true}};
 const outcome=acceptGolfHole(accepted,{...h(2),reconciliation:{source:'espn',observedAt:'2026-09-10T11:00:00Z',final:true}});
 assert.equal(outcome,false);
 assert.equal(first([event(1,[accepted])]).strokes,4);
});
test('unknown/inconsistent par never manufactures a to-par total',()=>{
 const a=event(1,[{...h(3),relative_to_par:null}]);
 assert.equal(score([a]).strokes,3);assert.equal(score([a]).toPar,null);
 assert.equal(first([event(1,[h(3)]),event(2,[{...h(4),relative_to_par:-1}])]).par,null);
});
test('playoff holes excluded; unsupported rounds fail; shortened round list supported',()=>{
 assert.equal(score([event(1,[h(2,19)])]).holesScored,0);
 assert.throws(()=>scoreBestBall({...input([]),rounds:[5]}),/regulation/);
 assert.equal(scoreBestBall({...input([]),rounds:[1,2,3]}).rounds.length,3);
});
test('roster/accepted input ambiguity fails rather than silently choosing',()=>{
 assert.throws(()=>scoreBestBall({...input([]),roster:{teamId:20,periods:[]}}),/exactly one/);
 assert.throws(()=>scoreBestBall({...input([]),roster:{teamId:20,periods:[{period:'full_tournament',playerIds:[1,1]}]}}),/unique/);
 assert.throws(()=>score([event(1,[]),event(1,[])]),/Duplicate/);
 assert.throws(()=>score([event(1,[h(3),h(4)])]),/Duplicate/);
});
test('acquisition settings do not enter scoring, and input remains unchanged',()=>{
 const base=input([event(1,[h(3)])]);const before=JSON.stringify(base);
 const run=draft=>scoreGolfCompetition({gameType:'best_ball',...base,rosters:[base.roster],draft});
 assert.deepEqual(run({type:'snake'}),run({type:'salary_cap',salaryCap:100}));
 assert.equal(JSON.stringify(base),before);
});
test('Standard adapter exactly delegates aggregate penalties/progress and ranking including draft-order ties',()=>{
 const events=[event(1,[h(3)]),event(2,[h(3)])];
 events.forEach(e=>{e.fantasy_score=19;e.penalty_strokes=20;e.status='cut';e.golf_rounds[0].holes_completed=18;e.golf_rounds[0].score_to_par=-1;});
 const rosters=[1,2].map(id=>({teamId:id,periods:[{period:'full_tournament',playerIds:[id]}]}));
 const slateTeams=[{team_id:1,draft_order:2},{team_id:2,draft_order:1}];
 const competitors=events.map(e=>({playerId:e.player_id,rounds:[{roundNumber:1,holesCompleted:18,scoreToPar:-1,holes:[{relativeToPar:-1}]}]}));
 const expected=calculateGolfTeamResults(7,events,competitors,rosters.map(r=>({team_id:r.teamId,lineup_players:[{player_id:r.teamId}]})),slateTeams);
 const result=scoreGolfCompetition({slateId:7,gameType:'standard',acceptedEvents:events,rosters,rosterPeriodType:'full_tournament',slateTeams});
 assert.deepEqual(result.teams,expected);assert.equal(result.teams[0].team_id,2);assert.equal(result.teams[0].fantasy_points,19);
 assert.throws(()=>scoreGolfCompetition({slateId:7,gameType:'standard',acceptedEvents:events,rosters,rosterPeriodType:'split_after_round_2',slateTeams}),/not implemented/);
});

test('reconciled event graph, not a rejected batch, supplies the reducer',()=>{
 const { reconcileGolfState } = require('../lib/golf/reconcileState.ts');
 const accepted={...h(4),round_id:10,reconciliation:{source:'espn',observedAt:'2026-09-10T12:00:00Z',final:true}};
 const e={...event(1,[accepted]),id:1,official_score_to_par:0,penalty_strokes:0,holes_completed:1,rounds_completed:0,current_round:1,last_hole:1};
 Object.assign(e.golf_rounds[0],{id:10,event_player_id:1,strokes:4,score_to_par:0,holes_completed:1,status:'active'});
 const result=reconcileGolfState({slateId:7,events:[e],lineups:[],slateTeams:[],teams:[],penaltyPerRound:10},
  {observedAt:'2026-09-10T11:00:00Z',holes:[{...accepted,strokes:2,relative_to_par:-2,reconciliation:{...accepted.reconciliation,observedAt:'2026-09-10T11:00:00Z'}}]},2);
 assert.equal(first(result.events).strokes,4);
 assert.equal(result.holeWrites.length,0);
});
test('round complete with missing hole remains unresolved; empty eligible roster is unscored',()=>{
 const events=[event(1,[h(4)])];events.push({...event(2,[],1,'finished'),golf_rounds:[{round_number:1,holes_completed:18,golf_holes:[]}]});
 assert.equal(first(events).status,'provisional');assert.ok(first(events).unresolvedPlayerIds.includes(2));
 const result=scoreBestBall({...input(events),roster:{teamId:20,periods:[{period:'full_tournament',playerIds:[]}]}});
 assert.equal(result.rounds[0].holes[0].status,'unscored');
});
