/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');const test=require('node:test');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {validateGolfSalaryCapLineup,canAddGolfSalaryCapPlayer}=require('../lib/golf/salaryCap.ts');
const prices=[{playerId:1,effectiveSalary:42,eligible:true},{playerId:2,effectiveSalary:28,eligible:true},{playerId:3,effectiveSalary:15,eligible:true},{playerId:4,effectiveSalary:15,eligible:true},{playerId:5,effectiveSalary:10,eligible:true,isAmateur:true},{playerId:6,effectiveSalary:22,eligible:false},{playerId:7,effectiveSalary:null,eligible:true}];
const valid=ids=>validateGolfSalaryCapLineup({playerIds:ids,prices,rosterSize:4,salaryCap:100});
test('Salary Cap requires four unique, eligible, frozen-price golfers',()=>{
 assert.deepEqual(valid([1,2,3,4]),{ok:true,totalSalary:100});assert.deepEqual(valid([1,2,3]),{ok:false,error:'Select exactly 4 golfers.'});
 assert.match(valid([1,1,3,4]).error,/only once/);assert.match(valid([1,2,3,6]).error,/not eligible/);assert.match(valid([1,2,3,7]).error,/frozen salary/);
});
test('cap, amateur price and server-owned frozen price semantics',()=>{
 assert.match(validateGolfSalaryCapLineup({playerIds:[1,2,3,5],prices,rosterSize:4,salaryCap:90}).error,/exceeds/);assert.deepEqual(valid([1,2,4,5]),{ok:true,totalSalary:95});
 assert.deepEqual(valid([1,2,3,4]),{ok:true,totalSalary:100});
 assert.deepEqual(valid([2,3,4,5]),{ok:true,totalSalary:68});
 assert.deepEqual(validateGolfSalaryCapLineup({playerIds:[1,2,3,4],prices:[...prices.map(p=>p.playerId===4?{...p,effectiveSalary:16}:p)],rosterSize:4,salaryCap:100}),{ok:false,error:'Lineup exceeds the $100 salary cap.'});
 // A browser-provided number is deliberately outside the acquisition input.
 assert.deepEqual(validateGolfSalaryCapLineup({playerIds:[1,2,3,4],prices,rosterSize:4,salaryCap:100,clientSalaries:{1:1}}),{ok:true,totalSalary:100});
});
test('selection rejects additions that make completion mathematically impossible',()=>{
 const constrained=[{playerId:1,effectiveSalary:42,eligible:true},{playerId:2,effectiveSalary:30,eligible:true},{playerId:3,effectiveSalary:15,eligible:true},{playerId:4,effectiveSalary:15,eligible:true},{playerId:5,effectiveSalary:10,eligible:true}];
 assert.equal(canAddGolfSalaryCapPlayer({selectedPlayerIds:[1],candidatePlayerId:2,prices:constrained,rosterSize:4,salaryCap:95}),false);
 assert.equal(canAddGolfSalaryCapPlayer({selectedPlayerIds:[1],candidatePlayerId:3,prices:constrained,rosterSize:4,salaryCap:100}),true);
 assert.equal(canAddGolfSalaryCapPlayer({selectedPlayerIds:[1,3],candidatePlayerId:5,prices:constrained,rosterSize:4,salaryCap:100}),true);
});
test('acquisition is independent of game type and roster period source',()=>{
 const input={playerIds:[1,2,3,4],prices,rosterSize:4,salaryCap:100};
 assert.deepEqual(validateGolfSalaryCapLineup({...input,gameType:'standard',period:'opening'}),validateGolfSalaryCapLineup({...input,gameType:'best_ball',period:'weekend'}));
});

test('migration persists independent periods against one frozen board and computes salary in SQL',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260916000100_golf_salary_cap_acquisition.sql'),'utf8');
 assert.match(sql,/slate_id bigint not null unique references public\.slates/);
 assert.match(sql,/unique\(slate_id,period_id,team_id\)/);
 assert.match(sql,/price_set_id=ps\.id and p\.player_id=any\(p_player_ids\)/);
 assert.doesNotMatch(sql,/p_(effective_)?salar/i);
 assert.match(sql,/p_period<>'weekend' and s\.is_locked/);
 assert.match(sql,/p_period='weekend'.*evidence_snapshot->'players'/s);
 assert.match(sql,/grant execute on function public\.create_golf_salary_price_set.*to service_role/s);
 assert.doesNotMatch(sql,/grant execute.*to (anon|authenticated)/i);
 assert.match(sql,/Frozen Golf salaries are immutable/);
});

test('server contract never accepts client salaries and routes Salary Cap separately from Snake',()=>{
 const route=fs.readFileSync(path.join(__dirname,'../app/api/golf/salary-cap/route.ts'),'utf8');
 const page=fs.readFileSync(path.join(__dirname,'../app/lineups/draft/page.tsx'),'utf8');
 assert.match(route,/p_player_ids: playerIds/);
 assert.doesNotMatch(route,/body\.(effectiveSalary|salary|prices)/);
 assert.match(route,/getActiveSlateAccessForUser/);
 assert.match(route,/golf_salary_cap_lineups/);
 assert.match(page,/initialUsesSalaryCap/);
 assert.match(page,/<LineupBuilder/);
});

test('lifecycle SQL locks opening and weekend independently',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260915000100_golf_lifecycle_writer.sql'),'utf8');
 assert.match(sql,/p\.period_key in \('opening','full_tournament'\) and cardinality\(starts\)>0/);
 assert.match(sql,/p\.period_key='weekend' and starts && array\[3,4\]/);
 assert.match(sql,/p\.period_key<>'weekend' and \(select is_locked from slates/);
 assert.doesNotMatch(sql,/should_lock:=p_lock_reason is not null or \(select is_locked from slates/);
 assert.match(sql,/evidence_snapshot=p\.evidence_snapshot\|\|jsonb_build_object/);
});
