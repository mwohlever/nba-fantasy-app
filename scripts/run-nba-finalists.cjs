/* eslint-disable @typescript-eslint/no-require-imports */
// Fixed, complexity-aware NBA finalist evaluation. It neither fetches nor writes
// provider/database data; its sole output is a durable local research artifact.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { backtestNba, nbaAverageBaseline } = require('../lib/analytics/nba/backtest.ts');
const { createNbaCandidate, workloadContext } = require('../lib/analytics/nba/candidates.ts');
const { modelingEvidence } = require('../lib/analytics/nba/participation.ts');
const { targetNbaScoring } = require('../lib/analytics/nba/scoring.ts');
const { tournamentMetrics, pairedPlayerComparison } = require('../lib/analytics/nba/tournamentMetrics.ts');

const FINALISTS = [
  { id: 'baseline-weighted10h5', complexity: 'LOW', kind: 'baseline', options: { kind: 'recent', games: 10, halfLifeGames: 5 } },
  { id: 'nba-v2-blend8h3s0.8-recent15-v1', complexity: 'LOW', kind: 'candidate', minutes: { kind: 'blend', window: 8, halfLife: 3, recentShare: .8 }, rates: { kind: 'recent', window: 15 }, priorFallback: true },
  { id: 'nba-v2-robust50i25-recent15-v1', complexity: 'LOW', kind: 'candidate', minutes: { kind: 'robust', window: 8, halfLife: 3, lowRatio: .5, lowInfluence: .25 }, rates: { kind: 'recent', window: 15 }, priorFallback: true },
  { id: 'nba-v2-adaptive50i25-recent15-v1', complexity: 'MEDIUM', kind: 'candidate', minutes: { kind: 'robust', window: 8, halfLife: 3, lowRatio: .5, lowInfluence: .25, adapt: true }, rates: { kind: 'recent', window: 15 }, priorFallback: true },
];

function candidate(definition) {
  return definition.kind === 'baseline' ? nbaAverageBaseline(definition.options) : createNbaCandidate(definition);
}
function cohorts(context) {
  const eligible = context.history.filter(row => row.phase === 'regular' && modelingEvidence(row).rateEligible);
  const current = eligible.filter(row => row.season === context.target.season);
  const workload = workloadContext(current.length ? current : eligible, context.target.asOf);
  const result = [current.length < 5 ? 'sparse-history' : 'established-history'];
  if (workload.typical !== null) result.push(workload.typical >= 32 ? 'high-minutes' : workload.typical < 24 ? 'lower-minutes' : 'middle-minutes');
  if (current.length >= 5) result.push(workload.deviation <= 3 ? 'stable-workload' : 'volatile-workload');
  if (workload.lowWorkloadSignal) result.push('after-short-appearance');
  return result;
}
function runSplit(dataset, seasons, definition) {
  const model = candidate(definition), scoring = targetNbaScoring({ sport: 'nba' }), rows = [], skips = [];
  for (const player of dataset.plan.players) {
    const history = dataset.observations.filter(row => row.providerPlayerId === player.espnPlayerId && row.season <= Math.max(...seasons));
    const actuals = history.filter(row => seasons.includes(row.season));
    // Deterministic every-fifth-game targets keep the fixed four-model review
    // inexpensive while preserving chronological coverage across every player.
    const targets = actuals.filter((row, index) => row.gameAt && index % 5 === 0).map(row => ({ id: `${row.providerPlayerId}:${row.eventId}`, provider: row.provider,
      providerPlayerId: row.providerPlayerId, eventId: row.eventId, gameAt: row.gameAt, asOf: row.gameAt, season: row.season,
      phase: row.phase, rulesSnapshot: { sport: 'nba', scoring } }));
    const metadata = new Map();
    const result = backtestNba({ history, actuals, targets, policy: { availability: 'retrospective', unknownCompletionLagHours: 24, phases: ['regular'] },
      candidate: context => { metadata.set(context.target.id, cohorts(context)); return model(context); } });
    const truth = new Map(actuals.map(row => [`${row.providerPlayerId}:${row.eventId}`, row]));
    for (const row of result.rows) {
      const actual = truth.get(row.targetId);
      rows.push({ targetId: row.targetId, playerId: player.espnPlayerId, predicted: row.predicted, actual: row.actual,
        expectedMinutes: row.projection.expectedMinutes ?? null, actualMinutes: actual.minutes, projectedStats: row.projection.projectedStats,
        actualStats: actual.stats, confidence: row.projection.confidence, cohorts: metadata.get(row.targetId) });
    }
    skips.push(...result.skipped);
  }
  return { id: definition.id, complexity: definition.complexity, rows, skips };
}
function summarize(result, common) {
  const rows = result.rows.filter(row => common.has(row.targetId));
  const labels = [...new Set(rows.flatMap(row => row.cohorts))].sort();
  return { id: result.id, complexity: result.complexity, metrics: tournamentMetrics(rows),
    cohorts: Object.fromEntries(labels.map(label => [label, tournamentMetrics(rows.filter(row => row.cohorts.includes(label)))])),
    confidence: Object.fromEntries(['high', 'medium', 'low'].map(level => [level, tournamentMetrics(rows.filter(row => row.confidence === level))])),
    skips: result.skips.reduce((counts, row) => (counts[row.reason] = (counts[row.reason] ?? 0) + 1, counts), {}) };
}
if (process.argv.length < 4 || process.argv.length > 6) throw new Error('Usage: node scripts/run-nba-finalists.cjs data-directory output.json [development|holdout] [model-id]');
const dataDir = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const requestedSplit = process.argv[4] ?? null;
const requestedModel = process.argv[5] ?? null;
if (requestedSplit !== null && requestedSplit !== 'development' && requestedSplit !== 'holdout') throw new Error('Split must be development or holdout');
if (requestedModel !== null && !FINALISTS.some(finalist => finalist.id === requestedModel)) throw new Error('Unknown finalist model');
const dataset = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dataDir, 'nba-tournament-dataset.json.gz'))));
const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'nba-tournament-manifest.json'), 'utf8'));
const splits = {};
for (const [name, seasons] of [['development', dataset.plan.developmentSeasons], ['holdout', dataset.plan.holdoutSeasons]]) {
  if (requestedSplit !== null && requestedSplit !== name) continue;
  const definitions = requestedModel === null ? FINALISTS : FINALISTS.filter(definition => definition.id === requestedModel);
  const results = definitions.map(definition => runSplit(dataset, seasons, definition));
  const common = new Set(results[0].rows.map(row => row.targetId));
  for (const result of results) for (const id of common) if (!result.rows.some(row => row.targetId === id)) common.delete(id);
  splits[name] = { seasons, commonPredictions: common.size, finalists: results.map(result => summarize(result, common)) };
  if (name === 'holdout' && results.length === FINALISTS.length) {
    const baseline = results[0], comparisons = {};
    for (const result of results.slice(1)) comparisons[result.id] = pairedPlayerComparison(result.rows.filter(row => common.has(row.targetId)), baseline.rows.filter(row => common.has(row.targetId)));
    splits[name].versusBaseline = comparisons;
  }
}
fs.writeFileSync(output, JSON.stringify({ version: 'nba-finalist-evaluation-v1', timing: manifest.timing, datasetSha256: manifest.datasetSha256,
  cohort: { players: dataset.plan.players.length, observations: dataset.observations.length, warmupSeasons: dataset.plan.warmupSeasons },
  selectionRule: 'Fixed finalists only. A LOW-complexity model wins when its development macro-player MAE is within 3% of the best finalist and it passes workload behavior tests; holdout is reporting only.', finalists: FINALISTS, splits }, null, 2) + '\n');
console.log(JSON.stringify({ output, cohort: dataset.plan.players.length,
  development: splits.development?.commonPredictions ?? null, holdout: splits.holdout?.commonPredictions ?? null }, null, 2));
