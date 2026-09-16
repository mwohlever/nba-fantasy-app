/* eslint-disable @typescript-eslint/no-require-imports */
// Offline tournament. Development locks selection; holdout verifies that lock and cannot select a model.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { backtestNba, nbaAverageBaseline } = require('../lib/analytics/nba/backtest.ts');
const { nbaCandidateTournament, createNbaCandidate, workloadContext } = require('../lib/analytics/nba/candidates.ts');
const { modelingEvidence } = require('../lib/analytics/nba/participation.ts');
const { tournamentMetrics, pairedPlayerComparison } = require('../lib/analytics/nba/tournamentMetrics.ts');
const { targetNbaScoring } = require('../lib/analytics/nba/scoring.ts');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const config = nbaCandidateTournament();
const baselineConfigs = [
  { id:'baseline-season', options:{kind:'season-to-date'} },
  { id:'baseline-recent5', options:{kind:'recent',games:5} },
  { id:'baseline-weighted10h5', options:{kind:'recent',games:10,halfLifeGames:5} },
];
const definitions = [...baselineConfigs.map(c=>({...c,family:'baseline'})),...config.map(c=>({...c,family:'v2'}))];
const write = (file,payload)=>fs.writeFileSync(file,JSON.stringify(payload,null,2)+'\n');

function cohortInfo(context) {
  const eligible=context.history.filter(r=>r.phase===context.target.phase && modelingEvidence(r).rateEligible);
  const current=eligible.filter(r=>r.season===context.target.season);
  const workload=workloadContext(current.length?current:eligible,context.target.asOf);
  const cohorts=[current.length<5?'sparse-0to4':current.length<15?'history-5to14':'history-15plus'];
  if(workload.typical!==null) cohorts.push(workload.typical>=32?'high-minutes':workload.typical>=24?'medium-minutes':'low-minutes');
  if(current.length>=5) cohorts.push(workload.deviation<=3?'stable-workload':'volatile-workload');
  if(workload.lowWorkloadSignal) cohorts.push('after-low-workload');
  if(workload.daysSinceLast>21) cohorts.push('long-gap');
  return {cohorts,workload,currentGames:current.length};
}

function run(dataset, seasons, scoring, definition) {
  const candidate=definition.family==='baseline'?nbaAverageBaseline(definition.options):createNbaCandidate(definition);
  const rows=[], skips=[];
  let targetCount=0;
  for(const player of dataset.plan.players) {
    const history=dataset.observations.filter(r=>r.providerPlayerId===player.espnPlayerId && r.season<=Math.max(...seasons));
    const actuals=history.filter(r=>seasons.includes(r.season));
    const targets=actuals.filter(r=>r.gameAt).map(r=>({id:`${r.providerPlayerId}:${r.eventId}`,provider:r.provider,providerPlayerId:r.providerPlayerId,
      eventId:r.eventId,gameAt:r.gameAt,asOf:r.gameAt,season:r.season,phase:r.phase,rulesSnapshot:{sport:'nba',scoring}}));
    const metadata=new Map();
    const result=backtestNba({history,actuals,targets,policy:{availability:'retrospective',unknownCompletionLagHours:24,phases:['regular']},
      candidate:context=>{metadata.set(context.target.id,cohortInfo(context));return candidate(context);}});
    targetCount+=targets.length;
    const truth=new Map(actuals.map(r=>[`${r.providerPlayerId}:${r.eventId}`,r]));
    for(const row of result.rows) {
      const actual=truth.get(row.targetId);
      rows.push({targetId:row.targetId,playerId:player.espnPlayerId,playerName:player.expectedName,eventId:actual.eventId,gameAt:actual.gameAt,
        predicted:row.predicted,actual:row.actual,expectedMinutes:row.projection.expectedMinutes??null,actualMinutes:actual.minutes,
        projectedStats:row.projection.projectedStats,actualStats:actual.stats,confidence:row.projection.confidence,
        cohorts:metadata.get(row.targetId).cohorts,asOfContext:metadata.get(row.targetId),projection:row.projection});
    }
    skips.push(...result.skipped);
  }
  return {id:definition.id,family:definition.family,definition,targetCount,rows,skips};
}

function summarize(result, common) {
  const comparable=result.rows.filter(r=>common.has(r.targetId));
  const cohorts=[...new Set(comparable.flatMap(r=>r.cohorts))].sort();
  return {id:result.id,family:result.family,definition:result.definition,targetCount:result.targetCount,
    allAvailable:tournamentMetrics(result.rows),common:tournamentMetrics(comparable),
    skipped:result.skips.reduce((m,r)=>(m[r.reason]=(m[r.reason]||0)+1,m),{}),
    cohorts:Object.fromEntries(cohorts.map(c=>[c,tournamentMetrics(comparable.filter(r=>r.cohorts.includes(c)))])),
    confidence:Object.fromEntries(['high','medium','low'].map(c=>[c,tournamentMetrics(comparable.filter(r=>r.confidence===c))])),
    players:Object.fromEntries([...new Set(comparable.map(r=>r.playerId))].map(id=>[id,tournamentMetrics(comparable.filter(r=>r.playerId===id))]))};
}

try {
  if(process.argv.length!==5 || !['development','holdout'].includes(process.argv[2])) throw new Error('Usage: node scripts/run-nba-tournament.cjs development|holdout data/analytics /tmp/result-directory');
  const mode=process.argv[2], dataDir=path.resolve(process.argv[3]), output=path.resolve(process.argv[4]);
  fs.mkdirSync(output,{recursive:true});
  const raw=zlib.gunzipSync(fs.readFileSync(path.join(dataDir,'nba-tournament-dataset.json.gz'))).toString('utf8');
  const dataset=JSON.parse(raw), manifest=JSON.parse(fs.readFileSync(path.join(dataDir,'nba-tournament-manifest.json'),'utf8'));
  if(hash(raw)!==manifest.datasetSha256) throw new Error('Dataset hash mismatch');
  const lockPath=path.join(dataDir,'nba-tournament-selection.json');
  const definitionHash=hash(JSON.stringify(definitions));
  // Record executable hashes: same names/config with edited model code must not reuse an old selection.
  const sourcePaths=['lib/analytics/nba/candidates.ts','lib/analytics/nba/tournamentMetrics.ts','lib/analytics/nba/backtest.ts',
    'lib/analytics/nba/history.ts','lib/analytics/nba/participation.ts','lib/analytics/nba/scoring.ts','lib/analytics/statistics.ts',
    'lib/analytics/nba/types.ts','scripts/run-nba-tournament.cjs'];
  const sourceHashes=Object.fromEntries(sourcePaths.map(p=>[p,hash(fs.readFileSync(path.join(__dirname,'..',p)))]));
  let lock;
  if(mode==='holdout') {
    lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
    if(lock.datasetSha256!==manifest.datasetSha256 || lock.definitionHash!==definitionHash || JSON.stringify(lock.sourceHashes)!==JSON.stringify(sourceHashes)) throw new Error('Holdout requires matching locked dataset, definitions and executable sources');
  }
  const scoring=targetNbaScoring({sport:'nba'});
  const seasons=mode==='development'?dataset.plan.developmentSeasons:dataset.plan.holdoutSeasons;
  const results=[];
  for(const definition of definitions) {
    const result=run(dataset,seasons,scoring,definition);results.push(result);
    console.log(`${mode} ${definition.id}: ${result.rows.length} predictions`);
  }
  const common=new Set(results[0].rows.map(r=>r.targetId));
  for(const result of results) {
    const ids=new Set(result.rows.map(r=>r.targetId));for(const id of common) if(!ids.has(id)) common.delete(id);
  }
  const summaries=results.map(r=>summarize(r,common));
  const ranked=family=>summaries.filter(s=>s.family===family).sort((a,b)=>a.common.macroPlayerMae-b.common.macroPlayerMae || a.id.localeCompare(b.id));
  if(mode==='development') {
    lock={version:dataset.version,datasetSha256:manifest.datasetSha256,definitionHash,sourceHashes,
      criterion:dataset.plan.selection,developmentSeasons:seasons,holdoutSeasons:dataset.plan.holdoutSeasons,
      selectedCandidate:ranked('v2')[0].id,selectedBaseline:ranked('baseline')[0].id,definitions};
    write(lockPath,lock);
  }
  const selected=results.find(r=>r.id===lock.selectedCandidate),baseline=results.find(r=>r.id===lock.selectedBaseline);
  const report={mode,datasetSha256:manifest.datasetSha256,definitionHash,sourceHashes,seasons,scoring,
    commonPredictions:common.size,selection:lock.selectedCandidate,baseline:lock.selectedBaseline,summaries,
    selectedVersusBaseline:pairedPlayerComparison(selected.rows.filter(r=>common.has(r.targetId)),baseline.rows.filter(r=>common.has(r.targetId)))};
  if(mode==='holdout') {
    // Predeclared sensitivity, not a second parameter-selection opportunity.
    const alternateScoring=targetNbaScoring({sport:'nba',scoring:{rebounds:1.5,assists:2,steals:3,blocks:3,turnovers:-2}});
    report.alternateScoring=alternateScoring;report.alternate=[];
    for(const id of [lock.selectedCandidate,lock.selectedBaseline,'nba-v2-median8-recent15-v1']) {
      const result=run(dataset,seasons,alternateScoring,definitions.find(d=>d.id===id));
      report.alternate.push(summarize(result,common));
    }
  }
  write(path.join(output,`${mode}-summary.json`),report);
  fs.writeFileSync(path.join(output,`${mode}-predictions.json.gz`),zlib.gzipSync(JSON.stringify(results)));
  console.log(JSON.stringify({mode,common:common.size,selection:lock.selectedCandidate,baseline:lock.selectedBaseline,
    selected:summaries.find(s=>s.id===lock.selectedCandidate).common,comparison:report.selectedVersusBaseline},null,2));
} catch(error) {console.error(error.stack);process.exitCode=1;}
