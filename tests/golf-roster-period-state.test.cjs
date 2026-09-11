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

const { evaluateGolfRosterPeriodState: evaluate } = require('../lib/golf/rosterPeriodState.ts');
const base = () => ({regulationRoundCount:4,tournamentComplete:false,round2Complete:false,round3NotStarted:true,cut:'pending',fieldComplete:true,
 players:[{playerId:1,eligibility:'made_cut'}],acceptedEvents:[],startedRounds:[],acquisition:{initial:'open',weekendLocked:false}});
const run = (patch={},type='split_after_round_2') => evaluate({rosterPeriodType:type,evidence:{...base(),...patch}});
const ready = {round2Complete:true,cut:'confirmed'};
const weekend = patch => run(patch).periods[1];
test('full tournament normalizes one period and preserves acquisition semantics',()=>{
 const r=run({},'full_tournament');assert.equal(r.periods.length,1);assert.deepEqual(r.periods[0].regulationRounds,[1,2,3,4]);assert.equal(r.periods[0].state,'open');
 assert.equal(run({cut:'unknown',round2Complete:null},'full_tournament').periods[0].state,'open');
});
test('split maps rounds; pre-tournament opening open and weekend unavailable',()=>{
 const r=run();assert.deepEqual(r.periods.map(p=>p.regulationRounds),[[1,2],[3,4]]);assert.equal(r.periods[0].canBuildRoster,true);assert.equal(r.periods[1].canBuildRoster,false);
});
for(const r of [1,2])test(`R${r} play locks opening but does not open weekend`,()=>{
 const result=run({startedRounds:[r]});assert.equal(result.periods[0].locked,true);assert.equal(result.periods[1].state,'unavailable');
});
test('Saturday/suspension/calendar rollover has no effect',()=>{
 assert.deepEqual(run({startedRounds:[2],now:'2026-09-12',status:'suspended'}),run({startedRounds:[2],now:'2026-09-11'}));
});
test('cut pending after R2 stays uncertain',()=>assert.equal(weekend({round2Complete:true}).reason,'awaiting_cut_confirmation'));
test('confirmed R2/cut/complete field opens weekend',()=>{
 const r=run(ready);assert.equal(r.periods[1].state,'open');assert.equal(r.currentPeriod,'weekend');assert.equal(r.periods[0].state,'completed');
});
test('confirmed no-cut continuing field opens without cut line',()=>assert.equal(weekend({...ready,cut:'no_cut',players:[{playerId:1,eligibility:'continuing'}]}).state,'open'));
test('no-cut alone cannot classify unknown golfer eligible',()=>assert.equal(weekend({...ready,cut:'no_cut',players:[{playerId:1,eligibility:'unknown'}]}).state,'uncertain'));
test('explicit R3 start locks even before cut confirmation',()=>assert.equal(weekend({startedRounds:[3]}).reason,'round_3_started'));
test('accepted R3 hole overrides stale high-level state',()=>{
 assert.equal(weekend({acceptedEvents:[{player_id:1,golf_rounds:[{round_number:3,golf_holes:[{hole_number:10,strokes:4,relative_to_par:0}]}]}]}).locked,true);
});
test('accepted R3 aggregate and R4 activity also lock',()=>{
 for(const round_number of [3,4])assert.equal(weekend({acceptedEvents:[{player_id:1,golf_rounds:[{round_number,holes_completed:1}]}]}).locked,true);
});
test('late cut data cannot reopen with retained start watermark',()=>{
 for(const patch of [{},ready,{round2Complete:null,cut:'unknown'}])assert.equal(weekend({...patch,startedRounds:[3]}).state,'locked');
});
test('explicit acquisition deadline lock wins over readiness',()=>assert.equal(weekend({...ready,acquisition:{initial:'locked',weekendLocked:true}}).state,'locked'));
for(const count of [1,2,3,4])test(`${count*18}-hole confirmed event maps only existing rounds`,()=>{
 const w=weekend({...ready,regulationRoundCount:count});assert.deepEqual(w.regulationRounds,[3,4].filter(r=>r<=count));assert.equal(w.state,count<=2?'unavailable':'open');
});
test('shortening changes round availability, never invents R4',()=>{
 assert.deepEqual(weekend({...ready,regulationRoundCount:3}).regulationRounds,[3]);
 assert.deepEqual(weekend({...ready,regulationRoundCount:null}).regulationRounds,[]);
 assert.equal(weekend({...ready,regulationRoundCount:null}).state,'uncertain');
});
test('final closes periods; nonexistent weekend stays unavailable',()=>{
 assert.ok(run({tournamentComplete:true}).periods.every(p=>p.state==='completed'&&p.locked));
 assert.equal(weekend({tournamentComplete:true,regulationRoundCount:2}).state,'unavailable');
});
for(const eligibility of ['made_cut','continuing','missed_cut','withdrawn','disqualified','did_not_start','unknown'])test(`eligibility ${eligibility} is explicit`,()=>{
 const w=weekend({...ready,players:[{playerId:1,eligibility}]});
 const key=['made_cut','continuing'].includes(eligibility)?'eligiblePlayerIds':eligibility==='unknown'?'unresolvedPlayerIds':'ineligiblePlayerIds';
 assert.deepEqual(w[key],[1]);if(eligibility==='unknown')assert.equal(w.canBuildRoster,false);
});
test('accepted terminal status overrides stale made-cut classification',()=>{
 for(const status of ['cut','withdrawn','disqualified','did_not_start'])assert.deepEqual(weekend({...ready,acceptedEvents:[{player_id:1,status}]}).ineligiblePlayerIds,[1]);
});
test('incomplete/empty field, unknown cut/completion never opens',()=>{
 for(const patch of [{fieldComplete:false},{players:[]},{cut:'unknown'},{round2Complete:null},{tournamentComplete:null},{round3NotStarted:null}])assert.equal(weekend({...ready,...patch}).state,'uncertain');
});
test('game/acquisition axes irrelevant; no input mutation',()=>{
 const e={...base(),...ready};const before=JSON.stringify(e);
 for(const gameType of ['standard','best_ball'])for(const draft of [{type:'snake'},{type:'salary_cap'}])assert.deepEqual(evaluate({rosterPeriodType:'split_after_round_2',evidence:e,gameType,draft}),run(ready));
 assert.equal(JSON.stringify(e),before);
});
test('tee time and current-round hint alone do not establish play',()=>assert.equal(weekend({...ready,acceptedEvents:[{player_id:1,current_round:3,tee_time:'2026-09-12T12:00:00Z',golf_rounds:[{round_number:3,holes_completed:0}]}]}).state,'open'));
test('invalid fields fail explicitly',()=>{
 assert.throws(()=>run({players:[{playerId:1,eligibility:'unknown'},{playerId:1,eligibility:'made_cut'}]}),/duplicate/);
 assert.throws(()=>run({regulationRoundCount:5}),/Invalid/);
});

test('confirmed R3 start before any hole closes acquisition',()=>assert.equal(weekend({...ready,round3NotStarted:false}).locked,true));
