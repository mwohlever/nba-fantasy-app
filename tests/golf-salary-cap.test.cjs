/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');const test=require('node:test');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {validateGolfSalaryCapLineup,canAddGolfSalaryCapPlayer}=require('../lib/golf/salaryCap.ts');
const prices=[{playerId:1,effectiveSalary:42,eligible:true},{playerId:2,effectiveSalary:28,eligible:true},{playerId:3,effectiveSalary:15,eligible:true},{playerId:4,effectiveSalary:15,eligible:true},{playerId:5,effectiveSalary:10,eligible:true,isAmateur:true},{playerId:6,effectiveSalary:22,eligible:false},{playerId:7,effectiveSalary:null,eligible:true}];
const valid=ids=>validateGolfSalaryCapLineup({playerIds:ids,prices,rosterSize:4,salaryCap:100});
test('Salary Cap requires four unique, eligible, frozen-price golfers',()=>{
 assert.deepEqual(valid([1,2,3,4]),{ok:true,totalSalary:'100.00'});assert.deepEqual(valid([1,2,3]),{ok:false,error:'Select exactly 4 golfers.'});
 assert.match(valid([1,1,3,4]).error,/only once/);assert.match(valid([1,2,3,6]).error,/not eligible/);assert.match(valid([1,2,3,7]).error,/frozen salary/);
});
test('cap, amateur price and server-owned frozen price semantics',()=>{
 assert.match(validateGolfSalaryCapLineup({playerIds:[1,2,3,5],prices,rosterSize:4,salaryCap:90}).error,/exceeds/);assert.deepEqual(valid([1,2,4,5]),{ok:true,totalSalary:'95.00'});
 assert.deepEqual(valid([1,2,3,4]),{ok:true,totalSalary:'100.00'});
 assert.deepEqual(valid([2,3,4,5]),{ok:true,totalSalary:'68.00'});
 assert.deepEqual(validateGolfSalaryCapLineup({playerIds:[1,2,3,4],prices:[...prices.map(p=>p.playerId===4?{...p,effectiveSalary:16}:p)],rosterSize:4,salaryCap:100}),{ok:false,error:'Lineup exceeds the $100.00 salary cap.'});
 // A browser-provided number is deliberately outside the acquisition input.
 assert.deepEqual(validateGolfSalaryCapLineup({playerIds:[1,2,3,4],prices,rosterSize:4,salaryCap:100,clientSalaries:{1:1}}),{ok:true,totalSalary:'100.00'});
});
test('cents are exact for client validation and remaining-cap arithmetic',()=>{
 const decimal=[{playerId:1,effectiveSalary:'31.34',eligible:true},{playerId:2,effectiveSalary:'25.00',eligible:true},{playerId:3,effectiveSalary:'25.00',eligible:true},{playerId:4,effectiveSalary:'18.66',eligible:true},{playerId:5,effectiveSalary:'18.67',eligible:true}];
 assert.deepEqual(validateGolfSalaryCapLineup({playerIds:[1,2,3,4],prices:decimal,rosterSize:4,salaryCap:'100.00'}),{ok:true,totalSalary:'100.00'});
 assert.match(validateGolfSalaryCapLineup({playerIds:[1,2,3,5],prices:decimal,rosterSize:4,salaryCap:'100.00'}).error,/\$100\.00/);
 assert.throws(()=>validateGolfSalaryCapLineup({playerIds:[1,2,3,4],prices:[...decimal.slice(0,3),{playerId:4,effectiveSalary:'18.666',eligible:true}],rosterSize:4,salaryCap:'100.00'}),/Invalid frozen/);
});
test('money serialization fixes whole dollars and rejects more than two decimals',()=>{
 const { golfMoneyToCents, formatGolfMoney, golfCentsToMoney }=require('../lib/golf/money.ts');
 assert.equal(formatGolfMoney(25),'25.00');assert.equal(formatGolfMoney('31.34'),'31.34');assert.equal(golfCentsToMoney(6866),'68.66');
 assert.equal(golfMoneyToCents('100.00'),10000);assert.equal(golfMoneyToCents('100.001'),null);
});
test('Salary Cap APIs serialize monetary fields as fixed-decimal strings',()=>{
 const playerRoute=fs.readFileSync(path.join(__dirname,'../app/api/golf/salary-cap/route.ts'),'utf8');
 const adminRoute=fs.readFileSync(path.join(__dirname,'../app/api/admin/golf/salary-cap/route.ts'),'utf8');
 assert.match(playerRoute,/budget: formatGolfMoney\(authorized\.rules\.budget\)/);assert.match(playerRoute,/totalSalary: formatGolfMoney\(lineup\.total_salary\)/);
 assert.match(adminRoute,/suggested_salary:.*formatGolfMoney/s);assert.match(adminRoute,/override_salary:.*formatGolfMoney/s);
});
test('cents migration preserves historical dollars and replaces every money RPC',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260921000100_golf_salary_cap_cents.sql'),'utf8');
 assert.match(sql,/using suggested_salary::numeric\(7,2\)/);assert.match(sql,/using total_salary::numeric\(7,2\)/);
 assert.match(sql,/salary must have no more than two decimal places/i);assert.match(sql,/total numeric\(7,2\)/);
 assert.match(sql,/sum\(p\.effective_salary\).*total/s);
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

test('salary generation partitions PGA-only field identities instead of rejecting the board',()=>{
 const route=fs.readFileSync(path.join(__dirname,'../app/api/admin/golf/salary-cap/route.ts'),'utf8');
 assert.match(route,/identityStatus:.*espn_resolved.*pga_unresolved/s);
 assert.match(route,/const resolvedField = fieldInputs\.filter/);
 assert.match(route,/playerIds: resolvedField\.map/);
 assert.match(route,/const suggestedSalary = value\?\.pricing\.suggestedSalary \?\? null/);
 assert.match(route,/const fallback = !player\.isAmateur && suggestedSalary === null/);
 assert.match(route,/value_basis: fallback \? 'fallback' : value\?\.pricing\.basis \?\? 'unsupported'/);
 assert.match(route,/suggested_salary: fallback \? 15/);
 assert.doesNotMatch(route,/Resolve PGA field golfers to canonical ESPN IDs before generating salaries/);
});

test('unresolved authoritative professionals receive fallback without entering model populations',()=>{
 const route=fs.readFileSync(path.join(__dirname,'../app/api/admin/golf/salary-cap/route.ts'),'utf8');
 assert.match(route,/const resolvedField = fieldInputs\.filter\(player => player\.identityStatus === 'espn_resolved'\)/);
 assert.match(route,/manifest\.field\.filter\(player => player\.identityStatus === 'espn_resolved'/);
 assert.match(route,/const suggestedSalary = value\?\.pricing\.suggestedSalary \?\? null/);
 assert.match(route,/const fallback = !player\.isAmateur && suggestedSalary === null/);
 assert.match(route,/suggested_salary: fallback \? 15 : suggestedSalary/);
});

test('fallback migration preserves model bases while making only unpriceable professionals reviewable',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260923000100_golf_salary_fallback.sql'),'utf8');
 assert.match(sql,/value_basis in \('blended','v1_only','owgr_only','unsupported','amateur','fallback'\)/);
 assert.match(sql,/x\.value_basis='fallback'.*x\.suggested_salary<>15/s);
 assert.match(sql,/case when x\.value_basis='fallback' then x\.suggested_salary/s);
 assert.match(sql,/value_basis='fallback'\) and not coalesce\(p_acknowledge_unpriced,false\)/);
 assert.match(sql,/value_basis='fallback' then coalesce\(salary,suggested_salary\)/);
 assert.match(sql,/coalesce\(x\.is_amateur,false\).*value_basis<>'amateur'/s);
});

test('lifecycle SQL locks opening and weekend independently',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260915000100_golf_lifecycle_writer.sql'),'utf8');
 assert.match(sql,/p\.period_key in \('opening','full_tournament'\) and cardinality\(starts\)>0/);
 assert.match(sql,/p\.period_key='weekend' and starts && array\[3,4\]/);
 assert.match(sql,/p\.period_key<>'weekend' and \(select is_locked from slates/);
 assert.doesNotMatch(sql,/should_lock:=p_lock_reason is not null or \(select is_locked from slates/);
 assert.match(sql,/evidence_snapshot=p\.evidence_snapshot\|\|jsonb_build_object/);
});
