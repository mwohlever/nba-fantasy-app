/* eslint-disable @typescript-eslint/no-require-imports */
// Read cached responses; write a compact OFFLINE research dataset. No network or database.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const plan = require('../data/analytics/nba-tournament-plan.json');
const { normalizeEspnNbaGameLog, espnNbaGameLogUrl } = require('../lib/analytics/providers/espnNbaGameLog.ts');
const { modelingEvidence } = require('../lib/analytics/nba/participation.ts');

try {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/prepare-nba-tournament.cjs /tmp/cache-directory output-directory');
  const cache = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
  const observations = [], sources = [];
  for (const player of plan.players) {
    const profile = JSON.parse(fs.readFileSync(path.join(cache, `profile-${player.espnPlayerId}.json`), 'utf8'));
    if (String(profile.payload.id) !== player.espnPlayerId) throw new Error('Profile ID mismatch');
    for (const season of player.seasons) {
      const entry = JSON.parse(fs.readFileSync(path.join(cache, `log-${player.espnPlayerId}-${season}.json`), 'utf8'));
      if (entry.url !== espnNbaGameLogUrl(player.espnPlayerId, season)) throw new Error('Game-log source mismatch');
      const result = normalizeEspnNbaGameLog(entry.payload, { espnPlayerId: player.espnPlayerId, season,
        fetchedAt: entry.fetchedAt, knownAt: null }); // Explicit retrospective reconstruction, NOT historical revision capture.
      const regular = result.observations.filter(row => row.phase === plan.phase);
      observations.push(...regular);
      sources.push({ playerId: player.espnPlayerId, name: profile.payload.displayName, season,
        source: entry.url, fetchedAt: entry.fetchedAt, rawSha256: entry.sha256,
        profileSource: profile.url, profileSha256: profile.sha256,
        totalObservations: result.observations.length, regularObservations: regular.length,
        eligible: regular.filter(row => modelingEvidence(row).rateEligible).length, issues: result.issues });
    }
  }
  observations.sort((a,b) => a.providerPlayerId.localeCompare(b.providerPlayerId) || a.gameAt.localeCompare(b.gameAt) || a.eventId.localeCompare(b.eventId));
  const data = JSON.stringify({ version: plan.version, plan, observations });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'nba-tournament-dataset.json.gz'), zlib.gzipSync(data));
  const manifest = { version: plan.version, timing: 'retrospective-approximation',
    datasetSha256: crypto.createHash('sha256').update(data).digest('hex'), observations: observations.length, sources };
  fs.writeFileSync(path.join(output, 'nba-tournament-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ observations: observations.length, sources: sources.length, issues: sources.filter(s => s.issues.length),
    counts: sources.map(s=>({name:s.name,season:s.season,regular:s.regularObservations,eligible:s.eligible})) }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
