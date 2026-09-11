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

const {golfPeriodKeys,findGolfPeriod,retainGolfPeriodFacts,evaluateStoredGolfPeriods}=require('../lib/golf/periodPersistence.ts');
const scope={slateId:7,groupId:'group',leagueId:'league'};
const snapshot={sport:'golf',rosterPeriods:{type:'split_after_round_2'}};
const row=()=>({...scope,period:'weekend',revision:0,acceptedRevision:5,startedRounds:[],openedAt:null,lockedAt:null,completedAt:null,lockReason:null});
const evidence=()=>({regulationRoundCount:4,tournamentComplete:false,round2Complete:true,round3NotStarted:true,cut:'confirmed',fieldComplete:true,players:[{playerId:1,eligibility:'made_cut'}],acceptedEvents:[],startedRounds:[],acquisition:{initial:'locked',weekendLocked:false}});
test('frozen/default keys independent of both other axes',()=>{
 assert.deepEqual(golfPeriodKeys(null),['full_tournament']);assert.deepEqual(golfPeriodKeys({}),['full_tournament']);
 for(const gameType of ['standard','best_ball'])for(const type of ['snake','salary_cap'])assert.deepEqual(golfPeriodKeys({...snapshot,gameType,draft:{type}}),['opening','weekend']);
 assert.deepEqual(golfPeriodKeys(JSON.parse(JSON.stringify(snapshot))),['opening','weekend']);
});
test('lookup isolates Group, league, slate and period',()=>{
 const r=row();assert.equal(findGolfPeriod([r],scope,'weekend'),r);
 for(const changed of [{groupId:'other'},{leagueId:'other'},{slateId:8}])assert.equal(findGolfPeriod([r],{...scope,...changed},'weekend'),null);
 assert.equal(findGolfPeriod([r],scope,'opening'),null);assert.throws(()=>findGolfPeriod([r,r],scope,'weekend'),/Duplicate/);
});
test('CAS detects simultaneous writers and stale accepted revision',()=>{
 const r=retainGolfPeriodFacts(row(),{expectedRevision:0,acceptedRevision:5,startedRounds:[3]});
 assert.throws(()=>retainGolfPeriodFacts(r,{expectedRevision:0,acceptedRevision:5}),/conflict/);
 assert.throws(()=>retainGolfPeriodFacts(r,{expectedRevision:1,acceptedRevision:4}),/conflict/);
});
test('omissions and retractions cannot erase retained start or reopen',()=>{
 const first=retainGolfPeriodFacts(row(),{expectedRevision:0,acceptedRevision:6,startedRounds:[3]});
 const next=retainGolfPeriodFacts(first,{expectedRevision:1,acceptedRevision:7,startedRounds:[]});
 assert.deepEqual(next.startedRounds,[3]);assert.equal(evaluateStoredGolfPeriods(scope,snapshot,[next],evidence()).periods[1].locked,true);
});
test('lock/open/completed timestamps and original lock reason never change',()=>{
 const first=retainGolfPeriodFacts(row(),{expectedRevision:0,acceptedRevision:6,lockedAt:'2026-09-12T12:00:00Z',lockReason:'round_3_started',openedAt:'2026-09-12T10:00:00Z'});
 const next=retainGolfPeriodFacts(first,{expectedRevision:1,acceptedRevision:7,lockedAt:'2026-09-13T12:00:00Z',lockReason:'other'});
 assert.equal(next.lockedAt,first.lockedAt);assert.equal(next.lockReason,first.lockReason);assert.equal(next.openedAt,first.openedAt);
 assert.equal(evaluateStoredGolfPeriods(scope,snapshot,[next],evidence()).periods[1].canBuildRoster,false);
 const done={...next,completedAt:'2026-09-14T12:00:00Z'};
 assert.equal(evaluateStoredGolfPeriods(scope,snapshot,[done],evidence()).periods[1].state,'completed');
});
test('shortening clips rounds without deleting identity; historical fallback is not persisted',()=>{
 for(const count of [2,3]){
  const r=evaluateStoredGolfPeriods(scope,snapshot,[row()],{...evidence(),regulationRoundCount:count});
  assert.deepEqual(r.periods[1].regulationRounds,count===2?[]:[3]);assert.equal(r.persisted,false);
 }
 const legacy=evaluateStoredGolfPeriods(scope,null,[],evidence());assert.equal(legacy.periods[0].period,'full_tournament');assert.equal(legacy.persisted,false);
});
test('fact planning is immutable and deterministic',()=>{
 const r=row(),before=JSON.stringify(r);const patch={expectedRevision:0,acceptedRevision:5,startedRounds:[4,3,3]};
 assert.deepEqual(retainGolfPeriodFacts(r,patch),retainGolfPeriodFacts(r,patch));assert.equal(JSON.stringify(r),before);
 assert.deepEqual(retainGolfPeriodFacts(r,patch).startedRounds,[3,4]);
});
test('migration grants no runtime writes and retains audit/identity guards',()=>{
 const sql=require('node:fs').readFileSync(path.join(repositoryRoot,'supabase/migrations/20260914000100_golf_roster_period_foundation.sql'),'utf8');
 assert.match(sql,/unique \(slate_id, period_key\)/);assert.match(sql,/old.started_rounds <@ new.started_rounds/);
 assert.match(sql,/enable row level security/);assert.doesNotMatch(sql,/grant (all|insert|update|delete) /i);
 assert.match(sql,/after insert or update/);assert.match(sql,/on delete restrict/);
});

test('retained completion overrides stale current-period and reason metadata',()=>{
 const completedAt='2026-09-14T12:00:00Z';
 const full={...row(),period:'full_tournament',completedAt};
 const result=evaluateStoredGolfPeriods(scope,null,[full],{...evidence(),acquisition:{initial:'open',weekendLocked:false}});
 assert.equal(result.currentPeriod,null);
 assert.equal(result.periods[0].state,'completed');
 assert.equal(result.periods[0].reason,'retained_completion');
 assert.equal(result.periods[0].canBuildRoster,false);
 const split=evaluateStoredGolfPeriods(scope,snapshot,[{...row(),period:'opening',completedAt},{...row(),completedAt}],{...evidence(),startedRounds:[3]});
 assert.equal(split.currentPeriod,null);
 assert.ok(split.periods.every(p=>p.state==='completed' && p.locked));
});
