/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args); };
require.extensions['.ts'] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename);
};
const { deriveGameImplications } = require('../lib/bracket/gameImplications.ts');
const { matchesImplicationContext } = require('../lib/bracket/implicationsContext.ts');
const topology = { games: [
  { id: 'left', roundKey: 'semi', roundOrder: 1, gameOrder: 1, sources: [{ type: 'team', teamId: 'A' }, { type: 'team', teamId: 'B' }] },
  { id: 'right', roundKey: 'semi', roundOrder: 1, gameOrder: 2, sources: [{ type: 'team', teamId: 'C' }, { type: 'team', teamId: 'D' }] },
  { id: 'final', roundKey: 'title', roundOrder: 2, gameOrder: 1, sources: [{ type: 'winner', gameId: 'left' }, { type: 'winner', gameId: 'right' }] },
] };
const entry = (id, picks = { left: 'A', right: 'C', final: 'C' }, rules = { semi: 3, title: 17 }) => ({ id, label: `Entry ${id}`, picks, rules });
const subject = entry(2);
const rival = entry(3, { left: 'A', right: 'D', final: 'A' }, { semi: 7, title: 31 });
const analyze = (changes = {}) => deriveGameImplications({ topology, gameId: 'left', results: {}, subject, rivals: [subject, rival, entry(4, { left: 'B', right: 'C', final: 'B' })], ...changes });

test('each entry uses its own rules, and only the viewed entry is excluded from rivals', () => {
  const result = analyze();
  assert.equal(result.totalEntries, 3);
  assert.equal(result.otherEntries, 2);
  const win = result.outcomes.find(row => row.teamId === 'A');
  assert.equal(win.subject.immediatePoints, 3);
  assert.equal(win.rivals[0].immediatePoints, 7);
  assert.equal(win.rivals[0].immediateDifference, -4);
  const loss = result.outcomes.find(row => row.teamId === 'B');
  assert.equal(loss.rivals[0].futureCeilingLost, 31);
  assert.equal(loss.subject.futureCeilingLost, 0);
});
test('win now, lose later is structured with rival champion and longer paths', () => {
  const row = analyze().exposure.find(row => row.teamId === 'A');
  assert.deepEqual(row.nextDifferentPick, { gameId: 'final', roundKey: 'title', teamId: 'C' });
  assert.equal(row.longerRivalPaths.length, 1);
  assert.equal(row.championEntries[0].entryId, 3);
  assert.equal(row.championEntries[0].alive, true);
  assert.equal(row.selectedCount, 2);
});
test('wrong predicted opponent does not invalidate a correct downstream winner', () => {
  const result = analyze({ gameId: 'final', results: { left: 'A', right: 'C' }, subject: rival });
  assert.equal(result.subject.eligibleToScore, true);
  assert.equal(result.outcomes.find(row => row.teamId === 'A').subject.immediatePoints, 31);
});
test('eliminated and incomplete picks have no imaginary scoring potential', () => {
  const result = analyze({ gameId: 'final', results: { left: 'B', right: 'C' }, subject: rival });
  assert.equal(result.subject.pickStatus, 'eliminated');
  assert.equal(result.subject.eligibleToScore, false);
  assert.ok(result.outcomes.every(row => row.subject.immediatePoints === 0));
  const incomplete = analyze({ subject: entry(2, {}), rivals: null });
  assert.equal(incomplete.subject.pickStatus, 'unmade');
  assert.equal(incomplete.subject.remainingPotential, 0);
  assert.equal(incomplete.totalEntries, null);
});
test('unresolved participants give conditional exposure without an invented matchup', () => {
  const result = analyze({ gameId: 'final' });
  assert.equal(result.matchupConfirmed, false);
  assert.deepEqual(result.participants, [null, null]);
  assert.equal(result.outcomes.length, 0);
  assert.deepEqual(result.exposure.map(row => row.teamId), ['A', 'B', 'C', 'D']);
  assert.equal(result.exposure.find(row => row.teamId === 'C').immediatePointsIfWinner, 17);
});
test('official final is a single actual impact, retaining opportunities eliminated even after later finals', () => {
  const result = analyze({ results: { left: 'B', right: 'C', final: 'C' } });
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].confirmed, true);
  assert.equal(result.outcomes[0].teamId, 'B');
  assert.equal(result.outcomes[0].rivals[0].futureCeilingLost, 31);
  assert.equal(result.exposure.find(row => row.teamId === 'A').championEntries[0].alive, false);
  assert.equal(result.subject.pointsEarned, 20);
});
test('unanimous picks and zero-point rounds produce zero differential without hiding pick exposure', () => {
  const zero = entry(2, { left: 'A', right: 'C', final: 'A' }, { semi: 0, title: 0 });
  const result = analyze({ subject: zero, rivals: [zero, { ...zero, id: 3 }] });
  assert.equal(result.exposure[0].selectedCount, 2);
  assert.ok(result.outcomes.every(row => row.sameImmediatePoints));
  assert.equal(result.outcomes[1].subject.futureCeilingLost, 0);
  assert.equal(result.outcomes[1].subject.lostPicks.length, 1);
});
test('analysis does not mutate any source input', () => {
  const input = { topology, gameId: 'left', results: {}, subject, rivals: [rival] };
  const serialized = JSON.stringify(input);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(input); deriveGameImplications(input);
  assert.equal(JSON.stringify(input), serialized);
});
test('client identity rejects different games, entries, draft numbers and contests', () => {
  const response = { contestId: 'g1', competitionId: 1, game: { gameId: 'left' }, subject: { contestId: 'g1', competitionId: 1, entryId: 2, entrantId: 'josh', bracketNumber: 2 } };
  assert.equal(matchesImplicationContext(response, 'g1', 'left', { entryId: 2 }), true);
  assert.equal(matchesImplicationContext(response, 'g2', 'left', { entryId: 2 }), false);
  assert.equal(matchesImplicationContext(response, 'g1', 'right', { entryId: 2 }), false);
  assert.equal(matchesImplicationContext(response, 'g1', 'left', { entryId: 1 }), false);
  assert.equal(matchesImplicationContext(response, 'g1', 'left', { entrantId: 'josh', bracketNumber: 1 }), false);
});

// In-memory Supabase fixture executes the real contest access reader and implications loader.
let tables, queries, activeLeague = 'league1', enabled = true;
const admin = { from(table) {
  const filters = []; let orClause = null; let single = false;
  const query = {
    select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
    lte(key, value) { filters.push(row => row[key] <= value); return query; },
    in(key, values) { filters.push(row => values.includes(row[key])); return query; },
    or(value) { orClause = value; return query; }, order() { return query; }, maybeSingle() { single = true; return query; },
    then(resolve) {
      queries.push(table);
      let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      if (orClause) rows = rows.filter(row => orClause.split(',').some(clause => { const [key, , value] = clause.split('.'); return row[key] === value; }));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
    },
  }; return query;
} };
Module._load = function(request, parent, isMain) {
  if (request === 'server-only') return {};
  if (request === '@/lib/supabaseAdmin') return { supabaseAdmin: admin };
  if (request === '@/lib/bracket/access') return { getBracketChallengeAccess: async () => enabled ? ({ context: { group: { id: activeLeague === 'league1' ? 'group1' : 'group2', name: 'Group', slug: 'group' }, canAdministerGroup: false }, league: { id: activeLeague, name: 'CFP', slug: 'cfp' } }) : null };
  return load.call(this, request, parent, isMain);
};
const { getBracketGameImplications } = require('../lib/bracket/gameImplications.server.ts');
Module._load = load;
Module._resolveFilename = resolve;
function setup(locked = true) {
  queries = [];
  activeLeague = 'league1';
  enabled = true;
  const josh = { id: 'josh', display_name: 'Josh', account_user_id: 'B', managing_user_id: null, is_active: true };
  const managed = { id: 'managed', display_name: 'Managed', account_user_id: null, managing_user_id: 'A', is_active: true };
  const master = (id, entrantId, number) => ({ id, entrant_id: entrantId, competition_id: 1, bracket_number: number, name: null });
  const masters = [master('m1', 'josh', 1), master('m2', 'managed', 1), master('m3', 'managed', 2)];
  const entrants = [josh, managed];
  const rows = masters.map((m, i) => ({ id: i + 1, entrant_id: m.entrant_id, master_bracket_id: m.id, contest_id: 'contest1', competition_id: 1,
    locked_at: locked ? '2026-01-01' : null, picks_snapshot: locked ? (i === 0 ? subject.picks : rival.picks) : null,
    rules_snapshot: locked ? { scoring: { roundPoints: i === 0 ? subject.rules : rival.rules } } : null,
    bracket_entrants: entrants.find(e => e.id === m.entrant_id), bracket_master_brackets: m }));
  tables = {
    bracket_contests: [{ id: 'contest1', league_id: 'league1', competition_id: 1, status: locked ? 'locked' : 'open', lock_at: null, max_brackets_per_entrant: 3, rules_snapshot: { scoring: { roundPoints: { semi: 1, title: 2 } } } },
      { id: 'other-group', league_id: 'league2', competition_id: 1 }],
    bracket_competitions: [{ id: 1, sport_key: 'college_football', format_key: 'cfp', topology_version: 1 }],
    bracket_games: topology.games.map((game, index) => ({ id: index + 1, competition_id: 1, game_key: game.id, round_key: game.roundKey,
      round_order: game.roundOrder, game_order: game.gameOrder, status: 'scheduled', winner_team_id: null,
      source_a_team_id: game.sources[0].teamId ?? null, source_b_team_id: game.sources[1].teamId ?? null,
      source_a_game_id: game.sources[0].gameId === 'left' ? 1 : null, source_b_game_id: game.sources[1].gameId === 'right' ? 2 : null,
      scheduled_at: null, provider_event_id: `event${index}` })),
    bracket_competition_teams: [], bracket_entrants: entrants, bracket_master_brackets: masters, bracket_entries: rows,
    bracket_master_picks: [{ master_bracket_id: 'm2', competition_id: 1, game_id: 1, picked_team_id: 'B' }],
  };
}
const user = { id: 'A', displayName: 'Viewer A' };
test('missing active Group or enabled bracket league denies access before any contest query', async () => {
  setup(); enabled = false;
  assert.equal(await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' }), null);
  assert.equal(queries.length, 0);
});
test('Viewer A analyzes B’s admitted frozen bracket, never A’s default', async () => {
  setup();
  const result = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(result.subject.entrantId, 'josh');
  assert.equal(result.subject.entrantName, 'Josh');
  assert.equal(result.subject.isAccountOwner, false);
  assert.equal(result.analysis.subject.pick, 'A');
  assert.equal(result.analysis.outcomes[0].subject.immediatePoints, 3);
  assert.equal(result.analysis.otherEntries, 2);
  assert.ok(!queries.includes('bracket_master_picks'));
});
test('the server distinguishes account ownership from managed ownership for safe defaults and address', async () => {
  setup();
  const own = await getBracketGameImplications({ ...user, id: 'B' }, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(own.subject.isAccountOwner, true);
  const managed = await getBracketGameImplications(user, 'contest1', { entryId: 2, gameId: 'left' });
  assert.equal(managed.subject.isAccountOwner, false);
  assert.equal(managed.subject.entrantName, 'Managed');
});
test('managed entrants and multiple brackets are separate subjects and comparisons', async () => {
  setup();
  const result = await getBracketGameImplications(user, 'contest1', { entrantId: 'managed', bracketNumber: 2, gameId: 'left' });
  assert.equal(result.subject.entryId, 3);
  assert.equal(result.subject.bracketNumber, 2);
  assert.equal(result.analysis.otherEntries, 2);
});
test('same master in another Group contest cannot leak or supply scoring rules', async () => {
  setup();
  tables.bracket_entries.push({ ...tables.bracket_entries[0], id: 99, contest_id: 'other-group', rules_snapshot: { scoring: { roundPoints: { semi: 999, title: 999 } } } });
  assert.equal(await getBracketGameImplications(user, 'other-group', { entryId: 99, gameId: 'left' }), null);
  assert.ok('error' in await getBracketGameImplications(user, 'contest1', { entryId: 99, gameId: 'left' }));
  const valid = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(valid.analysis.totalEntries, 3);
  assert.equal(valid.analysis.outcomes[0].subject.immediatePoints, 3);
  tables.bracket_contests[1] = { ...tables.bracket_contests[0], id: 'other-group', league_id: 'league2' };
  activeLeague = 'league2';
  const second = await getBracketGameImplications(user, 'other-group', { entryId: 99, gameId: 'left' });
  assert.equal(second.subject.masterBracketId, valid.subject.masterBracketId);
  assert.equal(second.subject.entryId, 99);
  assert.equal(second.analysis.totalEntries, 1);
  assert.equal(second.analysis.outcomes[0].subject.immediatePoints, 999);
  assert.equal(await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' }), null);
});
test('pre-lock managed draft is personal only; other entrant picks remain private', async () => {
  setup(false);
  const result = await getBracketGameImplications(user, 'contest1', { entrantId: 'managed', bracketNumber: 1, gameId: 'left' });
  assert.equal(result.subject.snapshotStatus, 'draft');
  assert.equal(result.analysis.subject.pick, 'B');
  assert.equal(result.analysis.outcomes[1].subject.immediatePoints, 1);
  assert.equal(result.poolState, 'pre_lock');
  assert.equal(result.analysis.totalEntries, null);
  assert.ok(result.analysis.exposure.every(row => row.championEntries === null && row.selectedCount === null));
  assert.ok(result.subjects.every(row => row.entrantId === 'managed'));
  assert.ok('error' in await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' }));
});
test('missing snapshots preserve personal insight but suppress every Group comparison', async () => {
  setup(); tables.bracket_entries[2].picks_snapshot = null;
  const result = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(result.poolState, 'freezing');
  assert.equal(result.analysis.subject.pick, 'A');
  assert.equal(result.analysis.outcomes[0].rivals, null);
  const pending = await getBracketGameImplications(user, 'contest1', { entryId: 3, gameId: 'left' });
  assert.equal(pending.readiness, 'snapshot_pending');
  assert.equal(pending.analysis, null);
});
test('invalid rival scoring snapshots keep personal analysis available and comparisons pending', async () => {
  setup(); tables.bracket_entries[2].rules_snapshot = { scoring: {} };
  const result = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(result.poolState, 'freezing');
  assert.equal(result.analysis.subject.pick, 'A');
  assert.equal(result.analysis.otherEntries, null);
});
test('pre-lock owner can analyze an existing unadmitted master without creating or admitting it', async () => {
  setup(false); tables.bracket_entries = tables.bracket_entries.filter(row => row.id !== 2);
  const result = await getBracketGameImplications(user, 'contest1', { entrantId: 'managed', bracketNumber: 1, gameId: 'left' });
  assert.equal(result.subject.entryId, null);
  assert.equal(result.subject.snapshotStatus, 'draft');
  assert.equal(result.analysis.subject.pick, 'B');
  assert.equal(tables.bracket_entries.length, 2);
});
test('early frozen owned entry uses its snapshot; an incomplete frozen entry never falls back to mutable draft picks', async () => {
  setup(false);
  tables.bracket_entries[1].locked_at = '2026-01-01';
  tables.bracket_entries[1].picks_snapshot = rival.picks;
  tables.bracket_entries[1].rules_snapshot = { scoring: { roundPoints: rival.rules } };
  const frozen = await getBracketGameImplications(user, 'contest1', { entryId: 2, gameId: 'left' });
  assert.equal(frozen.subject.snapshotStatus, 'frozen');
  assert.equal(frozen.analysis.subject.pick, 'A');
  assert.equal(frozen.analysis.outcomes[0].subject.immediatePoints, 7);
  assert.equal(queries.includes('bracket_master_picks'), false);
  tables.bracket_entries[1].rules_snapshot = null;
  const pending = await getBracketGameImplications(user, 'contest1', { entryId: 2, gameId: 'left' });
  assert.equal(pending.readiness, 'snapshot_pending');
  assert.equal(pending.analysis, null);
  assert.equal(queries.includes('bracket_master_picks'), false);
});
test('unknown game, foreign master competition and omitted subject cannot default silently', async () => {
  setup();
  assert.ok('error' in await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'foreign' }));
  const empty = await getBracketGameImplications(user, 'contest1', { gameId: 'left' });
  assert.equal(empty.readiness, 'selection_required');
  assert.equal(empty.subject, null);
  tables.bracket_entries[0].bracket_master_brackets = { ...tables.bracket_entries[0].bracket_master_brackets, competition_id: 2 };
  assert.ok('error' in await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' }));
});
test('persisted results alone confirm advancement, never provider metadata or a live lead', async () => {
  setup(); tables.bracket_games[0].status = 'in_progress'; tables.bracket_games[0].metadata = { providerStatus: 'post', winner: 'A' };
  const pending = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(pending.game.officialWinner, null);
  assert.equal(pending.analysis.outcomes.length, 2);
  tables.bracket_games[0].status = 'final'; tables.bracket_games[0].winner_team_id = 'A';
  const final = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(final.analysis.outcomes.length, 1);
  assert.equal(final.analysis.subject.gamePointsEarned, 3);
  assert.notEqual(final.freshness.resultsVersion, pending.freshness.resultsVersion);
});
test('final points positions use only the authorized contest cohort and remain pending with incomplete snapshots', async () => {
  setup();
  for (const [index, winner] of ['A', 'C', 'C'].entries()) {
    tables.bracket_games[index].status = 'final'; tables.bracket_games[index].winner_team_id = winner;
  }
  tables.bracket_entries.push({ ...tables.bracket_entries[0], id: 99, contest_id: 'other-group' });
  const result = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'final' });
  assert.equal(result.analysis.tournamentComplete, true);
  assert.equal(result.analysis.finalStandings.length, 3);
  assert.equal(result.analysis.finalStandings[0].entryId, 1);
  assert.equal(result.analysis.finalStandings[0].rank, 1);
  assert.ok(result.analysis.finalStandings.slice(1).every(row => row.rank === 2 && row.tied));
  tables.bracket_entries[2].rules_snapshot = null;
  const pending = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'final' });
  assert.equal(pending.analysis.finalStandings, null);
});
test('provider LIVE/final metadata alone never unlocks unauthorized entries or reveals rival facts', async () => {
  setup(); tables.bracket_contests[0].status = 'open'; tables.bracket_contests[0].lock_at = '2099-01-01';
  for (const providerStatus of ['in', 'post']) {
    tables.bracket_games[0].metadata = { providerStatus, completed: providerStatus === 'post', winner: 'A' };
    const personal = await getBracketGameImplications(user, 'contest1', { entryId: 2, gameId: 'left' });
    assert.equal(personal.contestLock.locked, false);
    assert.equal(personal.poolState, 'pre_lock');
    assert.equal(personal.analysis.entryStates.length, 1);
    assert.equal(personal.analysis.otherEntries, null);
    assert.equal(personal.analysis.subject.pointsEarned, 0);
    assert.ok(personal.analysis.exposure.every(row => row.championEntries === null && row.rivalExposure === null));
    assert.ok('error' in await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' }));
  }
});
test('effective schedule deadline exposes only the ready authorized pool and echoes its decision', async () => {
  setup(); tables.bracket_contests[0].status = 'open'; tables.bracket_contests[0].lock_at = '2099-01-01';
  tables.bracket_games[0].scheduled_at = '2020-01-01';
  const result = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(result.contestLock.scope, 'contest');
  assert.equal(result.contestLock.locked, true);
  assert.equal(result.contestLock.status, 'open');
  assert.equal(result.contestLock.effectiveLockAt, '2020-01-01');
  assert.equal(result.poolState, 'available');
  assert.equal(result.analysis.otherEntries, 2);
  tables.bracket_entries[2].picks_snapshot = null;
  const pending = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(pending.contestLock.locked, true);
  assert.equal(pending.poolState, 'freezing');
  assert.equal(pending.analysis.otherEntries, null);
});
test('persisted game start retains the established contest-wide lock safety rule without a provider override in insights', async () => {
  setup(); tables.bracket_contests[0].status = 'open'; tables.bracket_contests[0].lock_at = '2099-01-01';
  tables.bracket_games[0].status = 'in_progress';
  const result = await getBracketGameImplications(user, 'contest1', { entryId: 1, gameId: 'left' });
  assert.equal(result.contestLock.locked, true);
  assert.equal(result.poolState, 'available');
  assert.equal(result.analysis.officialWinner, null);
  assert.equal(result.analysis.subject.pointsEarned, 0);
});
test('one captured clock controls access and pool privacy even when the request spans the deadline', async () => {
  setup(); tables.bracket_contests[0].status = 'open';
  tables.bracket_contests[0].lock_at = '2026-12-20T12:00:00.005Z';
  const RealDate = global.Date; let reads = 0;
  global.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(RealDate.parse('2026-12-20T12:00:00.000Z') + 10 * reads++); }
  };
  try {
    const result = await getBracketGameImplications(user, 'contest1', { entryId: 2, gameId: 'left' });
    assert.equal(result.contestLock.evaluatedAt, '2026-12-20T12:00:00.000Z');
    assert.ok(result.freshness.readAt >= tables.bracket_contests[0].lock_at);
    assert.equal(result.contestLock.locked, false);
    assert.equal(result.poolState, 'pre_lock');
    assert.equal(result.analysis.otherEntries, null);
    assert.ok(result.subjects.every(subject => subject.entrantId === 'managed'));
  } finally { global.Date = RealDate; }
});
