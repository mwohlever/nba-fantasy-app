/* eslint-disable @typescript-eslint/no-require-imports */
// Reproducible research report from saved outputs; no fitting, fetching or production writes.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const fmt=(n,d=3)=>typeof n==='number'?n.toFixed(d):'—';
const load=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const unzip=file=>JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
const median=values=>{const v=[...values].sort((a,b)=>a-b),i=Math.floor(v.length/2);return v.length%2?v[i]:(v[i-1]+v[i])/2;};
const table=(headers,rows)=>[ '| '+headers.join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |',
  ...rows.map(row=>'| '+row.join(' | ')+' |')].join('\n');

function main(){
  if(process.argv.length!==5)throw new Error('Usage: node scripts/report-nba-tournament.cjs data/analytics /tmp/result-directory docs/report.md');
  const dir=path.resolve(process.argv[2]),resultsDir=path.resolve(process.argv[3]);
  const data=unzip(path.join(dir,'nba-tournament-dataset.json.gz'));
  const manifest=load(path.join(dir,'nba-tournament-manifest.json'));
  const dev=load(path.join(resultsDir,'development-summary.json')),hold=load(path.join(resultsDir,'holdout-summary.json'));
  if(dev.datasetSha256!==hold.datasetSha256 || dev.definitionHash!==hold.definitionHash)throw new Error('Mixed tournament outputs');
  const predictions=[...unzip(path.join(resultsDir,'development-predictions.json.gz')),
    ...unzip(path.join(resultsDir,'holdout-predictions.json.gz'))];
  const rowsByModel=new Map();
  for(const result of predictions)rowsByModel.set(result.id,[...(rowsByModel.get(result.id)||[]),...result.rows]);
  const selected=hold.summaries.find(s=>s.id===hold.selection),baseline=hold.summaries.find(s=>s.id===hold.baseline);
  const shortId=id=>id.replace(/^nba-v2-/,'').replace(/-v1$/,'');
  const comparators=[...new Set([hold.selection,'nba-v2-median8-recent15-v1','nba-v2-mean10h3-recent15-v1',
    'nba-v2-robust50i25-recent15-v1','nba-v2-adaptive50i25-recent15-v1'])];
  const predictionAt=(model,player,event)=>(rowsByModel.get(model)||[]).find(r=>r.playerId===player&&r.eventId===event);
  const cases=[];
  for(const player of data.plan.players)for(const season of [2024,2025]){
    const history=data.observations.filter(o=>o.providerPlayerId===player.espnPlayerId&&o.season===season&&o.participation==='played'&&o.minutes>0)
      .sort((a,b)=>a.gameAt.localeCompare(b.gameAt));
    for(let i=5;i<history.length-1;i++){
      const before=history.slice(i-5,i),short=history[i],next=history[i+1],typical=median(before.map(o=>o.minutes));
      const mad=median(before.map(o=>Math.abs(o.minutes-typical)));
      if(typical<20||mad>3||short.minutes>=.35*typical||short.stats.points<=0||next.minutes<.8*typical
        ||Date.parse(next.gameAt)-Date.parse(short.gameAt)<86400000)continue;
      const responses=comparators.map(model=>({model,before:predictionAt(model,player.espnPlayerId,short.eventId),after:predictionAt(model,player.espnPlayerId,next.eventId)}));
      if(responses.some(r=>!r.before||!r.after||r.after.projection.components.lastMinutes!==short.minutes))continue;
      cases.push({player:player.expectedName,playerId:player.espnPlayerId,season,typical,mad,shortDate:short.gameAt,shortEvent:short.eventId,
        shortMinutes:short.minutes,nextDate:next.gameAt,nextEvent:next.eventId,nextMinutes:next.minutes,
        responses:responses.map(r=>({model:r.model,before:r.before.expectedMinutes,after:r.after.expectedMinutes,projected:r.after.predicted}))});
    }
  }
  cases.sort((a,b)=>a.shortMinutes/a.typical-b.shortMinutes/b.typical||a.shortDate.localeCompare(b.shortDate));
  const chosenCases=[];
  for(const c of cases)if(!chosenCases.some(x=>x.playerId===c.playerId)&&chosenCases.length<4)chosenCases.push(c);
  const adaptiveRows=rowsByModel.get('nba-v2-adaptive50i25-recent15-v1');
  const changes=[];
  for(const row of adaptiveRows){
    if(row.projection.components.workloadChange==='none')continue;
    const targetSeason=data.observations.find(o=>o.providerPlayerId===row.playerId&&o.eventId===row.eventId).season;
    const history=data.observations.filter(o=>o.providerPlayerId===row.playerId&&o.season===targetSeason
      &&o.participation==='played'&&o.minutes>0&&Date.parse(o.gameAt)<=Date.parse(row.gameAt)-86400000).sort((a,b)=>a.gameAt.localeCompare(b.gameAt));
    const last=history.slice(-3),before=history.slice(-11,-3);
    if(last.length<3||before.length<3)continue;
    const typical=median(before.map(o=>o.minutes));
    const direction=row.projection.components.workloadChange;
    if(direction==='sustained-lower-workload'&&row.actualMinutes>=typical*.75)continue;
    if(direction==='sustained-higher-workload'&&row.actualMinutes<=typical*1.25)continue;
    changes.push({player:row.playerName,playerId:row.playerId,date:row.gameAt,eventId:row.eventId,direction,previousTypical:typical,
      lastThree:last.map(o=>o.minutes),actual:row.actualMinutes,responses:comparators.map(model=>({model,
        predicted:predictionAt(model,row.playerId,row.eventId)?.expectedMinutes??null}))});
  }
  changes.sort((a,b)=>a.date.localeCompare(b.date));
  const chosenChanges=[];
  for(const c of changes)if(!chosenChanges.some(x=>x.playerId===c.playerId&&x.direction===c.direction)&&chosenChanges.length<4)chosenChanges.push(c);
  const explanations=[];
  const selectedRows=rowsByModel.get(hold.selection).filter(r=>Number(r.gameAt.slice(0,4))>=2024);
  for(const player of ['1966','2530530','4066354','4600663']){
    const row=selectedRows.find(r=>r.playerId===player&&r.gameAt>='2025-01-01'&&r.projection.components.currentSeasonGames>=15);
    if(row)explanations.push(row);
  }
  const result={development:dev,holdout:hold,isolatedLowWorkloadCases:chosenCases,isolatedCasesFound:cases.length,
    sustainedWorkloadCases:chosenChanges,sustainedCasesFound:changes.length,explanations};
  fs.writeFileSync(path.join(dir,'nba-tournament-results.json.gz'),zlib.gzipSync(JSON.stringify(result)));
  const csv=[['candidate','dev_n','dev_macro_mae','dev_mae','dev_rmse','dev_bias','holdout_n','holdout_macro_mae','holdout_mae','holdout_rmse','holdout_bias','holdout_median_ae','holdout_correlation','holdout_rank_correlation','holdout_within_player_correlation']];
  for(const s of hold.summaries){const d=dev.summaries.find(x=>x.id===s.id).common,h=s.common;
    csv.push([s.id,d.predictions,d.macroPlayerMae,d.mae,d.rmse,d.bias,h.predictions,h.macroPlayerMae,h.mae,h.rmse,h.bias,h.medianAbsoluteError,h.correlation,h.rankCorrelation,h.withinPlayerCorrelation]);}
  fs.writeFileSync(path.join(dir,'nba-tournament-results.csv'),csv.map(r=>r.join(',')).join('\n')+'\n');

  const sections=[];
  sections.push('# NBA V2 candidate tournament — offline research report',
    'No production activation, SQL, database writes, commits or pushes. All existing projection surfaces and foundation files remain unchanged.',
    '## 1. Dataset and predeclared split',
    `Dataset SHA-256: \`${manifest.datasetSha256}\`. ${data.observations.length} regular-season observations; 2023 is warmup, 2024 development, 2025 chronological holdout (season END years).`,
    table(['Player (ESPN ID)','Selection reason','2023','2024','2025'],data.plan.players.map(p=>[`${p.expectedName} (${p.espnPlayerId})`,p.samplingReason,...[2023,2024,2025].map(y=>manifest.sources.find(s=>s.playerId===p.espnPlayerId&&s.season===y)?.regularObservations??'—')])),
    'This purposive sample covers different roles but is not a random NBA population. It includes established-player survivorship, only one 2025 rookie, no explicit injury diagnoses, and repeated players across years. Historical revisions were downloaded retrospectively; original correction timing cannot be recovered. Two Mikal Bridges appearances have rounded zero minutes and remain in truth with unknown participation but cannot be scored by this conditional-on-play harness. One empty 2023 Pritchard postseason category is reported and does not affect regular-season evidence.',
    '## 2. Exact expected-minutes candidates',
    'All minute inputs are final played appearances with positive minutes. Windows include short games; “representative” does not mean deleting games below a fixed minute threshold. Age weights are 2^(-appearanceAge/halfLife).',
    '- Median of last 5, 8 or 10 appearances.\n- Weighted mean: 5/half-life 2, 10/half-life 3, 10/half-life 5.\n- Weighted median: 8/half-life 3.\n- Blend: weighted mean of last 8 (half-life 3), with recent share 0.5 or 0.8 and remaining share on current-season mean minutes.\n- Robust: weighted mean of last 8 (half-life 3); appearances below 0.35 or 0.50 of their preceding-five median get minute-estimation influence 0.10 or 0.25 respectively. At least three preceding observations required.\n- Adaptive robust: the 0.50/0.25 variant, but after three consecutive appearances all below 0.65 or above 1.35 of the earlier-eight median (at least three available), use the last-three weighted mean (half-life 2). No cause is inferred.',
    '## 3. Production-rate candidates',
    'Each of points, rebounds, assists, steals, blocks and turnovers is estimated independently as sum(weight × stat)/sum(weight × minutes). The workload downweight is never applied to production-rate evidence.',
    '- Current-season ratio of totals.\n- Last 5, 10, 15 or 20 appearances.\n- Weighted last 15/half-life 3 or 5; last 20/half-life 10.\n- Last-10/season-rate blends with recent shares 0.5 and 0.8. These are explicitly overlapping blends, not independent priors.',
    '## 4. Shrinkage and fallback',
    'Light/moderate shrinkage adds 100/300 pseudo-minutes from disjoint older current-season games; if unavailable, use the previous season within 370 days. Steals/blocks use twice the pseudo-minutes. Pseudo-minutes are capped at the actual available prior minutes. Formula: (weighted support minutes × recent rate + pseudo-minutes × prior rate)/(support + pseudo-minutes). No available prior means no shrinkage.',
    'Current-season observations are used first. With none, a player’s previous-season history may supply a low-confidence fallback only if its latest game is within 240 days. Otherwise abstain. A separate sparse-workload variant blends the first 1–4 current games with the prior-season last-eight median using current share n/(n+3). A current-only control disables prior-season-only predictions. Missing and DNP rows never become zero production.',
    '## 5. Complete candidate definitions',
    '27 V2 configurations plus three baselines form a fixed, one-component-at-a-time search, not a large Cartesian grid. Minute variants use recent-15 rates; rate variants use median-8 minutes; four shrinkage variants pair median/adaptive minutes with light/moderate priors; sparse-minute and current-only controls complete the search. Exact executable definitions and hashes are in `data/analytics/nba-tournament-selection.json` and `lib/analytics/nba/candidates.ts`.',
    '## 6–7. Overall results and baseline comparison',
    `Common-support prediction counts: development ${dev.commonPredictions}; holdout ${hold.commonPredictions}. Each row below is scored on the same targets within its split. Full all-available counts, skips, median error, correlations, stat errors, confidence and cohort metrics for every candidate are in the compressed results artifact; the CSV contains the primary full leaderboard.`,
    table(['Candidate','Dev macro MAE','Dev MAE','Hold MAE','Hold RMSE','Hold bias','Hold macro MAE'],hold.summaries.map(s=>{const d=dev.summaries.find(x=>x.id===s.id);return[shortId(s.id),fmt(d.common.macroPlayerMae),fmt(d.common.mae),fmt(s.common.mae),fmt(s.common.rmse),fmt(s.common.bias),fmt(s.common.macroPlayerMae)];})),
    `Development-selected V2: **${hold.selection}**. Development-selected baseline: **${hold.baseline}**. Selection criterion is mean per-player MAE, giving each sampled player equal weight. Neither selection was changed after holdout inspection.`,
    `Paired holdout macro-MAE delta (V2 minus baseline): ${fmt(hold.selectedVersusBaseline.macroMaeDelta)} FP. Descriptive 95% player-block bootstrap interval: ${hold.selectedVersusBaseline.playerBlockBootstrap95.map(n=>fmt(n)).join(' to ')}. Resampling uses 2,000 deterministic player blocks (seed 111), not independently shuffled games. A small purposive player sample limits inference.`,
    '## 8. Pregame cohort results',
    'Cohorts use only as-of history: high minutes ≥32, medium 24–<32, low <24 (last-eight median); stable MAD ≤3 versus volatile >3 with at least five current games; sparse 0–4, intermediate 5–14, established ≥15 current games; after-low-workload means latest minutes <50% of preceding-eight median with at least three observations. Long gap >21 days. These are workload cohorts, not verified starter labels.',
    table(['Cohort','N','Selected MAE','Baseline MAE','Selected bias','Selected minutes MAE'],Object.entries(selected.cohorts).map(([name,m])=>[name,m.predictions,fmt(m.mae),fmt(baseline.cohorts[name]?.mae),fmt(m.bias),fmt(m.minutes.mae)])),
    '## 9. Actual isolated low-workload case studies',
    `Found ${cases.length} descriptive cases: prior-five median ≥20 and MAD ≤3, positive points in an appearance below 35% of that workload, then a return to ≥80% of normal minutes. Next tipoff must be at least 24 hours later and every reported model must actually have the short game in its as-of history. Selecting examples using subsequent outcomes is retrospective illustration only; no such look-ahead enters predictions or prospective cohorts.`,
    ...chosenCases.map(c=>`### ${c.player}: ${c.shortDate.slice(0,10)} → ${c.nextDate.slice(0,10)}\n\nPrior typical ${c.typical} minutes; short appearance ${c.shortMinutes}; actual next appearance ${c.nextMinutes}. Events ${c.shortEvent} → ${c.nextEvent}. Cause unknown.\n\n`+
      table(['Model','Prediction before short game','Next-game predicted minutes','Next actual minutes'],c.responses.map(r=>[shortId(r.model),fmt(r.before,2),fmt(r.after,2),c.nextMinutes]))),
    '## 10. Sustained workload changes',
    'Examples require the adaptive model to detect repeated changes using prior history, followed by a target workload continuing in that direction. This confirms observed persistence, not a verified coach/depth-chart change.',
    ...chosenChanges.map(c=>`### ${c.player}: ${c.date.slice(0,10)} (${c.direction})\n\nEarlier typical: ${c.previousTypical}; last three available: ${c.lastThree.join(', ')}; actual next: ${c.actual}.\n\n`+
      table(['Model','Predicted minutes','Actual'],c.responses.map(r=>[shortId(r.model),fmt(r.predicted,2),c.actual]))),
    '## 11. Confidence',
    'Low: fewer than five current games, effective sample <3, no freshness evidence, gap >21 days, adaptive workload change, low-workload signal, or fallback. High: ≥15 current games, minimum(minutes ESS, production ESS) ≥8, gap ≤7 days and minute MAD ≤3. Otherwise medium. Confidence never scales the forecast. These criteria were fixed before evaluation and are preliminary; compare error empirically below.',
    table(['Confidence','N','MAE','RMSE','Bias','Minutes MAE'],Object.entries(selected.confidence).map(([c,m])=>[c,m.predictions,fmt(m.mae),fmt(m.rmse),fmt(m.bias),fmt(m.minutes.mae)])),
    '## 12–13. Selected candidate and holdout protection',
    'The selected model is the best V2 on the development criterion, not necessarily the best-looking model in the holdout table. The holdout is the following season; it also adds rookie Zach Edey. Executable source hashes, candidate definitions and dataset hash are locked before holdout execution. Changes require a new development run/version; this report contains no holdout-driven parameter retuning.',
    `Selected holdout median absolute error ${fmt(selected.common.medianAbsoluteError)}, pooled Pearson ${fmt(selected.common.correlation)}, rank correlation ${fmt(selected.common.rankCorrelation)}, within-player centered Pearson ${fmt(selected.common.withinPlayerCorrelation)}. Pooled correlation can reflect between-player quality rather than useful game-to-game context.`,
    'Alternate target scoring retains default points but uses rebounds 1.5, assists 2, steals/blocks 3, turnovers -2. Only the predeclared selected candidate, selected baseline and median-8/recent-15 reference are checked; no alternate-scoring parameter search was performed.',
    table(['Alternate-scoring model','N','MAE','RMSE','Bias'],hold.alternate.map(s=>[shortId(s.id),s.common.predictions,fmt(s.common.mae),fmt(s.common.rmse),fmt(s.common.bias)])),
    '## 14. Explainability examples',
    ...explanations.map(r=>`### ${r.playerName}, ${r.gameAt.slice(0,10)}\n\nProjected ${fmt(r.predicted,2)} FP; expected minutes ${fmt(r.expectedMinutes,2)}; recent typical ${r.projection.components.typicalMinutes}; last workload ${r.projection.components.lastMinutes}; confidence ${r.confidence}. Minutes sample ${r.projection.components.minutesSample}; production sample ${r.projection.components.productionSample}; rate prior ${r.projection.components.ratePrior}.\n\n`+
      table(['Stat','Per-minute rate','Projected stat'],Object.entries(r.projection.statRatesPerMinute).map(([k,v])=>[k,fmt(v,4),fmt(r.projectedStats[k],2)]))),
    '## 15–17. Identity, reuse and next step',
    'Every selected ESPN ID was verified by a separate ESPN profile response. Names are display labels/explicit-ID sanity checks, never joins to the local NBA catalog. Canonical app identity remains unresolved and does not affect provider-scoped evaluation. Production shadow deployment still needs a verified ESPN/NBA/local crosswalk and revision persistence.',
    'Shared reusable pieces: existing weighted statistics, recency and effective sample size; new descriptive metrics, paired player-block comparisons, model/config hashing, chronological holdout workflow, shrinkage concepts and explainability. NBA minute logic and six basketball rates remain NBA-specific. NFL should later use attempts/carries/targets and role evidence; Golf should use holes/rounds, field-relative scoring and birdie/eagle evidence. No NFL/Golf model was added.',
    'Recommended next work must consider the measured margin and cohort weaknesses rather than assuming complexity wins. A production-quality decision also needs wider player coverage, availability/role information, verified identity and prospective snapshot collection. No model in this report is authorized for activation.',
    '## 18–20. Files, validation and checkout status',
    'This batch adds candidate/metric modules, separate offline fetch/prepare/run/report scripts, dataset/plan/manifest/selection/results artifacts, focused model tests and this report. The completed NBA foundation and all Golf work are preserved. See the final session report for exact validation and git status; no SQL or production writes occur.',
    '## 21. Interpretation limits',
    'Predictions are conditional on an actual played appearance, not on whether the player will play. Unexpected short target games remain in evaluation. The 24-hour quarantine can omit a back-to-back result; it is a documented timing approximation, not archived information-time truth. Retrospective provider corrections, missing starter/injury data and the sampled-player distribution limit conclusions.');
  fs.writeFileSync(process.argv[4],sections.join('\n\n')+'\n');
  console.log(JSON.stringify({report:process.argv[4],isolatedCases:cases.length,chosenCases:chosenCases.map(c=>({player:c.player,date:c.shortDate})),
    workloadChanges:changes.length,chosenChanges:chosenChanges.map(c=>({player:c.player,date:c.date,direction:c.direction})),selection:hold.selection},null,2));
}
try{main();}catch(error){console.error(error.stack);process.exitCode=1;}
