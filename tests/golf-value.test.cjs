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

const {buildGolfValues,golfValuePercentiles,golfValueSalary,golfValueConfidence,blendGolfValue}=require('../lib/golf/valueModel.ts');
const {golfValueInputsFromEspn}=require('../lib/golf/valueEspn.ts');
const history=(i,score=80,diff=1,status='finished')=>({eventId:String(i),endedAt:`2026-07-${String(i+1).padStart(2,'0')}T12:00:00Z`,status,finishPercentile:status==='finished'?score:null,roundDifferentials:Array(4).fill(diff)});
const player=(id,score=80,diff=1)=>({playerId:id,name:id,history:Array.from({length:8},(_,i)=>history(i,score,diff))});
const input=players=>({eventId:'target',startsAt:'2026-08-01T12:00:00Z',season:2026,players});
test('one explainable no-market weighted model, strong golfers lead',()=>{
 const r=buildGolfValues(input([player('elite',90,2),player('mid',50,0),player('weak',20,-2)]));
 assert.equal(r.players[0].playerId,'elite');assert.equal(r.players[2].playerId,'weak');
 const c=r.players[0].components;assert.ok(Math.abs(r.players[0].value-(.35*c.season+.30*c.recent+.35*c.quality))<.02);
 assert.equal(r.players[0].confidence,'high');
});
test('recent improvement matters more than old improvement',()=>{
 const a=player('recent',50,0),b=player('old',50,0);a.history[7]=history(7,100,2);b.history[0]=history(0,100,2);
 const r=buildGolfValues(input([a,b]));assert.equal(r.players[0].playerId,'recent');
});
test('cut hurts result components without inventing scoring rounds',()=>{
 const a=player('made'),b=player('cut');b.history[7]=history(7,0,0,'cut');b.history[7].roundDifferentials=[-1,-1];
 const r=buildGolfValues(input([a,b]));assert.equal(r.players[0].playerId,'made');assert.equal(r.players[1].rounds,30);
});
for(const status of ['withdrawn','disqualified','unknown'])test(`${status} uses only actual rounds at partial result weight`,()=>{
 const p={playerId:'p',name:'p',history:[{...history(0,0,1,status),roundDifferentials:[1]}]};
 const r=buildGolfValues(input([p])).players[0];assert.equal(r.rounds,1);assert.ok(r.components.quality>50);assert.ok(r.value>50);assert.equal(r.confidence,'low');
});
test('DNS ignored; missing history is unsupported, not a neutral price',()=>{
 const p={playerId:'new',name:'New',history:[history(0,0,-10,'did_not_start')]};
 const r=buildGolfValues(input([player('elite'),p])).players.find(p=>p.playerId==='new');
 assert.equal(r.value,50);assert.equal(r.rounds,0);assert.equal(r.pricing.suggestedSalary,null);assert.equal(r.pricing.status,'unpriced');assert.equal(r.confidence,'no_history');assert.equal(r.limitedHistory,true);
});
test('target, future and previous season cannot leak into model',()=>{
 const p=player('p');const before=buildGolfValues(input([p]));
 p.history.push({...history(10,100,10),eventId:'target'},{...history(11,100,10),endedAt:'2026-09-01'},{...history(12,100,10),endedAt:'2025-07-01'});
 assert.deepEqual(buildGolfValues(input([p])),before);
});
test('field relativity and ties are deterministic, without price cliffs for equal ability',()=>{
 assert.deepEqual(golfValuePercentiles([10,20,20,30]),[0,50,50,100]);assert.deepEqual(golfValuePercentiles([50]),[50]);
 const a=player('a',60,1),b=player('b',60,1);const r=buildGolfValues(input([b,a]));
 assert.equal(r.players[0].rank,1);assert.equal(r.players[1].rank,1);assert.equal(r.players[0].pricing.suggestedSalary,r.players[1].pricing.suggestedSalary);
 assert.deepEqual(r,buildGolfValues(input([a,b])));
 const weak=buildGolfValues(input([a,player('weak',10,-2)])).players.find(p=>p.playerId==='a');
 const strong=buildGolfValues(input([a,player('strong',95,3)])).players.find(p=>p.playerId==='a');assert.ok(weak.percentile>strong.percentile);
});
test('salary curve bounds, monotonicity and top-end separation',()=>{
 assert.equal(golfValueSalary(0),15);assert.equal(golfValueSalary(100),42);
 assert.deepEqual([100,99,97,95,90,85,80,75,70,60,50].map(golfValueSalary),[42,40,39,39,37,35,32,30,28,25,22]);
 let prior=0;for(let p=0;p<=100;p+=.1){const salary=golfValueSalary(p);assert.ok(salary>=prior&&salary<=42);prior=salary;}
 assert.throws(()=>golfValueSalary(NaN));assert.throws(()=>golfValueSalary(101));
});
test('confidence uses both coverage thresholds; sparse is not bad',()=>{
 for(const [a,r,c] of [[8,20,'high'],[8,19,'medium'],[7,28,'medium'],[5,12,'medium'],[5,11,'low'],[4,16,'low'],[3,6,'low'],[1,4,'low'],[0,0,'no_history']])assert.equal(golfValueConfidence(a,r),c);
});
test('exact confidence blends and explicit fallbacks',()=>{
 assert.equal(blendGolfValue(20,80,'high').finalValue,38);
 assert.equal(blendGolfValue(20,80,'medium').finalValue,50);
 assert.equal(blendGolfValue(20,80,'low').finalValue,62);
 assert.deepEqual(blendGolfValue(null,80,'no_history'),{finalValue:80,basis:'owgr_only'});
 assert.deepEqual(blendGolfValue(20,null,'low'),{finalValue:20,basis:'v1_only'});
 assert.deepEqual(blendGolfValue(null,null,'no_history'),{finalValue:null,basis:'unsupported'});
});
test('stored OWGR field baseline, missing information, and amateur price exception',()=>{
 const a={...player('a'),owgrRank:1,owgrUpdatedAt:'2026-07-30'};
 const b={playerId:'b',name:'b',history:[],owgrRank:2};
 const c={playerId:'c',name:'c',history:[]};
 const base=buildGolfValues(input([a,b,c]));const by=id=>base.players.find(p=>p.playerId===id);
 assert.equal(by('a').owgrPercentile,100);assert.equal(by('b').owgrPercentile,0);
 assert.equal(by('b').valueBasis,'owgr_only');assert.equal(by('b').pricing.suggestedSalary,15);
 assert.equal(by('c').finalValue,null);assert.equal(by('c').finalRank,null);assert.equal(by('c').pricing.suggestedSalary,null);
 const amateur=buildGolfValues(input([a,b,{...c,isAmateur:true}])).players.find(p=>p.playerId==='c');
 assert.equal(amateur.value,by('c').value);assert.equal(amateur.finalValue,null);assert.equal(amateur.pricing.suggestedSalary,10);
 assert.equal(amateur.pricing.effectiveSalary,null);assert.equal(base.priceSetState,'draft');
 assert.equal(buildGolfValues(input([{...a,isAmateur:true}])).players[0].pricing.suggestedSalary,10);
 const invalid=buildGolfValues(input([{...c,owgrRank:NaN}]));assert.equal(invalid.players[0].pricing.status,'unpriced');
});
test('no meaningless WD finish counts as usable history; fixed performance weights ignore odds',()=>{
 const x=input([{playerId:'p',name:'p',history:[{...history(0,100,0,'withdrawn'),finishPercentile:100,roundDifferentials:[]}]}]);
 assert.equal(buildGolfValues(x).players[0].confidence,'no_history');
 assert.deepEqual(buildGolfValues({...x,market:{}}),buildGolfValues(x));
});
test('invalid input and duplicated history reject; no mutation or scoring/acquisition dependency',()=>{
 const x=input([player('p')]);const saved=JSON.stringify(x);assert.deepEqual(buildGolfValues({...x,gameType:'best_ball',draft:{type:'salary_cap'}}),buildGolfValues(x));assert.equal(JSON.stringify(x),saved);
 assert.throws(()=>buildGolfValues(input([player('p'),player('p')])));
 x.players[0].history.push(x.players[0].history[0]);assert.throws(()=>buildGolfValues(x),/Duplicate/);
});
const round=(period,strokes=72,toPar='E',holeCount=18)=>({period,value:strokes,displayValue:toPar,linescores:Array.from({length:holeCount},(_,i)=>({period:i+1,value:4}))});
const competitor=(id,order,rel='E',n=4)=>({id,type:'athlete',order,score:rel,athlete:{displayName:id},linescores:Array.from({length:n},(_,i)=>round(i+1,72+Number(rel==='E'?0:rel),rel))});
const payload=()=>({events:[{id:'prior',name:'Stroke play',date:'2026-07-01',endDate:'2026-07-05',status:{type:{completed:true}},competitions:[{status:{period:4},competitors:Array.from({length:10},(_,i)=>competitor(String(i),i+1,i===0?'-2':'E'))}]},{id:'target',name:'Next',date:'2026-08-01',endDate:'2026-08-05',competitions:[{competitors:[competitor('0',1),competitor('1',2)]}]}]});
test('ESPN adapter extracts field IDs and same-round baseline without target results',()=>{
 const p=payload();const r=golfValueInputsFromEspn(p,'target');assert.equal(r.players[0].playerId,'0');assert.equal(r.players[0].history.length,1);
 assert.equal(r.players[0].history[0].roundDifferentials[0],1.8);
 assert.equal(r.players[1].history[0].roundDifferentials[0],-.2);
 p.events[1].competitions[0].competitors[0].linescores=[];assert.deepEqual(golfValueInputsFromEspn(p,'target'),r);
});
test('ESPN incomplete appearances stay unknown rather than guessed cut/WD; unsupported formats skipped',()=>{
 const p=payload();p.events[0].competitions[0].competitors[0].linescores=[round(1),round(2),round(3,20,'E',5)];
 const r=golfValueInputsFromEspn(p,'target');assert.equal(r.players[0].history[0].status,'unknown');assert.equal(r.players[0].history[0].roundDifferentials.length,2);
 p.events[0].name='Zurich Classic';assert.equal(golfValueInputsFromEspn(p,'target').players[0].history.length,0);
});
test('round-relative normalization is invariant to common easier/harder course scoring',()=>{
 const p=payload(),r=golfValueInputsFromEspn(p,'target');
 for(const c of p.events[0].competitions[0].competitors)for(const h of c.linescores){h.displayValue=String(Number(h.displayValue==='E'?0:h.displayValue)+5);h.value+=5;}
 const next=golfValueInputsFromEspn(p,'target');
 r.players.forEach((p,i)=>p.history[0].roundDifferentials.forEach((d,j)=>assert.ok(Math.abs(d-next.players[i].history[0].roundDifferentials[j])<1e-10)));
});
