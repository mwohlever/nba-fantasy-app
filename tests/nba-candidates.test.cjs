/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename,
}).outputText,filename);
const {normalizeEspnNbaGameLog}=require('../lib/analytics/providers/espnNbaGameLog.ts');
const {nbaCandidateTournament,createNbaCandidate,estimateMinutes,estimateRates,candidateConfidence,workloadContext}=require('../lib/analytics/nba/candidates.ts');
const {backtestNba}=require('../lib/analytics/nba/backtest.ts');
const {targetNbaScoring,scoreNbaStats}=require('../lib/analytics/nba/scoring.ts');
const {pearson,tournamentMetrics,pairedPlayerComparison}=require('../lib/analytics/nba/tournamentMetrics.ts');
const fixture=require('./fixtures/espn-nba-gamelog-1966-2025.json');
const template=normalizeEspnNbaGameLog(fixture,{espnPlayerId:'1966',season:2025,fetchedAt:'2026-09-10T22:00:00Z',knownAt:null}).observations[0];
const config=nbaCandidateTournament().find(c=>c.id==='nba-v2-median8-recent15-v1');
const date=day=>new Date(Date.UTC(2025,0,1,18)+day*86400000).toISOString();
function row(day,minutes=35,points=45,options={}) {
  return {...structuredClone(template),eventId:String(10000+day),gameAt:date(day),completedAt:date(day).replace('18:','21:'),phase:'regular',season:2025,
    gameStatus:'final',minutes,participation:'played',stats:{points,rebounds:0,assists:0,steals:0,blocks:0,turnovers:0},missing:[],...options};
}
function context(history,day=40) {
  return {history,target:{id:'target',eventId:'99999',provider:'espn',providerPlayerId:'1966',asOf:date(day),gameAt:date(day),season:2025,phase:'regular'},
    scoring:targetNbaScoring({sport:'nba'})};
}
test('bounded candidate catalog is explicit, unique, valid and not mutable through closures',()=>{
  const catalog=nbaCandidateTournament();assert.equal(catalog.length,27);assert.equal(new Set(catalog.map(c=>c.id)).size,27);
  for(const c of catalog) assert.equal(typeof createNbaCandidate(c),'function');
  const local=structuredClone(config),candidate=createNbaCandidate(local);local.minutes.window=0;
  assert.equal(candidate(context([row(1)])).expectedMinutes,35);
  assert.throws(()=>createNbaCandidate({...config,minutes:{kind:'median',window:0}}));
  assert.throws(()=>createNbaCandidate({...config,rates:{kind:'weighted',window:5}}));
});
test('minute medians, weighted estimates and short/long blends have exact expected behavior',()=>{
  const history=[row(1,10),row(2,20),row(3,30)];
  assert.equal(estimateMinutes(history,{kind:'median',window:3}).minutes,20);
  assert.equal(estimateMinutes(history,{kind:'weighted-median',window:3,halfLife:1}).minutes,30);
  const expected=(10*.25+20*.5+30)/1.75;
  assert.equal(estimateMinutes(history,{kind:'weighted-mean',window:3,halfLife:1}).minutes,expected);
  assert.equal(estimateMinutes(history,{kind:'blend',window:3,halfLife:1,recentShare:.5}).minutes,.5*expected+10);
  assert.equal(estimateMinutes([],{kind:'median',window:5}),null);
});
test('isolated short game affects rate with five minutes of evidence and workload with reduced influence',()=>{
  const normal=Array.from({length:5},(_,i)=>row(i)),short=row(5,5,4),history=[...normal,short];
  const robust=estimateMinutes(history,{kind:'robust',window:8,halfLife:3,lowRatio:.5,lowInfluence:.25});
  const ordinary=estimateMinutes(history,{kind:'weighted-mean',window:8,halfLife:3});
  assert.equal(robust.downweighted,1);assert.ok(robust.minutes>ordinary.minutes);assert.ok(robust.minutes<35);
  assert.equal(estimateRates(history,[],{kind:'recent',window:15}).rates.points,229/180);
  assert.equal(history.at(-1).minutes,5);assert.equal(history.at(-1).stats.points,4);
});
test('a five-minute bench role is not an anomaly',()=>{
  const history=Array.from({length:6},(_,i)=>row(i,5,4));
  const result=estimateMinutes(history,{kind:'robust',window:8,halfLife:3,lowRatio:.5,lowInfluence:.25,adapt:true});
  assert.equal(result.downweighted,0);assert.ok(Math.abs(result.minutes-5)<1e-12);assert.equal(result.roleChange,'none');
});
test('three repeated changes adapt downward and upward without diagnosing cause',()=>{
  for(const [minutes,direction] of [[[35,36,34,12,14,16],'lower'],[[15,16,14,32,34,36],'higher']]) {
    const history=minutes.map((m,i)=>row(i,m));
    const result=estimateMinutes(history,{kind:'robust',window:8,halfLife:3,lowRatio:.5,lowInfluence:.25,adapt:true});
    assert.equal(result.roleChange,`sustained-${direction}-workload`);
    assert.ok(result.minutes>minutes[3]&&result.minutes<minutes[5]);
  }
  const isolated=[35,36,34,5].map((m,i)=>row(i,m));
  assert.equal(estimateMinutes(isolated,{kind:'robust',window:8,halfLife:3,lowRatio:.5,lowInfluence:.25,adapt:true}).roleChange,'none');
});
test('simple workload guardrails handle restriction, overtime, volatile benches, and ordinary full-minute bad games',()=>{
  const robust={kind:'robust',window:8,halfLife:3,lowRatio:.5,lowInfluence:.25};
  const restricted=[35,36,34,35,22,20,18].map((m,i)=>row(i,m));
  const restriction=estimateMinutes(restricted,robust);
  assert.equal(restriction.roleChange,'none');
  assert.ok(restriction.minutes<30 && restriction.minutes>18,
    'the selected non-adaptive robust model still responds to repeated restrictions');

  const overtime=[35,36,34,35,48].map((m,i)=>row(i,m));
  const afterOvertime=estimateMinutes(overtime,robust);
  assert.equal(afterOvertime.roleChange,'none');
  assert.ok(afterOvertime.minutes<40,'one overtime workload does not establish a new role');

  const bench=[8,23,11,21,7,24,10,20].map((m,i)=>row(i,m));
  const volatile=estimateMinutes(bench,robust);
  assert.equal(volatile.roleChange,'none');
  assert.ok(volatile.minutes>8 && volatile.minutes<24);

  const ordinaryBad=[row(1,35,45),row(2,35,0,{stats:{points:0,rebounds:0,assists:0,steals:0,blocks:0,turnovers:2}})];
  assert.equal(estimateRates(ordinaryBad,[],{kind:'recent',window:15}).rates.points,45/70,
    'a poor full-minute game remains normal rate evidence');
});
test('rate estimators are ratios of totals, including recency; no equal-weight per-game rate average',()=>{
  const history=[row(1,35,45),row(2,5,4)];
  assert.equal(estimateRates(history,[],{kind:'season'}).rates.points,49/40);
  assert.equal(estimateRates(history,[],{kind:'recent',window:1}).rates.points,4/5);
  assert.equal(estimateRates(history,[],{kind:'weighted',window:2,halfLife:1}).rates.points,(.5*45+4)/(.5*35+5));
  assert.equal(estimateRates(history,[],{kind:'blend',window:1,recentShare:.5}).rates.points,.5*(4/5)+.5*(49/40));
});
test('shrinkage uses disjoint older history and stronger rare-stat stabilization',()=>{
  const older=Array.from({length:10},(_,i)=>row(i,35,35,{stats:{points:35,rebounds:5,assists:5,steals:1,blocks:1,turnovers:2}}));
  const fresh=row(10,5,20,{stats:{points:20,rebounds:5,assists:5,steals:3,blocks:3,turnovers:2}});
  const history=[...older,fresh];
  const light=estimateRates(history,[],{kind:'recent',window:1,priorMinutes:100,rareStatPriorMultiplier:1});
  const rare=estimateRates(history,[],{kind:'recent',window:1,priorMinutes:100,rareStatPriorMultiplier:2});
  assert.equal(rare.priorSource,'older-current-season');assert.equal(rare.rates.points,120/105);
  assert.ok(Math.abs(rare.rates.steals-1/35)<Math.abs(light.rates.steals-1/35));
  const only=estimateRates([fresh],[],{kind:'recent',window:1,priorMinutes:100});assert.equal(only.priorSource,'none');
  assert.equal(only.rates.points,4);
});
test('fallback hierarchy: previous season only when available/recent, sparse blending stays low confidence, otherwise abstain',()=>{
  const prior=Array.from({length:8},(_,i)=>row(-100+i,35,45,{season:2024}));
  const candidate=createNbaCandidate(config);
  assert.equal(candidate(context([])),null);
  const fallback=candidate(context(prior));assert.equal(fallback.confidence,'low');assert.match(fallback.fallbackReason,/Previous-season/);
  assert.equal(createNbaCandidate({...config,priorFallback:false})(context(prior)),null);
  assert.equal(candidate(context([row(-300,35,45,{season:2024})])),null);
  const sparse=createNbaCandidate({...config,sparseMinutesPrior:true})(context([...prior,row(1,5,4)]));
  assert.equal(sparse.expectedMinutes,27.5);assert.equal(sparse.confidence,'low');
});
test('projection changes with target rules while estimated minutes/rates do not',()=>{
  const candidate=createNbaCandidate(config),ctx=context(Array.from({length:20},(_,i)=>row(i)),20);
  const a=candidate(ctx),b=candidate({...ctx,scoring:targetNbaScoring({sport:'nba',scoring:{points:2}})});
  assert.equal(a.expectedMinutes,b.expectedMinutes);assert.deepEqual(a.statRatesPerMinute,b.statRatesPerMinute);
  assert.equal(b.projectedFantasyPoints,2*a.projectedFantasyPoints);
  assert.equal(a.projectedFantasyPoints,scoreNbaStats(a.projectedStats,ctx.scoring));
});
test('confidence measures evidence without acting as a score discount',()=>{
  const evidence={currentGames:20,effectiveGames:10,daysSinceLast:2,minuteDeviation:2,roleChange:'none',lowWorkloadSignal:false,usedFallback:false};
  assert.equal(candidateConfidence(evidence),'high');assert.equal(candidateConfidence({...evidence,currentGames:8}),'medium');
  for(const change of [{currentGames:1},{daysSinceLast:30},{roleChange:'sustained-lower-workload'},{lowWorkloadSignal:true}]) {
    assert.equal(candidateConfidence({...evidence,...change}),'low');
  }
  const history=Array.from({length:20},(_,i)=>row(i));const candidate=createNbaCandidate(config);
  const fresh=candidate(context(history,20)),stale=candidate(context(history,60));
  assert.equal(fresh.projectedFantasyPoints,stale.projectedFantasyPoints);assert.notEqual(fresh.confidence,stale.confidence);
});
test('every candidate runs through chronological harness with future results excluded',()=>{
  const history=Array.from({length:8},(_,i)=>row(i));const truth=row(8);
  const target={...context([],8).target,eventId:truth.eventId,id:'truth',rulesSnapshot:{sport:'nba'}};
  for(const c of nbaCandidateTournament()) {
    const run=future=>backtestNba({history:[...history,truth,future],actuals:[truth],targets:[target],
      policy:{availability:'retrospective',unknownCompletionLagHours:24,phases:['regular']},candidate:createNbaCandidate(c)});
    const a=run(row(9,48,999)),b=run(row(9,1,0));
    assert.equal(a.rows.length,1);assert.equal(a.rows[0].predicted,b.rows[0].predicted);
  }
});
test('cohort features respond to past workload only; zero/negative scoring games remain evidence',()=>{
  const history=[row(1),row(2),row(3),row(4,5,0,{stats:{points:0,rebounds:0,assists:0,steals:0,blocks:0,turnovers:2}})];
  assert.equal(workloadContext(history,date(5)).lowWorkloadSignal,true);
  const prediction=createNbaCandidate(config)(context(history,5));
  assert.equal(prediction.components.productionSample,4);assert.ok(prediction.projectedStats.turnovers>0);
});
test('metrics include median error, tied-rank correlation, and honest undefined constant correlations',()=>{
  assert.equal(pearson([1,2,3],[2,4,6]),1);assert.equal(pearson([1,1],[2,3]),null);
  const rows=[1,2,3].map((n,i)=>({targetId:String(i),playerId:'p',predicted:n,actual:n+1,expectedMinutes:null,actualMinutes:30,
    actualStats:{},confidence:'low',cohorts:[]}));
  const metrics=tournamentMetrics(rows);assert.equal(metrics.mae,1);assert.equal(metrics.medianAbsoluteError,1);assert.equal(metrics.rankCorrelation,1);
  assert.equal(metrics.minutes.predictions,0);
});
test('paired player bootstrap is deterministic and compares identical outcomes only',()=>{
  const candidate=[1,2,3].map(n=>({targetId:String(n),playerId:String(n),predicted:10,actual:10}));
  const baseline=candidate.map(r=>({...r,predicted:12}));
  const comparison=pairedPlayerComparison(candidate,baseline);assert.equal(comparison.macroMaeDelta,-2);
  assert.deepEqual(comparison.playerBlockBootstrap95,[-2,-2]);assert.deepEqual(pairedPlayerComparison(candidate,baseline),comparison);
  assert.throws(()=>pairedPlayerComparison(candidate,baseline.map(r=>({...r,actual:11}))));
});
test('offline tournament locks development choice and rejects changed holdout definitions',()=>{
  const os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
  const {execFileSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nba-tournament-test-'));
  try {
    const observations=[];
    for(const season of [2023,2024,2025])for(let i=0;i<3;i++)observations.push(row(i,35,season===2025?90:45,{
      eventId:String(season*100+i),season,gameAt:`${season}-01-0${i+1}T18:00:00Z`,completedAt:`${season}-01-0${i+1}T21:00:00Z`,
    }));
    const dataset={version:'test',plan:{developmentSeasons:[2024],holdoutSeasons:[2025],selection:'development macro MAE',
      players:[{espnPlayerId:'1966',expectedName:'Test athlete'}]},observations};
    const raw=JSON.stringify(dataset);
    fs.writeFileSync(path.join(dir,'nba-tournament-dataset.json.gz'),zlib.gzipSync(raw));
    fs.writeFileSync(path.join(dir,'nba-tournament-manifest.json'),JSON.stringify({datasetSha256:crypto.createHash('sha256').update(raw).digest('hex')}));
    const script=path.resolve(__dirname,'../scripts/run-nba-tournament.cjs');
    execFileSync(process.execPath,[script,'development',dir,dir],{stdio:'pipe'});
    const lockFile=path.join(dir,'nba-tournament-selection.json'),locked=fs.readFileSync(lockFile,'utf8');
    execFileSync(process.execPath,[script,'holdout',dir,dir],{stdio:'pipe'});
    assert.equal(fs.readFileSync(lockFile,'utf8'),locked);
    const hold=JSON.parse(fs.readFileSync(path.join(dir,'holdout-summary.json'),'utf8'));
    assert.equal(hold.selection,JSON.parse(locked).selectedCandidate);
    fs.writeFileSync(lockFile,JSON.stringify({...JSON.parse(locked),definitionHash:'altered'}));
    assert.throws(()=>execFileSync(process.execPath,[script,'holdout',dir,dir],{stdio:'pipe'}));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
