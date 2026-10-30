/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { reviewNbaIdentityGaps } = require('../lib/player-center/nbaIdentity.ts');
const { professionalSeason, seasonLabel } = require('../lib/player-center/types.ts');
const { BoundedReadCache, ReadBudget } = require('../lib/player-center/cache.ts');
const { actualFantasyPoints, summarizeHistory, compareActualStats } = require('../lib/player-center/comparison.ts');
const { normalizeCenterLog, normalizeCenterSeasonStats, normalizeCenterNflSummary, normalizeCenterNflSchedule, enrichNflGame, CenterEspnReader } = require('../lib/player-center/espn.ts');
const { PlayerCenterService } = require('../lib/player-center/service.ts');
const fixture = name => structuredClone(require(`./fixtures/player-center/${name}.json`));
const now = Date.parse('2026-10-23T17:00:00Z');
const fetchedAt = new Date(now).toISOString();
const nbaRequest = { sport: 'nba', providerPlayerId: '1966', season: 2027, phase: 'regular', fetchedAt };
const nflRequest = { sport: 'nfl', providerPlayerId: '3139477', season: 2026, phase: 'regular', fetchedAt };
const rules = sport => ({ sport, settings: null, basis: 'legacy_defaults' });
const player = (sport = 'nba') => ({ sport, playerId: 1, name: 'Player A', position: sport === 'nba' ? 'F/C' : 'QB', active: true,
  providerPlayerId: sport === 'nba' ? '1966' : '3139477', nativePlayerId: sport === 'nba' ? '2544' : '3139477', identity: 'resolved' });
function game(overrides = {}) { return { provider: 'espn', providerPlayerId: '1966', eventId: '100', season: 2027, phase: 'regular',
  gameAt: '2026-10-21T20:00:00Z', week: null, teamId: '1', team: 'A', opponentId: '2', opponent: 'B', homeAway: 'home',
  status: 'final', participation: 'played', stats: { minutes: 30, points: 10, rebounds: 5, assists: 4, steals: 1, blocks: 1, turnovers: 2 }, sources: ['https://espn.test/log'], fetchedAt, issues: [], ...overrides }; }
function history(games, overrides = {}) { return { player: player(), season: 2027, phase: 'regular', source: 'provider', games,
  coverage: { kind: 'appearance_log', expectedGames: games.length, fetchedAt, freshness: 'fresh', issues: [] }, ...overrides }; }

test('NBA gap review requires native ID, unique names AND matching current provider teams', () => {
  const input = { players: [{ id: 1, name: 'A Player', nba_player_id: 100, team_abbreviation: 'OLD', is_active: true }],
    native: [{ nbaPlayerId: 100, name: 'A Player', team: 'GSW', rostered: true }],
    espn: [{ espnPlayerId: '9', name: 'A Player', team: 'GS', source: 'https://espn.test/roster' }], stored: [], nativeSource: 'https://nba.test/roster' };
  const resolved = reviewNbaIdentityGaps(input)[0];
  assert.equal(resolved.category, 'corroborated_current_rosters'); assert.equal(resolved.candidate.needsApproval, true);
  assert.equal(resolved.candidate.sources.length, 2);
  assert.equal(reviewNbaIdentityGaps({ ...input, native: [] })[0].candidate, null);
  assert.equal(reviewNbaIdentityGaps({ ...input, espn: [{ ...input.espn[0], team: 'MIA' }] })[0].category, 'current_provider_teams_disagree');
  assert.equal(reviewNbaIdentityGaps({ ...input, espn: [...input.espn, { ...input.espn[0], espnPlayerId: '10' }] })[0].category, 'ambiguous_espn_candidate');
  assert.equal(reviewNbaIdentityGaps({ ...input, stored: [{ player_id: 2, provider_player_id: '9', resolution_status: 'resolved' }] })[0].category, 'provider_id_already_claimed');
});
test('professional years keep NBA ending year and NFL January in the starting season', () => {
  assert.equal(professionalSeason('nba', new Date('2026-10-23Z')), 2027);
  assert.equal(professionalSeason('nba', new Date('2026-05-23Z')), 2026);
  assert.equal(professionalSeason('nfl', new Date('2027-01-12Z')), 2026);
  assert.equal(seasonLabel('nba', 2027), '2026–27');
});
test('real NBA log separates regular/preseason and preserves shooting and exact identity', () => {
  const parsed = normalizeCenterLog(fixture('nba-current-log'), nbaRequest);
  assert.equal(parsed.games.length, 2); assert.ok(parsed.games.every(g => g.phase === 'regular' && g.season === 2027));
  assert.ok(parsed.games.every(g => g.stats.fieldGoalsAttempted !== null && g.stats.minutes > 0));
  const bad = fixture('nba-current-log'); bad.filters.find(f => f.name === 'season').value = '2026';
  assert.throws(() => normalizeCenterLog(bad, nbaRequest), /season mismatch/);
});
test('NBA DNP, live, missing and contradictory rows cannot score as completed appearances', () => {
  const p = fixture('nba-current-log'), row = p.seasonTypes[0].categories[0].events[0];
  row.didNotPlay = true;
  const dnp = normalizeCenterLog(p, nbaRequest).games.find(g => g.eventId === row.eventId);
  assert.equal(dnp.participation, 'dnp'); assert.equal(actualFantasyPoints(dnp, 'F/C', rules('nba')), null);
  delete row.didNotPlay;
  p.events[row.eventId].status = { type: { state: 'in', completed: false } };
  assert.equal(normalizeCenterLog(p, nbaRequest).games.find(g => g.eventId === row.eventId).status, 'live');
  row.stats[p.names.indexOf('steals')] = '--'; delete p.events[row.eventId].status;
  const missing = normalizeCenterLog(p, nbaRequest).games.find(g => g.eventId === row.eventId);
  assert.equal(missing.stats.steals, null); assert.equal(actualFantasyPoints(missing, 'F/C', rules('nba')), null);
});
test('NFL adapter preserves negative yards and withholds unknown off-position fields and QB fumbles', () => {
  const p = fixture('nfl-qb-log'), row = p.seasonTypes[0].categories[0].events[0];
  row.stats[p.names.indexOf('rushingYards')] = '-3';
  const result = normalizeCenterLog(p, nflRequest), g = result.games.find(g => g.eventId === row.eventId);
  assert.equal(g.stats.rushing_yards, -3); assert.equal(g.stats.fumbles_lost, null); assert.equal(g.stats.receptions, null);
  assert.equal(g.status, 'unknown'); assert.equal(actualFantasyPoints(g, 'QB', rules('nfl')), null);
});
test('NFL summary joins event/season/team IDs and establishes finality and verified absence zeros', () => {
  const parsed = normalizeCenterLog(fixture('nfl-qb-log'), nflRequest), g = parsed.games.find(g => g.eventId === '401873006');
  const summary = normalizeCenterNflSummary(fixture('nfl-summary'), g.eventId);
  const enriched = enrichNflGame(g, summary, 'https://espn.test/summary');
  assert.equal(enriched.status, 'final'); assert.equal(enriched.stats.fumbles_lost, 0); assert.equal(enriched.stats.receptions, 0);
  assert.ok(Number.isFinite(actualFantasyPoints(enriched, 'QB', rules('nfl'))));
  assert.throws(() => enrichNflGame({ ...g, season: 2025 }, summary, 'x'), /context mismatch/);
  assert.throws(() => enrichNflGame({ ...g, teamId: '999' }, summary, 'x'), /context mismatch/);
});
test('incomplete category evidence never establishes an absent athlete as zero', () => {
  const p = fixture('nfl-summary'), g = normalizeCenterLog(fixture('nfl-qb-log'), nflRequest).games.find(g => g.eventId === '401873006');
  const fumbles = p.boxscore.players.find(t => t.team.id === g.teamId).statistics.find(s => s.name === 'fumbles');
  fumbles.totals = [];
  p.boxscore.teams.find(t => t.team.id === g.teamId).statistics = p.boxscore.teams.find(t => t.team.id === g.teamId).statistics.filter(stat => stat.name !== 'fumblesLost');
  fumbles.athletes = fumbles.athletes.filter(row => row.athlete.id !== g.providerPlayerId);
  const enriched = enrichNflGame(g, normalizeCenterNflSummary(p, g.eventId), 'x');
  assert.equal(enriched.stats.fumbles_lost, null); assert.equal(actualFantasyPoints(enriched, 'QB', rules('nfl')), null);
});
test('conflicting duplicate logs quarantine the event instead of double counting it', () => {
  const p = fixture('nfl-qb-log'), rows = p.seasonTypes[0].categories[0].events;
  rows.push(structuredClone(rows[0])); rows.at(-1).stats[0] = '99';
  const result = normalizeCenterLog(p, nflRequest);
  assert.equal(result.games.length, rows.length - 2); assert.match(result.issues[0], /conflicting_event/);
});
test('verified kicking statistics remain distinct from unsupported fantasy scoring', () => {
  const result = normalizeCenterLog(fixture('nfl-k-log'), { ...nflRequest, providerPlayerId: '3055899' });
  assert.equal(result.games.length, 5); assert.ok(result.games.every(g => g.stats.field_goals_made <= g.stats.field_goals_attempted));
  assert.ok(result.games.every(g => g.stats.kicking_points !== null));
  assert.equal(actualFantasyPoints({ ...result.games[0], status: 'final' }, 'K', rules('nfl')), null);
});
test('season stats select exact professional year and preserve separate prior season/team rows', () => {
  const current = normalizeCenterSeasonStats(fixture('nba-season'), 'nba', 2027, 'regular');
  assert.equal(current.expectedGames, 2); assert.ok(current.categories.every(c => c.teamId === '20'));
  const prior = normalizeCenterSeasonStats(fixture('nba-season'), 'nba', 2026, 'regular');
  assert.equal(prior.expectedGames, 60); assert.ok(prior.categories.every(c => c.teamId === '13'));
  assert.equal(normalizeCenterSeasonStats(fixture('nfl-season'), 'nfl', 2026, 'regular').expectedGames, 5);
  const p = fixture('nba-season'); const c = p.categories[0]; c.statistics.push(structuredClone(c.statistics.at(-1)));
  assert.equal(normalizeCenterSeasonStats(p, 'nba', 2027, 'regular').expectedGames, null);
});
test('scoring uses supplied frozen rules; missing values and kickers never become zero FP', () => {
  assert.equal(actualFantasyPoints(game(), 'F/C', rules('nba')), 24);
  assert.equal(actualFantasyPoints(game(), 'F/C', { sport: 'nba', basis: 'slate_snapshot', settings: { sport: 'nba', scoring: { points: 2 } } }), 34);
  assert.throws(() => actualFantasyPoints(game(), 'F/C', { sport: 'nba', basis: 'slate_snapshot', settings: null }));
  assert.equal(actualFantasyPoints(game({ stats: { ...game().stats, blocks: null } }), 'F/C', rules('nba')), null);
});
test('windows require exact samples, reject mixed seasons, skip explicit DNP/live, and do not slide past missing recent games', () => {
  const first = game(), second = game({ eventId: '101', gameAt: '2026-10-20T20:00:00Z', stats: { ...game().stats, points: 20 } });
  const h = history([first, second]);
  assert.equal(summarizeHistory(h, 'last3', rules('nba'), fetchedAt).averages.points, null);
  assert.equal(summarizeHistory(h, 'season', rules('nba'), fetchedAt).averages.points, 15);
  assert.equal(summarizeHistory(h, 'season', rules('nba'), fetchedAt).comparable, true);
  const unknown = history([{ ...first, status: 'unknown' }, second]);
  const last = summarizeHistory(unknown, 'last1', rules('nba'), fetchedAt);
  assert.equal(last.sampleSize, 0); assert.equal(last.comparable, false);
  const mixed = history([first, second, game({ eventId: '102', season: 2026, stats: { points: 1000 } }), game({ eventId: '103', participation: 'dnp' }), game({ eventId: '104', status: 'live' })]);
  mixed.coverage.expectedGames = 2;
  assert.equal(summarizeHistory(mixed, 'season', rules('nba'), fetchedAt).sampleSize, 2);
  assert.equal(summarizeHistory({ ...h, coverage: { ...h.coverage, expectedGames: null } }, 'last1', rules('nba'), fetchedAt).comparable, false);
});
test('missing-last ordering holds in both directions, including legitimate negative performance', () => {
  for (const ascending of [true, false]) {
    const values = [null, -2, 0, 10, undefined].sort((a, b) => compareActualStats(a, b, ascending));
    assert.deepEqual(values.slice(0, 3), ascending ? [-2, 0, 10] : [10, 0, -2]);
  }
});
test('cache deduplicates, respects TTL and budgets, and retains stale success on provider failure', async () => {
  let time = now, calls = 0;
  const cache = new BoundedReadCache(2, () => time), budget = new ReadBudget(2, now + 10000);
  const load = async () => { calls++; return { actual: 0 }; };
  const [a, b] = await Promise.all([cache.read('x', load, 100, budget), cache.read('x', load, 100, budget)]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(budget.used, 1);
  time += 200;
  const stale = await cache.read('x', async () => { throw Error('bad provider'); }, 100, budget);
  assert.equal(stale.freshness, 'stale'); assert.equal(stale.value.actual, 0); assert.equal(budget.used, 2);
  const blocked = await cache.read('new', load, 100, budget);
  assert.equal(blocked.value, null); assert.equal(blocked.error, 'provider_request_budget');
  time += 30001;
  assert.equal((await cache.read('x', load, 100, new ReadBudget(1, time + 100))).freshness, 'fresh');
});
test('cache bounds concurrency and per-minute misses; failures are briefly cached', async () => {
  const cache = new BoundedReadCache(2, () => now, 1, 1), budget = new ReadBudget(5, now + 10000);
  let release; const first = cache.read('one', () => new Promise(resolve => { release = resolve; }), 100, budget);
  await Promise.resolve();
  assert.equal((await cache.read('two', async () => 2, 100, budget)).error, 'provider_rate_limit');
  release(1); await first;
  assert.equal((await cache.read('two', async () => 2, 100, budget)).error, 'provider_rate_limit');
  const failures = new BoundedReadCache(2, () => now); let calls = 0;
  const bad = () => { calls++; throw Error('synchronous'); };
  await failures.read('x', bad, 100, budget); await failures.read('x', bad, 100, budget);
  assert.equal(calls, 1);
});
test('draft comparisons make zero provider calls and retain alphabetical order when coverage is unknown', async () => {
  let providerCalls = 0, dbReads = 0;
  const p1 = player(), p2 = { ...player(), playerId: 2, name: 'Player B', providerPlayerId: '9' };
  const h1 = history([game()]), h2 = history([], { player: p2 }); h2.coverage.expectedGames = null;
  const repository = { catalog: async () => ({ players: [p1, p2], readAt: fetchedAt }), histories: async () => { dbReads++; return [h2, h1]; } };
  const service = new PlayerCenterService(repository, { history: async () => { providerCalls++; } }, () => now);
  const result = await service.comparisons({ sport: 'nba', season: 2027, window: 'last1', metric: 'points', ascending: false, scoring: rules('nba') });
  assert.equal(providerCalls, 0); assert.equal(result.providerRequests, 0); assert.equal(result.coverage.canSort, false);
  assert.equal(result.players[0].player.name, 'Player A'); assert.equal(result.players[1].rankableAverage, null);
  await service.comparisons({ sport: 'nba', season: 2027, window: 'season', metric: 'points', ascending: true, scoring: rules('nba') });
  assert.equal(dbReads, 1);
});
test('single-profile reads cache public raw stats, then score separately for each Group/slate', async () => {
  let requests = 0;
  const reader = new CenterEspnReader(async url => { requests++; return new Response(JSON.stringify(fixture(String(url).includes('/stats?') ? 'nba-season' : 'nba-current-log'))); }, () => now);
  const repository = { catalog: async () => ({ players: [player()], readAt: fetchedAt }), histories: async () => { throw Error('No batch reads for profile'); } };
  const service = new PlayerCenterService(repository, reader, () => now);
  const input = { sport: 'nba', playerId: 1, season: 2027, phase: 'regular', scoring: rules('nba') };
  const a = await service.profile(input);
  const b = await service.profile({ ...input, scoring: { sport: 'nba', basis: 'slate_snapshot', settings: { sport: 'nba', scoring: { points: 2 } } } });
  assert.equal(requests, 2);
  const id = a.games[0].eventId;
  assert.equal(b.gameFantasyPoints[id] - a.gameFantasyPoints[id], a.games[0].stats.points);
});
test('unresolved and synthetic team IDs never reach the athlete endpoint', async () => {
  let requests = 0; const reader = new CenterEspnReader(async () => { requests++; throw Error('unexpected'); }, () => now);
  assert.equal((await reader.history({ ...player(), identity: 'unresolved', providerPlayerId: null }, 2027, 'regular')).coverage.kind, 'unavailable');
  assert.match((await reader.history({ ...player('nfl'), position: 'D/ST', providerPlayerId: '100000000' }, 2026, 'regular')).coverage.issues[0], /invalid_defense_identity/);
  assert.equal(requests, 0);
});
test('D/ST schedule preserves the starting season through January, explicit bye and scheduled/final states', () => {
  const p = fixture('nfl-team-schedule');
  const normalized = normalizeCenterNflSchedule(p, '12', 2026, 'regular', fetchedAt, 'https://espn.test/schedule');
  assert.equal(normalized.expectedGames, 5); assert.deepEqual(normalized.byeWeeks, [5]);
  assert.ok(normalized.games.some(g => g.gameAt.startsWith('2027-01') && g.season === 2026));
  assert.ok(normalized.games.some(g => g.status === 'scheduled'));
  assert.throws(() => normalizeCenterNflSchedule(p, '24', 2026, 'regular', fetchedAt, 'x'), /mismatch/);
  assert.throws(() => normalizeCenterNflSchedule(p, '12', 2025, 'regular', fetchedAt, 'x'), /mismatch/);
});
test('D/ST summary preserves existing scoring interpretation and rejects missing-to-zero inputs', () => {
  const p = fixture('nfl-summary'), summary = normalizeCenterNflSummary(p, '401873006');
  assert.ok(Object.values(summary.defenses['12']).every(v => v !== null));
  const g = game({ providerPlayerId: '100000012', season: 2026, stats: summary.defenses['12'] });
  assert.ok(Number.isFinite(actualFantasyPoints(g, 'D/ST', rules('nfl'))));
  p.boxscore.teams.find(t => t.team.id === '24').statistics = p.boxscore.teams.find(t => t.team.id === '24').statistics.filter(s => s.name !== 'totalYards');
  const incomplete = normalizeCenterNflSummary(p, '401873006').defenses['12'];
  assert.equal(incomplete.yardsAllowed, null); assert.equal(actualFantasyPoints({ ...g, stats: incomplete }, 'D/ST', rules('nfl')), null);
});
test('D/ST profile fetches the team schedule, shares summary cache, and never calls athlete URLs', async () => {
  const urls = [], schedule = fixture('nfl-team-schedule');
  schedule.events = schedule.events.filter(e => e.id === '401873006');
  const reader = new CenterEspnReader(async url => { urls.push(String(url)); return new Response(JSON.stringify(String(url).includes('/schedule?') ? schedule : fixture('nfl-summary'))); }, () => now);
  const result = await reader.history({ ...player('nfl'), position: 'D/ST', providerPlayerId: '100000012' }, 2026, 'regular');
  assert.equal(urls.length, 2); assert.ok(urls.every(url => !url.includes('/athletes/')));
  assert.equal(result.coverage.kind, 'team_schedule'); assert.equal(result.games[0].stats.yardsAllowed, 259);
});
test('a long NFL log uses at most eight cold provider reads and reports incomplete season coverage', async () => {
  const log = fixture('nfl-qb-log'), baseRow = log.seasonTypes[0].categories[0].events[0], baseEvent = log.events[baseRow.eventId];
  log.events = {}; log.seasonTypes = [{ displayName: '2026 Regular Season', categories: [{ type: 'event', splitType: '2', displayName: 'Regular Season Stats', events: [] }] }];
  for (let i = 0; i < 10; i++) {
    const id = String(5000 + i); log.events[id] = { ...baseEvent, id, gameDate: `2026-10-${String(i + 1).padStart(2, '0')}T20:00:00Z`, team: { id: '12' }, opponent: { id: '24' } };
    log.seasonTypes[0].categories[0].events.push({ ...baseRow, eventId: id });
  }
  const season = fixture('nfl-season');
  for (const category of season.categories) for (const row of category.statistics) {
    if (row.season.year === 2026 && category.labels.includes('GP')) row.stats[category.labels.indexOf('GP')] = '10';
  }
  let reads = 0;
  const reader = new CenterEspnReader(async rawUrl => {
    reads++; const url = new URL(rawUrl); let body;
    if (url.pathname.endsWith('/gamelog')) body = log;
    else if (url.pathname.endsWith('/stats')) body = season;
    else { body = fixture('nfl-summary'); body.header.id = url.searchParams.get('event'); body.header.competitions[0].id = body.header.id; }
    return new Response(JSON.stringify(body));
  }, () => now);
  const first = await reader.history(player('nfl'), 2026, 'regular');
  assert.equal(reads, 8); assert.equal(first.providerRequests, 8); assert.ok(first.coverage.issues.includes('summary_coverage_budget_limited'));
  assert.equal(summarizeHistory(first, 'last5', rules('nfl'), fetchedAt).comparable, true);
  assert.equal(summarizeHistory(first, 'season', rules('nfl'), fetchedAt).comparable, false);
  const second = await reader.history(player('nfl'), 2026, 'regular');
  assert.equal(second.providerRequests, 4); assert.equal(summarizeHistory(second, 'season', rules('nfl'), fetchedAt).comparable, true);
});
test('postponed/cancelled statuses cannot masquerade as final even if provider completed is true', () => {
  const p = fixture('nfl-summary'); p.header.competitions[0].status.type.name = 'STATUS_POSTPONED';
  assert.equal(normalizeCenterNflSummary(p, '401873006').status, 'unknown');
  const nba = fixture('nba-current-log');
  const eventId = nba.seasonTypes.find(t => t.displayName.includes('Regular Season')).categories[0].events[0].eventId;
  const event = nba.events[eventId];
  event.status = { type: { name: 'STATUS_CANCELED', state: 'post', completed: true } };
  const parsed = normalizeCenterLog(nba, nbaRequest);
  const row = parsed.games.find(g => g.eventId === event.id);
  assert.equal(row.status, 'unknown');
});
test('metric completeness is explicit even when the appearance window is complete', () => {
  const g = game({ stats: { ...game().stats, blocks: null } });
  const summary = summarizeHistory(history([g]), 'last1', rules('nba'), fetchedAt);
  assert.equal(summary.comparable, true); assert.equal(summary.metricComparable.fantasy_points, false);
  assert.equal(summary.missingMetricSamples.fantasy_points, 1); assert.equal(summary.averages.fantasy_points, null);
  assert.equal(summary.metricComparable.points, true);
});

function recoveredFixture(provider, event) {
  const log = fixture(`nfl-log-${provider}-${event}`), payload = fixture(`nfl-summary-${event}`);
  const original = normalizeCenterLog(log, { ...nflRequest, providerPlayerId: provider, fetchedAt: log._fixture.fetchedAt }).games[0];
  return { log, payload, original, source: payload._fixture.source };
}
test('Allgeier October 11 explicit athlete-log LOST=0 survives an empty summary fumble section', () => {
  const { payload, original, source } = recoveredFixture('4373626', '401872991');
  assert.equal(original.stats.fumbles_lost, 0);
  // Verify preservation independently of the additional exact-team-zero evidence.
  payload.boxscore.teams.find(t => t.team.id === '22').statistics = payload.boxscore.teams.find(t => t.team.id === '22').statistics.filter(stat => stat.name !== 'fumblesLost');
  const result = enrichNflGame(original, normalizeCenterNflSummary(payload, original.eventId), source);
  assert.equal(result.stats.fumbles_lost, 0); assert.equal(result.status, 'final');
  assert.ok(Math.abs(actualFantasyPoints(result, 'RB', rules('nfl')) - 3.6) < 1e-9);
});
test('Mahomes September 20 missing log LOST is proven zero by final exact-team aggregate, not empty athlete rows', () => {
  const { payload, original, source } = recoveredFixture('3139477', '401872945');
  assert.equal(original.stats.fumbles_lost, null);
  const summary = normalizeCenterNflSummary(payload, original.eventId);
  assert.equal(summary.teams['12'].fumbles.absenceEvidence, 'team_zero_fumbles_lost');
  const result = enrichNflGame(original, summary, source);
  assert.equal(result.stats.fumbles_lost, 0); assert.ok(Math.abs(actualFantasyPoints(result, 'QB', rules('nfl')) - 28.98) < 1e-9);
  assert.ok(result.sources.includes(source));
});
test('missing, positive, malformed, duplicated or contradictory team evidence never fabricates athlete LOST=0', () => {
  for (const scenario of ['missing', 'positive', 'bad_display', 'bad_value', 'duplicate_conflict', 'duplicate_team', 'athlete_conflict', 'totals_conflict', 'live']) {
    const { payload, original, source } = recoveredFixture('3139477', '401872945');
    const team = payload.boxscore.teams.find(t => t.team.id === '12'), cell = team.statistics.find(s => s.name === 'fumblesLost');
    const fumbles = payload.boxscore.players.find(t => t.team.id === '12').statistics.find(g => g.name === 'fumbles');
    if (scenario === 'missing') team.statistics = team.statistics.filter(s => s !== cell);
    if (scenario === 'positive') { cell.displayValue = '1'; cell.value = 1; }
    if (scenario === 'bad_display') cell.displayValue = '--';
    if (scenario === 'bad_value') cell.value = 1;
    if (scenario === 'duplicate_conflict') team.statistics.push({ ...cell, displayValue: '1', value: 1 });
    if (scenario === 'duplicate_team') payload.boxscore.teams.push(structuredClone(team));
    if (scenario === 'athlete_conflict') fumbles.athletes.push({ athlete: { id: '999' }, stats: ['1', '1', '0'] });
    if (scenario === 'totals_conflict') fumbles.totals = ['1', '1', '0'];
    if (scenario === 'live') payload.header.competitions[0].status.type = { state: 'in', completed: false };
    const result = enrichNflGame(original, normalizeCenterNflSummary(payload, original.eventId), source);
    assert.equal(result.stats.fumbles_lost, null, scenario); assert.equal(actualFantasyPoints(result, 'QB', rules('nfl')), null, scenario);
  }
});
test('an explicit log/summary conflict withholds scoring instead of silently preferring either source', () => {
  const { payload, original, source } = recoveredFixture('3139477', '401872945');
  original.stats.fumbles_lost = 1;
  const result = enrichNflGame(original, normalizeCenterNflSummary(payload, original.eventId), source);
  assert.equal(result.stats.fumbles_lost, null); assert.ok(result.issues.includes('conflicting_log_summary_stat:fumbles_lost'));
  assert.equal(actualFantasyPoints(result, 'QB', rules('nfl')), null);
});
test('exactly six available NFL summaries at the eight-read cap are complete, not budget-limited', async () => {
  const log = fixture('nfl-qb-log'), baseRow = log.seasonTypes[0].categories[0].events[0], baseEvent = log.events[baseRow.eventId];
  log.events = {}; log.seasonTypes = [{ displayName: '2026 Regular Season', categories: [{ type: 'event', splitType: '2', events: [] }] }];
  for (let i = 0; i < 6; i++) { const id = String(6000 + i); log.events[id] = { ...baseEvent, id, gameDate: `2026-10-${i + 10}T20:00:00Z` }; log.seasonTypes[0].categories[0].events.push({ ...baseRow, eventId: id }); }
  const reader = new CenterEspnReader(async raw => {
    const url = new URL(raw); let body;
    if (url.pathname.endsWith('/gamelog')) body = log;
    else if (url.pathname.endsWith('/stats')) body = fixture('nfl-season');
    else { body = fixture('nfl-summary'); body.header.id = url.searchParams.get('event'); body.header.competitions[0].id = body.header.id; }
    return new Response(JSON.stringify(body));
  }, () => now);
  const result = await reader.history(player('nfl'), 2026, 'regular');
  assert.equal(result.providerRequests, 8); assert.ok(!result.coverage.issues.includes('summary_coverage_budget_limited'));
  assert.ok(result.games.every(game => game.sources.some(source => source.includes('/summary?'))));
});
