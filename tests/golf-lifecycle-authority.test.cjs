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

const {acceptedStartedRounds,missingGolfPeriodKeys,assertGolfLifecycleAcquisition}=require('../lib/golf/lifecycleAuthority.ts');
const {retainGolfPeriodFacts}=require('../lib/golf/periodPersistence.ts');
const scope={slateId:7,groupId:'g',leagueId:'l'};
const snapshot={sport:'golf',rosterPeriods:{type:'split_after_round_2'}};
const row=period=>({...scope,period,revision:2,acceptedRevision:4,startedRounds:[],openedAt:null,lockedAt:null,completedAt:null,lockReason:null});
const fixture=()=>({scope,snapshot,rows:[row('opening'),row('weekend')],period:'weekend',expectedPeriodRevision:2,expectedAcceptedRevision:4,currentAcceptedRevision:4,actorAuthorized:true,teamParticipating:true,
 evidence:{regulationRoundCount:4,tournamentComplete:false,round2Complete:true,round3NotStarted:true,cut:'confirmed',fieldComplete:true,players:[{playerId:1,eligibility:'made_cut'}],acceptedEvents:[],startedRounds:[],acquisition:{initial:'locked',weekendLocked:false}},
 tournamentPlayerIds:[1],selectedPlayerIds:[1],now:'2026-09-12T12:00:00Z',lease:{sourceReference:'review:1',observedAt:'2026-09-12T11:59:00Z',acquisitionDeadline:'2026-09-12T12:05:00Z',acceptedRevision:4,periodRevision:2}});
test('initialization plan is idempotent and snapshot scoped',()=>{
 assert.deepEqual(missingGolfPeriodKeys(scope,null,[]),['full_tournament']);
 assert.deepEqual(missingGolfPeriodKeys(scope,snapshot,[]),['opening','weekend']);
 assert.deepEqual(missingGolfPeriodKeys(scope,snapshot,[row('opening'),row('weekend')]),[]);
 assert.deepEqual(missingGolfPeriodKeys({...scope,slateId:8},snapshot,[row('opening')]),['opening','weekend']);
});
test('accepted round/hole starts only; absence and tee times prove nothing',()=>{
 assert.deepEqual(acceptedStartedRounds([{player_id:1,current_round:3,golf_rounds:[{round_number:3,tee_time:'today'}]}]),[]);
 assert.deepEqual(acceptedStartedRounds([{player_id:1,golf_rounds:[{round_number:3,golf_holes:[{hole_number:10,strokes:4}]},{round_number:4,holes_completed:1},{round_number:5,holes_completed:1}]}]),[3,4]);
});
test('fresh authorized reviewed window passes gate',()=>assert.doesNotThrow(()=>assertGolfLifecycleAcquisition(fixture())));
for(const key of ['actorAuthorized','teamParticipating'])test(`${key} enforced`,()=>assert.throws(()=>assertGolfLifecycleAcquisition({...fixture(),[key]:false}),/Unauthorized/));
test('stale period or accepted versions rejected',()=>{
 for(const patch of [{expectedPeriodRevision:1},{expectedAcceptedRevision:3},{currentAcceptedRevision:5}])assert.throws(()=>assertGolfLifecycleAcquisition({...fixture(),...patch}),/revision/);
});
test('retained lock defeats a stale open view even with matching newer revisions',()=>{
 const f=fixture();f.rows[1]=retainGolfPeriodFacts(f.rows[1],{expectedRevision:2,acceptedRevision:4,lockedAt:f.now,lockReason:'round_3_started',startedRounds:[3]});
 assert.throws(()=>assertGolfLifecycleAcquisition(f),/revision/);
 f.expectedPeriodRevision=3;assert.throws(()=>assertGolfLifecycleAcquisition(f),/unavailable/);
});
test('missing or expired confirmation cannot authorize',()=>{
 for(const lease of [null,{...fixture().lease,acquisitionDeadline:fixture().now},{...fixture().lease,observedAt:'2026-09-13'}])assert.throws(()=>assertGolfLifecycleAcquisition({...fixture(),lease}),/confirmation/);
});
test('unresolved, delayed R2 and tournament final deny acquisition',()=>{
 for(const patch of [{round2Complete:false},{round3NotStarted:null},{tournamentComplete:true},{players:[{playerId:1,eligibility:'unknown'}]}]){const f=fixture();Object.assign(f.evidence,patch);assert.throws(()=>assertGolfLifecycleAcquisition(f),/unavailable/);}
});
test('72/54 permit confirmed weekend; 36 denies it',()=>{
 for(const regulationRoundCount of [4,3,2]){const f=fixture();f.evidence.regulationRoundCount=regulationRoundCount;if(regulationRoundCount===2)assert.throws(()=>assertGolfLifecycleAcquisition(f),/unavailable/);else assert.doesNotThrow(()=>assertGolfLifecycleAcquisition(f));}
});
test('no draft/scoring axis dependency and full tournament has no weekend lease',()=>{
 for(const gameType of ['standard','best_ball'])for(const type of ['snake','salary_cap'])assert.doesNotThrow(()=>assertGolfLifecycleAcquisition({...fixture(),snapshot:{...snapshot,gameType,draft:{type}}}));
 const f=fixture();Object.assign(f,{snapshot:null,rows:[row('full_tournament')],period:'full_tournament',lease:null});f.evidence.acquisition.initial='open';assert.doesNotThrow(()=>assertGolfLifecycleAcquisition(f));
});
test('field, duplicate selection, initialization and Group checks',()=>{
 for(const patch of [{selectedPlayerIds:[2]},{selectedPlayerIds:[1,1]},{rows:[]},{scope:{...scope,groupId:'other'}}])assert.throws(()=>assertGolfLifecycleAcquisition({...fixture(),...patch}));
});
test('SQL transaction design keeps legacy RPC and rolls fact failure back',()=>{
 const sql=require('node:fs').readFileSync(path.join(repositoryRoot,'supabase/migrations/20260915000100_golf_lifecycle_writer.sql'),'utf8');
 assert.match(sql,/on conflict\(slate_id,period_key\) do nothing/);
 assert.ok(sql.indexOf('from slates where id=p_slate for update')<sql.indexOf('from golf_accepted_versions where slate_id=p_slate for update'));
 assert.match(sql,/result:=commit_golf_reconciliation\(/);assert.match(sql,/facts:=write_golf_lifecycle_facts\(/);
 assert.doesNotMatch(sql,/create or replace function public.commit_golf_reconciliation\(/);
 assert.doesNotMatch(sql,/exception when/i);assert.match(sql,/raise exception 'Golf period revision conflict'/);
 assert.match(sql,/Group commissioner required/);assert.match(sql,/from public,anon,authenticated,service_role/);
});

test('SQL confirmation checks a finite deadline after locking; result aliases are unambiguous',()=>{
 const sql=require('node:fs').readFileSync(path.join(repositoryRoot,'supabase/migrations/20260915000100_golf_lifecycle_writer.sql'),'utf8');
 const confirm=sql.slice(sql.indexOf('create function public.confirm_golf_period_history'));
 assert.ok(confirm.indexOf('t:=clock_timestamp();')>confirm.indexOf('v:=lock_golf_lifecycle('));
 assert.ok(confirm.indexOf('t:=clock_timestamp();')<confirm.indexOf("::timestamptz<=t"));
 assert.match(confirm,/not isfinite\(\(p_evidence->>'acquisitionDeadline'\)::timestamptz\)/);
 assert.match(confirm,/not isfinite\(\(p_evidence->>'observedAt'\)::timestamptz\)/);
 assert.doesNotMatch(sql,/jsonb_agg\(to_jsonb\(p\)/);
});
