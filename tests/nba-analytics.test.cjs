/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { normalizeEspnNbaGameLog, parseNbaMinutes, fetchEspnNbaGameLog } = require('../lib/analytics/providers/espnNbaGameLog.ts');
const { resolveEspnNbaIdentity } = require('../lib/analytics/nba/identity.ts');
const { observationsAsOf } = require('../lib/analytics/nba/history.ts');
const { describeParticipation, modelingEvidence } = require('../lib/analytics/nba/participation.ts');
const { scoreNbaStats, targetNbaScoring } = require('../lib/analytics/nba/scoring.ts');
const { instant } = require('../lib/analytics/nba/types.ts');
const { backtestNba, nbaAverageBaseline, evaluatePredictions } = require('../lib/analytics/nba/backtest.ts');
const { weightedMean, weightedMedian, weightedRatioOfTotals, effectiveSampleSize, recencyWeight } = require('../lib/analytics/statistics.ts');
const fixture = require('./fixtures/espn-nba-gamelog-1966-2025.json');
const request = { espnPlayerId: '1966', season: 2025, fetchedAt: '2026-09-10T21:00:00Z', knownAt: null };
const normalized = () => normalizeEspnNbaGameLog(structuredClone(fixture), request);
const allPhases = ['regular', 'postseason', 'preseason'];
const retrospective = { availability: 'retrospective', unknownCompletionLagHours: 24, phases: allPhases };
const recorded = { availability: 'recorded', phases: allPhases };
const scope = { provider: 'espn', providerPlayerId: '1966', excludeEventIds: [] };
const baseStats = { points: 45, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 };
function appearance(eventId, day, overrides = {}) {
  return { ...normalized().observations[0], eventId, gameAt: `2025-01-${String(day).padStart(2, '0')}T18:00:00Z`,
    completedAt: `2025-01-${String(day).padStart(2, '0')}T21:00:00Z`, season: 2025, phase: 'regular',
    minutes: 35, gameStatus: 'final', participation: 'played', stats: { ...baseStats }, missing: [],
    provenance: { source: 'fixture', fetchedAt: '2026-09-10T21:00:00Z', knownAt: null }, ...overrides };
}
function target(row, overrides = {}) {
  return { id: row.eventId, eventId: row.eventId, provider: row.provider, providerPlayerId: row.providerPlayerId,
    season: row.season, phase: row.phase, gameAt: row.gameAt, asOf: row.gameAt,
    rulesSnapshot: { sport: 'nba' }, ...overrides };
}
function mutateFirst(mutator) {
  const p = structuredClone(fixture), row = p.seasonTypes[0].categories[0].events[0];
  mutator(p, row, p.events[row.eventId]);
  return normalizeEspnNbaGameLog(p, request).observations.find(o => o.eventId === row.eventId);
}

test('real reduced ESPN fixture: event-only rows, phases, IDs, dates, stats and optional shots', () => {
  const { observations, issues } = normalized();
  assert.equal(observations.length, 6);
  assert.deepEqual(issues, []);
  assert.deepEqual(new Set(observations.map(o => o.phase)), new Set(allPhases));
  const row = observations.find(o => o.eventId === '401768058');
  assert.equal(row.minutes, 40); assert.equal(row.stats.points, 22);
  assert.equal(row.stats.turnovers, 3); assert.equal(row.shooting.fieldGoalsAttempted, 21);
  assert.equal(row.gameStatus, 'final'); assert.equal(row.finalEvidence, 'result');
  assert.equal(row.completedAt, null); assert.equal(row.starter, null);
  assert.equal(row.identity.status, 'unresolved'); assert.equal(row.providerPlayerId, '1966');
  assert.equal(row.homeAway, 'home');
  assert.ok(observations.every(o => o.gameAt.endsWith('Z')));
});
test('minutes accept decimal, MM:SS and duration; missing and DNP stay null', () => {
  for (const [value, expected] of [[35,35], ['35',35], ['5:30',5.5], ['PT5M30S',5.5], ['PT30S',0.5], ['0',0],
    [null,null], [undefined,null], ['',null], ['--',null], ['DNP',null], ['5:60',null], ['PT',null], [-1,null], [Infinity,null]]) {
    assert.equal(parseNbaMinutes(value), expected);
  }
});
test('missing scoring data stays null while zero is real', () => {
  const row = mutateFirst((p,r) => { r.stats[p.names.indexOf('steals')] = '0'; r.stats[p.names.indexOf('blocks')] = '--'; });
  assert.equal(row.stats.steals, 0); assert.equal(row.stats.blocks, null);
  assert.ok(row.missing.includes('blocks')); assert.equal(modelingEvidence(row).rateEligible, false);
  assert.equal(scoreNbaStats(row.stats, targetNbaScoring({})), null);
});
test('short arrays cannot silently shift stat columns', () => {
  const row = mutateFirst((_p,r) => r.stats.pop());
  assert.equal(row.stats.points, null); assert.equal(row.minutes, null);
  assert.ok(row.missing.includes('stat-array-length'));
});
test('DNP, zero-minute unknown and live rows never masquerade as complete played games', () => {
  const dnp = mutateFirst((p,r) => { r.stats = p.names.map(() => '--'); r.stats[0] = 'DNP'; });
  assert.equal(dnp.participation, 'dnp'); assert.equal(dnp.minutes, null);
  assert.equal(modelingEvidence(dnp).rateEligible, false);
  const zero = mutateFirst((_p,r) => { r.stats[0] = '0'; });
  assert.equal(zero.participation, 'unknown');
  const live = mutateFirst((_p,_r,e) => { e.status = { type: { state: 'in' } }; });
  assert.equal(live.gameStatus, 'in_progress'); assert.equal(modelingEvidence(live).rateEligible, false);
  const ambiguous = mutateFirst((_p,_r,e) => { delete e.gameResult; });
  assert.equal(ambiguous.gameStatus, 'unknown');
});
test('duplicates deduplicate; conflicting duplicate results quarantine deterministically', () => {
  const p = structuredClone(fixture), c = p.seasonTypes[0].categories[0];
  c.events.push(structuredClone(c.events[0]));
  assert.equal(normalizeEspnNbaGameLog(p, request).observations.length, 6);
  c.events.at(-1).stats[0] = '2';
  const result = normalizeEspnNbaGameLog(p, request);
  assert.equal(result.observations.length, 5); assert.match(result.issues[0], /Conflicting duplicate/);
  c.events.reverse(); assert.deepEqual(normalizeEspnNbaGameLog(p, request), result);
});
test('bad shapes, season/league identity, timestamps and duplicate columns fail closed', () => {
  assert.throws(() => normalizeEspnNbaGameLog({}, request));
  for (const mutate of [p => p.names.push(p.names[0]), p => p.filters.find(f=>f.name==='season').value='2026',
    p => p.filters.find(f=>f.name==='league').value='wnba', p => p.athlete={id:'other'}]) {
    const p = structuredClone(fixture); mutate(p); assert.throws(() => normalizeEspnNbaGameLog(p,request));
  }
  assert.throws(() => normalizeEspnNbaGameLog(fixture, {...request, fetchedAt:'bad'}));
  assert.throws(() => normalizeEspnNbaGameLog(fixture, {...request, knownAt:'2027-01-01T00:00:00Z'}));
});
test('crosswalk requires explicit namespaced evidence, catches collisions, never guesses equal IDs', () => {
  assert.equal(resolveEspnNbaIdentity('1966', []).status, 'unresolved');
  const entry = { sport:'nba', provider:'espn', providerPlayerId:'1966', nbaPlayerId:'2544',
    canonicalPlayerId:'111:nba:players:1', evidence:'Test-only explicit mapping' };
  assert.equal(resolveEspnNbaIdentity('1966',[entry]).canonicalPlayerId, entry.canonicalPlayerId);
  assert.equal(resolveEspnNbaIdentity('1966',[entry,{...entry,providerPlayerId:'999'}]).status,'unresolved');
  assert.equal(resolveEspnNbaIdentity('1966',[entry,{...entry,nbaPlayerId:'888'}]).status,'unresolved');
  assert.throws(()=>resolveEspnNbaIdentity('1966',[{...entry,sport:'nfl'}]));
});
test('fetcher is GET-only, timestamped, shape-validated and fails on provider errors', async () => {
  let called;
  const result = await fetchEspnNbaGameLog({espnPlayerId:'1966',season:2025}, {
    now:()=>new Date(request.fetchedAt), fetcher:async (url, options)=>{called={url,options}; return {ok:true,json:async()=>fixture};},
  });
  assert.equal(called.options.method,'GET'); assert.match(called.url,/1966\/gamelog\?season=2025$/);
  assert.equal(result.observations[0].provenance.knownAt,'2026-09-10T21:00:00.000Z');
  await assert.rejects(fetchEspnNbaGameLog({espnPlayerId:'1966',season:2025},{fetcher:async()=>({ok:false,status:429})}),/429/);
});
test('as-of strictly excludes target, future, incomplete and invalid dates and sorts chronology', () => {
  const rows=[appearance('future',5),appearance('two',2),appearance('target',3),appearance('one',1),
    appearance('invalid',1,{gameAt:null}),appearance('live',1,{gameStatus:'in_progress'}),
    appearance('other',1,{providerPlayerId:'999'})];
  const result=observationsAsOf(rows,'2025-01-03T18:00:00Z',{...scope,excludeEventIds:['target']},retrospective);
  assert.deepEqual(result.observations.map(o=>o.eventId),['one','two']);
  assert.equal(rows[0].eventId,'future');
  for(const date of ['2025-01-03','bad','2025-02-30T00:00:00Z','2025-01-03T18:00:00','2025-01-03T24:00:00Z']) {
    assert.equal(instant(date),null); assert.throws(()=>observationsAsOf(rows,date,scope,retrospective));
  }
});
test('same-day final needs evidence of completion before cutoff; start time is insufficient', () => {
  const early=appearance('early',2,{gameAt:'2025-01-02T10:00:00Z',completedAt:'2025-01-02T13:00:00Z'});
  const unknown={...early,eventId:'unknown',completedAt:null};
  const later={...early,eventId:'later',completedAt:'2025-01-02T20:00:00Z'};
  assert.deepEqual(observationsAsOf([early,unknown,later],'2025-01-02T18:00:00Z',scope,retrospective).observations.map(o=>o.eventId),['early']);
  assert.equal(observationsAsOf([unknown],'2025-01-04T18:00:00Z',scope,retrospective).observations.length,1);
  assert.equal(observationsAsOf([unknown],'2025-01-04T18:00:00Z',scope,{...retrospective,unknownCompletionLagHours:undefined}).observations.length,0);
});
test('recorded mode requires revision knowledge; future corrections cannot replace old known revisions', () => {
  const original=appearance('one',1,{provenance:{source:'test',knownAt:'2025-01-01T22:00:00Z',fetchedAt:'2025-01-01T22:00:00Z'}});
  const correction={...original,stats:{...baseStats,points:99},provenance:{...original.provenance,knownAt:'2025-01-03T00:00:00Z',fetchedAt:'2025-01-03T00:00:00Z'}};
  const cutoff='2025-01-02T18:00:00Z';
  assert.equal(observationsAsOf([appearance('unknown',1)],cutoff,scope,recorded).observations.length,0);
  assert.equal(observationsAsOf([correction,original,original],cutoff,scope,recorded).observations[0].stats.points,45);
  assert.equal(observationsAsOf([correction],cutoff,scope,retrospective).observations.length,0);
  const incomplete={...correction,stats:{...baseStats,points:null}};
  const selected=observationsAsOf([original,incomplete],'2025-01-04T00:00:00Z',scope,recorded).observations;
  assert.equal(selected.length,1); assert.equal(modelingEvidence(selected[0]).rateEligible,false);
});
test('conflicting revisions are quarantined and phase/season inclusion is explicit', () => {
  const first=appearance('one',1), conflict={...first,stats:{...baseStats,points:40}};
  const result=observationsAsOf([first,conflict],'2025-01-05T18:00:00Z',scope,retrospective);
  assert.equal(result.observations.length,0); assert.equal(result.excluded[0].reason,'conflicting-revision');
  const post=appearance('post',2,{phase:'postseason'});
  assert.deepEqual(observationsAsOf([first,post],'2025-01-05T18:00:00Z',scope,{...retrospective,phases:['regular'],seasons:[2025]}).observations.map(o=>o.eventId),['one']);
  assert.equal(observationsAsOf([first],'2025-01-05T18:00:00Z',scope,{...retrospective,seasons:[2024]}).observations.length,0);
});
test('weighted utilities handle empty samples, ties, order, and invalid evidence explicitly', () => {
  assert.equal(weightedMean([]),null); assert.equal(weightedMedian([]),null); assert.equal(effectiveSampleSize([]),0);
  assert.equal(weightedMedian([{value:9,weight:1},{value:1,weight:1}]),5);
  assert.equal(weightedMedian([{value:100,weight:0},{value:35,weight:3},{value:5,weight:1}]),35);
  assert.equal(weightedMean([{value:0,weight:1},{value:-2,weight:1}]),-1);
  assert.equal(effectiveSampleSize([1,1,1]),3); assert.ok(effectiveSampleSize([1,0.1])<2);
  assert.equal(recencyWeight(0,3),1); assert.equal(recencyWeight(3,3),0.5);
  assert.ok(recencyWeight(1,3)>recencyWeight(2,3));
  assert.throws(()=>weightedMean([{value:NaN,weight:1}])); assert.throws(()=>weightedMedian([{value:1,weight:-1}]));
  assert.throws(()=>recencyWeight(-1,3)); assert.throws(()=>recencyWeight(0,0));
  assert.equal(weightedRatioOfTotals([]),null);
  assert.throws(()=>weightedRatioOfTotals([{production:1,opportunity:0,weight:1}]));
});
test('35 minute/45 FP versus five minute/four FP: preserve truth and weight by opportunity', () => {
  const normal=[appearance('a',1),appearance('b',2),appearance('c',3)];
  const early=appearance('d',4,{minutes:5,stats:{...baseStats,points:4}});
  const history=[...normal,early];
  const eligible=observationsAsOf(history,'2025-01-05T18:00:00Z',scope,retrospective).observations;
  assert.equal(eligible.length,4); assert.equal(eligible.at(-1).stats.points,4);
  const descriptors=describeParticipation(early,normal,0.5);
  assert.equal(descriptors.opportunityMinutes,5); assert.equal(descriptors.typicalMinutes,35);
  assert.equal(descriptors.participationRatio,1/7); assert.equal(descriptors.possibleLowWorkload,true);
  assert.equal(descriptors.cause,'unknown');
  const ratio=weightedRatioOfTotals(history.map(row=>({production:row.stats.points,opportunity:row.minutes,weight:1})));
  assert.equal(ratio,139/110);
  assert.notEqual(ratio,weightedMean(history.map(row=>({value:row.stats.points/row.minutes,weight:1}))));
  const bench=normal.map(row=>({...row,minutes:5}));
  assert.equal(describeParticipation(early,bench,0.5).possibleLowWorkload,false);
});
test('target frozen rules reuse scorer, retain negative FP, reject incomplete stats and unrelated sport', () => {
  const snapshot={sport:'nba',scoring:{points:2,turnovers:-3}};
  const scoring=targetNbaScoring(snapshot); snapshot.scoring.points=999;
  assert.equal(scoreNbaStats(baseStats,scoring),90);
  assert.equal(scoreNbaStats(baseStats,targetNbaScoring({sport:'nba'})),45);
  assert.equal(scoreNbaStats({...baseStats,points:0,turnovers:2},targetNbaScoring({})),-2);
  assert.throws(()=>targetNbaScoring(null)); assert.ok(targetNbaScoring(null,true));
  assert.throws(()=>targetNbaScoring({sport:'nfl'}));
  assert.equal(scoreNbaStats({...baseStats,points:null},scoring),null);
});
test('metrics use prediction minus actual bias; empty result has null errors', () => {
  assert.deepEqual(evaluatePredictions([{predicted:12,actual:10},{predicted:6,actual:10}]),{predictions:2,mae:3,rmse:Math.sqrt(10),bias:-1});
  assert.deepEqual(evaluatePredictions([]),{predictions:0,mae:null,rmse:null,bias:null});
});
test('backtest candidate sees only immutable as-of player history, never target actual or injected extras', () => {
  const a=appearance('a',1), b=appearance('b',2), future=appearance('c',3,{stats:{...baseStats,points:1000}});
  const calls=[];
  const candidate=context=>{
    calls.push(context.history.map(row=>row.eventId));
    assert.equal(context.target.stats,undefined); assert.equal(context.target.seasonTotal,undefined);
    assert.ok(Object.isFrozen(context.history)); assert.ok(context.history.every(row=>Object.isFrozen(row.stats)));
    return nbaAverageBaseline({kind:'season-to-date'})(context);
  };
  const result=backtestNba({history:[future,b,a],actuals:[a,b,future],targets:[target(b,{stats:b.stats,seasonTotal:1000}),target(a)],policy:retrospective,candidate});
  assert.deepEqual(calls,[[],['a']]); assert.equal(result.metrics.predictions,1); assert.equal(result.metrics.mae,0);
  assert.equal(result.rows[0].predicted,45); assert.equal(result.skipped[0].reason,'candidate-abstained');
});
test('changing future truth cannot change an earlier forecast; negative/zero outcomes stay in baselines', () => {
  const a=appearance('a',1,{stats:{...baseStats,points:0,turnovers:2}}), b=appearance('b',2,{stats:{...baseStats,points:0}}), c=appearance('c',3);
  const run=actual=>backtestNba({history:[a,b,actual],actuals:[actual],targets:[target(actual)],policy:retrospective,candidate:nbaAverageBaseline({kind:'recent',games:3})});
  assert.equal(run(c).rows[0].predicted,-1);
  assert.equal(run({...c,stats:{...baseStats,points:999}}).rows[0].predicted,-1);
});
test('harness rejects duplicates, late cutoffs and inconsistent projected stat scoring', () => {
  const a=appearance('a',1), b=appearance('b',2);
  const input={history:[a],actuals:[b],targets:[target(b)],policy:retrospective,candidate:nbaAverageBaseline({kind:'season-to-date'})};
  assert.throws(()=>backtestNba({...input,targets:[target(b),target(b)]}),/Duplicate/);
  assert.throws(()=>backtestNba({...input,targets:[target(b,{asOf:'2025-01-03T00:00:00Z'})]}),/tipoff/);
  assert.equal(backtestNba({...input,actuals:[b,b]}).skipped[0].reason,'missing-or-duplicate-actual');
  assert.throws(()=>backtestNba({...input,candidate:context=>({...input.candidate(context),projectedStats:{...baseStats,points:999}})}),/target scoring/);
});

test('missing metadata, impossible dates, explicit starters and optional shooting stay distinguishable', () => {
  const missing = mutateFirst((_p,r,e) => { r.starter=false; e.gameDate='2025-02-30T00:00:00Z'; delete e.team; });
  assert.equal(missing.starter,false); assert.equal(missing.gameAt,null);
  assert.equal(missing.team.providerId,null); assert.equal(missing.homeAway,null);
  assert.ok(missing.missing.includes('gameAt')); assert.ok(missing.missing.includes('team'));
  const partial = mutateFirst((p,r) => { r.stats[p.names.indexOf('fieldGoalsMade-fieldGoalsAttempted')]='--'; });
  assert.equal(partial.shooting.fieldGoalsAttempted,null); assert.equal(modelingEvidence(partial).rateEligible,true);
  const postponed = mutateFirst((_p,_r,e) => { e.status={type:{name:'STATUS_POSTPONED'}}; });
  assert.equal(postponed.gameStatus,'unknown');
  const allStar = mutateFirst((_p,_r,e) => { e.team.isAllStar=true; });
  assert.equal(allStar.phase,'unknown');
});
test('explicit target exclusions override a misleading earlier timestamp and different timezone strings compare as instants', () => {
  const a=appearance('a',1,{gameAt:'2025-01-02T00:00:00+06:00',completedAt:'2025-01-02T03:00:00+06:00'});
  const b=appearance('target',1);
  const result=observationsAsOf([a,b],'2025-01-02T18:00:00Z',{...scope,excludeEventIds:['target']},retrospective);
  assert.deepEqual(result.observations.map(o=>o.eventId),['a']);
});
test('same revision with reordered object keys deduplicates; contradictory final knowledge is excluded', () => {
  const a=appearance('a',1);
  const reordered=Object.fromEntries(Object.entries(a).reverse());
  assert.equal(observationsAsOf([a,reordered],'2025-01-03T00:00:00Z',scope,retrospective).observations.length,1);
  const impossible={...a,provenance:{source:'test',knownAt:'2025-01-01T19:00:00Z',fetchedAt:'2025-01-01T19:00:00Z'}};
  assert.equal(observationsAsOf([impossible],'2025-01-03T00:00:00Z',scope,recorded).observations.length,0);
});
test('recorded final with no exact completion time can enter a same-day cutoff once actually observed', () => {
  const a=appearance('a',1,{completedAt:null,provenance:{source:'test',knownAt:'2025-01-01T21:00:00Z',fetchedAt:'2025-01-01T21:00:00Z'}});
  assert.equal(observationsAsOf([a],'2025-01-01T22:00:00Z',scope,recorded).observations.length,1);
  assert.equal(observationsAsOf([a],'2025-01-01T21:00:00Z',scope,recorded).observations.length,0);
});
test('baseline recency ordering and scoring are independently validated across target snapshots', () => {
  const a=appearance('a',1,{stats:{...baseStats,points:10}}),b=appearance('b',2,{stats:{...baseStats,points:20}}),c=appearance('c',3);
  const run=snapshot=>backtestNba({history:[c,a,b],actuals:[c],targets:[target(c,{rulesSnapshot:snapshot})],policy:retrospective,
    candidate:nbaAverageBaseline({kind:'recent',games:2,halfLifeGames:1})});
  assert.ok(Math.abs(run({sport:'nba'}).rows[0].predicted-50/3)<1e-10);
  assert.ok(Math.abs(run({sport:'nba',scoring:{points:2}}).rows[0].predicted-100/3)<1e-10);
});
test('sparse history and postseason inclusion are explicit, with no season-total fallback', () => {
  const a=appearance('a',1),b=appearance('b',2,{phase:'postseason'});
  const result=backtestNba({history:[a,b],actuals:[b],targets:[target(b)],policy:retrospective,
    candidate:nbaAverageBaseline({kind:'season-to-date'})});
  assert.equal(result.metrics.predictions,0); assert.equal(result.skipped[0].reason,'candidate-abstained');
  const dnp={...b,participation:'dnp',minutes:null};
  const available=backtestNba({history:[a],actuals:[dnp],targets:[target(b)],policy:retrospective,
    candidate:({target})=>({projectedFantasyPoints:45,confidence:'low',fallbackReason:'test',components:{},modelVersion:'test',asOf:target.asOf})});
  assert.equal(available.metrics.predictions,0); assert.equal(available.skipped[0].reason,'incomplete-or-mismatched-actual');
});
