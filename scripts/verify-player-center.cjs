/* eslint-disable @typescript-eslint/no-require-imports */
/* Opt-in live SELECT/GET verification only. No SQL, refresh, ingest, RPCs or mutations. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
if (process.argv[2] !== '--live') {
  console.log('Usage: node scripts/verify-player-center.cjs --live (read-only DB + bounded ESPN GETs)');
  process.exit(0);
}
require('dotenv').config({ path: '.env.local', quiet: true });
const originalResolve = Module._resolveFilename, originalLoad = Module._load;
Module._resolveFilename = function(request, parent, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(process.cwd(), request.slice(2)) : request, parent, ...args);
};
Module._load = function(request, parent, ...args) { return request === 'server-only' ? {} : originalLoad.call(this, request, parent, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { SupabaseCenterRepository } = require('../lib/player-center/repository.server.ts');
const { PlayerCenterService } = require('../lib/player-center/service.ts');
const { professionalSeason } = require('../lib/player-center/types.ts');
async function main() {
  const repository = new SupabaseCenterRepository(), service = new PlayerCenterService(repository);
  const profiles = [], comparisons = [];
  let requests = 0;
  for (const [sport, nativeId, offset] of [['nba', '2544', 0], ['nba', '2544', -1], ['nfl', '3139477', 0], ['nfl', '3055899', 0], ['nfl', '100000012', 0]]) {
    const catalog = await repository.catalog(sport), player = catalog.players.find(row => row.nativePlayerId === nativeId);
    if (!player) throw new Error(`Missing verification identity: ${sport}:${nativeId}`);
    const season = professionalSeason(sport) + offset;
    const result = await service.profile({ sport, playerId: player.playerId, season, phase: 'regular', scoring: { sport, settings: null, basis: 'legacy_defaults' } });
    requests += result.providerRequests;
    profiles.push({ sport, nativeId, providerPlayerId: player.providerPlayerId, position: player.position, season,
      games: result.games.length, finalGames: result.games.filter(g => g.status === 'final').length,
      scoredGames: Object.values(result.gameFantasyPoints).filter(value => value !== null).length,
      providerRequests: result.providerRequests, coverage: result.coverage, byeWeeks: result.byeWeeks,
      unscoredEvents: result.games.filter(game => game.status === 'final' && result.gameFantasyPoints[game.eventId] === null).map(game => ({ eventId: game.eventId,
        missingFields: Object.entries(game.stats).filter(([, value]) => value === null).map(([key]) => key) })),
      windows: Object.fromEntries(Object.entries(result.windows).map(([key, value]) => [key, { sampleSize: value.sampleSize, comparable: value.comparable,
        fantasyComparable: value.metricComparable.fantasy_points, missingFantasySamples: value.missingMetricSamples.fantasy_points, fantasyAverage: value.averages.fantasy_points ?? null }])) });
    console.log(JSON.stringify(profiles.at(-1)));
  }
  for (const sport of ['nba', 'nfl']) {
    const result = await service.comparisons({ sport, season: professionalSeason(sport), window: 'last5', metric: 'fantasy_points', ascending: false, scoring: { sport, settings: null, basis: 'legacy_defaults' } });
    comparisons.push({ sport, season: result.season, source: result.source, readAt: result.readAt, providerRequests: result.providerRequests, coverage: result.coverage });
    console.log(JSON.stringify(comparisons.at(-1)));
  }
  const report = { verifiedAt: new Date().toISOString(), databaseWrites: 0, providerRequests: requests, profiles, comparisons };
  fs.mkdirSync('data/player-center', { recursive: true });
  fs.writeFileSync('data/player-center/coverage-verification.json', JSON.stringify(report, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
