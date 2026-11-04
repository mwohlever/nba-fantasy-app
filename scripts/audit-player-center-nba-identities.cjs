/* Read-only: SELECTs + bounded provider GETs; writes a local review JSON only. No SQL. */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('dotenv').config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { reviewNbaIdentityGaps } = require('../lib/player-center/nbaIdentity.ts');
const season = process.argv[2];
if (!/^20\d\d-\d\d$/.test(season ?? '') || Number(season.slice(5)) !== (Number(season.slice(0, 4)) + 1) % 100)
  throw new Error('Usage: node scripts/audit-player-center-nba-identities.cjs 2026-27');
const directory = path.join(process.cwd(), 'data/player-center');
const nativeSource = `https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=${season}`;
const teamsSource = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50';
let requests = 0;
async function json(url) {
  if (++requests > 32) throw new Error('Audit provider request cap exceeded');
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0',
    Origin: 'https://www.nba.com', Referer: 'https://www.nba.com/' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  return response.json();
}
async function pages(db, table, columns) {
  const rows = [];
  for (let offset = 0; offset < 3000; offset += 1000) {
    const { data, error } = await db.from(table).select(columns).order(table === 'players' ? 'id' : 'provider_player_id').range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  throw new Error('Catalog audit row cap reached');
}
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [players, stored, rawNative, rawTeams] = await Promise.all([
    pages(db, 'players', 'id,name,nba_player_id,team_abbreviation,is_active'),
    pages(db, 'nba_player_provider_identities', 'player_id,provider_player_id,resolution_status'), json(nativeSource), json(teamsSource),
  ]);
  const set = rawNative.resultSets?.find(row => row.name === 'CommonAllPlayers');
  if (!set?.headers?.includes('PERSON_ID') || !set.headers.includes('ROSTERSTATUS') || !Array.isArray(set.rowSet)) throw new Error('Invalid native roster');
  const native = set.rowSet.map(row => {
    const field = key => row[set.headers.indexOf(key)];
    return { nbaPlayerId: Number(field('PERSON_ID')), name: String(field('DISPLAY_FIRST_LAST')), team: String(field('TEAM_ABBREVIATION') ?? ''), rostered: Number(field('ROSTERSTATUS')) === 1 };
  });
  const teams = rawTeams.sports?.[0]?.leagues?.[0]?.teams;
  if (!Array.isArray(teams) || teams.length !== 30) throw new Error('Expected 30 ESPN teams');
  const espn = [];
  for (let offset = 0; offset < teams.length; offset += 3) {
    const groups = await Promise.all(teams.slice(offset, offset + 3).map(async ({ team }) => {
      if (!/^\d+$/.test(String(team.id))) throw new Error('Invalid team ID');
      const source = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/roster`;
      const payload = await json(source);
      if (!Array.isArray(payload.athletes) || String(payload.team?.id) !== String(team.id)) throw new Error('Invalid ESPN roster');
      return payload.athletes.map(athlete => ({ espnPlayerId: String(athlete.id), name: athlete.displayName ?? athlete.fullName,
        team: team.abbreviation, source }));
    }));
    espn.push(...groups.flat());
  }
  const rows = reviewNbaIdentityGaps({ players, stored, native, espn, nativeSource });
  const original = JSON.parse(fs.readFileSync('data/analytics/nba-provider-identity-review.json', 'utf8'));
  const missing = rows.filter(row => row.category !== 'already_resolved');
  const categories = list => list.reduce((counts, row) => { counts[row.category] = (counts[row.category] ?? 0) + 1; return counts; }, {});
  const report = { generatedAt: new Date().toISOString(), season, databaseWrites: 0, providerRequests: requests,
    source: { nativeSource, teamsSource, originalReview: 'data/analytics/nba-provider-identity-review.json' },
    summary: { activePlayers: rows.length, storedResolved: rows.length - missing.length, gaps: missing.length,
      originalGapReasons: missing.reduce((counts, row) => { const tier = original.candidates.find(c => c.canonical?.id === row.playerId)?.tier ?? 'not_in_original'; counts[tier] = (counts[tier] ?? 0) + 1; return counts; }, {}),
      currentGapReasons: categories(missing), achievableAfterApproval: rows.filter(row => ['already_resolved', 'corroborated_current_rosters'].includes(row.category)).length },
    gaps: missing };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'nba-identity-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
