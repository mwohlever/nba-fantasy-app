/*
 * Read-only NBA ESPN identity preparation.
 *
 * Reads the live canonical player catalog and existing identity rows, fetches
 * ESPN's public NBA team rosters, and writes review artifacts only. It never
 * inserts, updates, or deletes database rows; the generated SQL is for manual
 * review in the Supabase SQL Editor.
 */
require('dotenv').config({ path: '.env.local' });

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const outputDirectory = path.join(process.cwd(), 'data', 'analytics');
const jsonPath = path.join(outputDirectory, 'nba-provider-identity-review.json');
const markdownPath = path.join(outputDirectory, 'nba-provider-identity-review.md');
const sqlPath = path.join(outputDirectory, 'nba-provider-identity-tier1.sql');
const teamsUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50';
const teamAliases = new Map([['GS', 'GSW'], ['NO', 'NOP'], ['NY', 'NYK'], ['SA', 'SAS'], ['UTAH', 'UTA'], ['WSH', 'WAS']]);

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeTeam(value) {
  const team = String(value ?? '').trim().toUpperCase();
  return teamAliases.get(team) ?? team;
}

function groupBy(items, key) {
  const output = new Map();
  for (const item of items) {
    const group = output.get(key(item)) ?? [];
    group.push(item);
    output.set(key(item), group);
  }
  return output;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ESPN HTTP ${response.status}: ${url}`);
  return response.json();
}

async function fetchEspnRoster() {
  const teamsPayload = await fetchJson(teamsUrl);
  const teams = teamsPayload.sports?.[0]?.leagues?.[0]?.teams ?? [];
  if (!Array.isArray(teams) || teams.length !== 30) throw new Error('ESPN did not return 30 NBA teams');
  const rosters = await Promise.all(teams.map(async ({ team }) => {
    const teamId = String(team?.id ?? '');
    const payload = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`);
    if (!Array.isArray(payload.athletes)) throw new Error(`ESPN roster missing athletes for team ${teamId}`);
    return payload.athletes.map(athlete => ({
      espnPlayerId: String(athlete.id ?? ''),
      name: String(athlete.displayName ?? athlete.fullName ?? ''),
      team: normalizeTeam(team?.abbreviation),
      source: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`,
    })).filter(athlete => /^\d+$/.test(athlete.espnPlayerId) && athlete.name);
  }));
  const athletes = rosters.flat();
  const duplicateIds = [...groupBy(athletes, athlete => athlete.espnPlayerId).entries()].filter(([, rows]) => rows.length !== 1);
  if (duplicateIds.length) throw new Error(`ESPN roster returned duplicate athlete IDs: ${duplicateIds.map(([id]) => id).join(', ')}`);
  return athletes.sort((left, right) => left.name.localeCompare(right.name));
}

function loadCohort() {
  const plan = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'nba-tournament-plan.json'), 'utf8'));
  return new Map((plan.players ?? []).map(player => [String(player.espnPlayerId), String(player.expectedName)]));
}

function markdown(report) {
  const lines = [
    '# NBA ESPN identity review',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Canonical active NBA players: ${report.summary.canonicalPlayers}`,
    `Current ESPN roster athletes: ${report.summary.espnRosterAthletes}`,
    `Tier 1 — deterministic exact name + current-team match: ${report.summary.tier1}`,
    `Tier 2 — exact name but team mismatch (manual review): ${report.summary.tier2}`,
    `Tier 3 — ambiguous/conflicting: ${report.summary.tier3}`,
    `Tier 4 — no ESPN candidate: ${report.summary.tier4}`,
    `Already mapped/blocked: ${report.summary.alreadyMappedOrBlocked}`,
    `35-player analytics cohort matches: ${report.summary.cohortMatches}`,
    '',
    'Tier 1 SQL is generated for review only. It uses `ON CONFLICT DO NOTHING` and must be manually reviewed before execution.',
    '',
    '## Manual review',
    '',
    ...report.candidates.filter(candidate => candidate.tier !== 'tier1').map(candidate =>
      `- ${candidate.tier}: ${candidate.canonical?.name ?? '—'} (${candidate.canonical?.team ?? '—'}) ← ${candidate.espn?.name ?? '—'} (${candidate.espn?.team ?? '—'}): ${candidate.reason}`),
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const database = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const [playersResult, identitiesResult, espnAthletes] = await Promise.all([
    database.from('players').select('id,name,nba_player_id,team_abbreviation,position_group,is_active').eq('is_active', true).not('nba_player_id', 'is', null).order('name'),
    database.from('nba_player_provider_identities').select('provider,provider_player_id,player_id,resolution_status').eq('provider', 'espn'),
    fetchEspnRoster(),
  ]);
  if (playersResult.error) throw new Error(`Canonical player read failed: ${playersResult.error.message}`);
  if (identitiesResult.error) throw new Error(`Existing identity read failed: ${identitiesResult.error.message}`);

  const players = playersResult.data ?? [];
  const existingByEspnId = new Map((identitiesResult.data ?? []).map(row => [String(row.provider_player_id), row]));
  const resolvedEspnByPlayerId = new Map((identitiesResult.data ?? [])
    .filter(row => row.resolution_status === 'resolved' && row.player_id !== null)
    .map(row => [Number(row.player_id), String(row.provider_player_id)]));
  const playersByName = groupBy(players, player => normalizeName(player.name));
  const cohort = loadCohort();
  const candidates = [];
  const classifiedPlayerIds = new Set();
  const seenEspnIds = new Set();

  for (const athlete of espnAthletes) {
    seenEspnIds.add(athlete.espnPlayerId);
    const canonicalCandidates = playersByName.get(normalizeName(athlete.name)) ?? [];
    const existing = existingByEspnId.get(athlete.espnPlayerId);
    const canonical = canonicalCandidates.length === 1 ? canonicalCandidates[0] : null;
    const cohortExpectedName = cohort.get(athlete.espnPlayerId) ?? null;
    const cohortVerified = cohortExpectedName !== null && normalizeName(cohortExpectedName) === normalizeName(athlete.name);
    const base = { espn: athlete, canonical: canonical ? { id: canonical.id, name: canonical.name, nbaPlayerId: canonical.nba_player_id, team: normalizeTeam(canonical.team_abbreviation), position: canonical.position_group } : null,
      cohortExpectedName };
    if (existing) {
      if (canonical) classifiedPlayerIds.add(Number(canonical.id));
      candidates.push({ ...base, tier: 'already_mapped', reason: `ESPN ID already has ${existing.resolution_status} identity row` });
    } else if (canonicalCandidates.length !== 1) {
      candidates.push({ ...base, tier: canonicalCandidates.length ? 'tier3' : 'provider_only', reason: canonicalCandidates.length ? 'Multiple canonical players share this normalized name' : 'No active canonical player has this normalized name' });
    } else if (resolvedEspnByPlayerId.has(Number(canonical.id))) {
      classifiedPlayerIds.add(Number(canonical.id));
      candidates.push({ ...base, tier: 'tier3', reason: `Canonical player already resolves to ESPN ID ${resolvedEspnByPlayerId.get(Number(canonical.id))}` });
    } else if (cohortVerified) {
      classifiedPlayerIds.add(Number(canonical.id));
      candidates.push({ ...base, tier: 'tier1', reason: 'Known ESPN athlete ID in the Phase 1 deterministic cohort and one exact canonical-name match' });
    } else if (normalizeTeam(canonical.team_abbreviation) === athlete.team) {
      classifiedPlayerIds.add(Number(canonical.id));
      candidates.push({ ...base, tier: 'tier1', reason: 'One exact normalized name on each side and current team agrees' });
    } else {
      classifiedPlayerIds.add(Number(canonical.id));
      candidates.push({ ...base, tier: 'tier2', reason: `Exact normalized name, but canonical team ${normalizeTeam(canonical.team_abbreviation)} differs from ESPN team ${athlete.team}` });
    }
  }

  // The cohort can safely seed a player absent from today's roster response:
  // its ESPN ID was already validated by historical game-log retrieval.
  for (const [espnPlayerId, expectedName] of cohort) {
    if (seenEspnIds.has(espnPlayerId) || existingByEspnId.has(espnPlayerId)) continue;
    const canonicalCandidates = playersByName.get(normalizeName(expectedName)) ?? [];
    if (canonicalCandidates.length !== 1) continue;
    const canonical = canonicalCandidates[0];
    if (resolvedEspnByPlayerId.has(Number(canonical.id))) continue;
    classifiedPlayerIds.add(Number(canonical.id));
    candidates.push({
      espn: { espnPlayerId, name: expectedName, team: null, source: 'data/analytics/nba-tournament-plan.json' },
      canonical: { id: canonical.id, name: canonical.name, nbaPlayerId: canonical.nba_player_id, team: normalizeTeam(canonical.team_abbreviation), position: canonical.position_group },
      cohortExpectedName: expectedName,
      tier: 'tier1',
      reason: 'Known ESPN athlete ID in the Phase 1 deterministic cohort and one exact canonical-name match; not present on current roster response',
    });
  }

  for (const player of players.filter(player => !classifiedPlayerIds.has(Number(player.id)))) {
    candidates.push({ espn: null, canonical: { id: player.id, name: player.name, nbaPlayerId: player.nba_player_id, team: normalizeTeam(player.team_abbreviation), position: player.position_group }, cohortExpectedName: null, tier: 'tier4', reason: 'No current ESPN roster athlete had this normalized name' });
  }

  candidates.sort((left, right) => (left.canonical?.name ?? left.espn?.name ?? '').localeCompare(right.canonical?.name ?? right.espn?.name ?? ''));
  const count = tier => candidates.filter(candidate => candidate.tier === tier).length;
  const report = {
    generatedAt: new Date().toISOString(),
    source: { canonical: 'public.players where is_active=true and nba_player_id is not null (read-only)', espn: `${teamsUrl} and 30 public team-roster endpoints`, existingIdentities: 'public.nba_player_provider_identities where provider=espn (read-only)' },
    rules: { tier1: 'exact normalized name, exactly one candidate on each side, and normalized current team agrees', tier2: 'exact normalized name but current teams differ; manual review required', tier3: 'ambiguous or conflicts with an existing resolved mapping; never auto-resolve', tier4: 'no current ESPN roster candidate; leave unresolved/skipped' },
    summary: { canonicalPlayers: players.length, espnRosterAthletes: espnAthletes.length, tier1: count('tier1'), tier2: count('tier2'), tier3: count('tier3'), tier4: count('tier4'), alreadyMappedOrBlocked: count('already_mapped'), providerOnly: count('provider_only'), cohortMatches: candidates.filter(candidate => candidate.cohortExpectedName !== null && ['tier1', 'tier2'].includes(candidate.tier)).length },
    candidates,
  };
  const tier1 = candidates.filter(candidate => candidate.tier === 'tier1');
  const sql = [
    '-- REVIEW ONLY: generated by scripts/prepare-nba-provider-identity-review.cjs.',
    '-- Do not execute until the paired JSON review has been checked.',
    'begin;',
    '-- Initial reviewed mapping set: fail closed if anything already exists.',
    '-- The table lock prevents a concurrent insert between this check and the rows below.',
    'lock table public.nba_player_provider_identities in share row exclusive mode;',
    'do $$',
    'begin',
    "  if exists (select 1 from public.nba_player_provider_identities) then",
    "    raise exception 'NBA provider identity table is not empty; review existing mappings before applying the Tier 1 seed';",
    '  end if;',
    'end;',
    '$$;',
    ...tier1.map(candidate => `insert into public.nba_player_provider_identities (provider,provider_player_id,player_id,provider_name,resolution_status,resolution_method,evidence,is_locked) values ('espn',${quote(candidate.espn.espnPlayerId)},${Number(candidate.canonical.id)},${quote(candidate.espn.name)},'resolved','reviewed_exact_name',${quote(candidate.cohortExpectedName ? `Known ESPN ID in Phase 1 cohort with exact canonical-name match; reviewed ${report.generatedAt}` : `Exact normalized name and current team ${candidate.espn.team} agreed in ESPN roster review ${report.generatedAt}`)},true) on conflict do nothing;`),
    'do $$',
    'begin',
    `  if (select count(*) from public.nba_player_provider_identities) <> ${tier1.length} then`,
    `    raise exception 'Tier 1 seed did not create exactly ${tier1.length} NBA provider identities';`,
    '  end if;',
    'end;',
    '$$;',
    'commit;',
    '',
  ].join('\n');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(report));
  fs.writeFileSync(sqlPath, sql);
  console.log(JSON.stringify({ ...report.summary, jsonPath, markdownPath, sqlPath }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
