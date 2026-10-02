/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const Module = require('node:module');
let group = 'a';
const queries = [];
const slates = [1, 2].map(id => ({ id, sport: 'golf', archived_at: id === 1 ? '2026-01-01' : null, league_id: 'league-a', external_event_id: String(100 + id), start_date: '2025-08-21', end_date: '2025-08-24', date: '2025-08-21', is_locked: true, display_name: `Tournament ${id}`, has_cut: false, rules_snapshot: null }));
slates.push({ ...slates[1], id: 3, league_id: 'league-b', external_event_id: '102' });
const rows = {
  slates,
  teams: [{ id: 10, group_id: 'a', name: 'Team A', user_id: 'viewer-a' }, { id: 20, group_id: 'b', name: 'Team B', user_id: 'viewer-b' }],
  group_memberships: [{ group_id: 'a', user_id: 'viewer-a', is_active: true }, { group_id: 'b', user_id: 'viewer-b', is_active: true }],
  team_slate_results: [], slate_teams: [],
  golf_event_players: slates.map(slate => ({ id: slate.id * 1000, slate_id: slate.id, player_id: 7, leaderboard_order: 1, official_score_to_par: -4, status: 'finished', current_round: 4, holes_completed: 72, rounds_completed: 4 })),
  golf_players: [{ id: 7, display_name: 'Same golfer', short_name: 'Same', espn_player_id: '123' }],
  lineups: [{ id: 10, slate_id: 1, team_id: 10 }, { id: 20, slate_id: 2, team_id: 10 }, { id: 30, slate_id: 3, team_id: 20 }],
  lineup_players: [{ lineup_id: 10, player_id: 7 }, { lineup_id: 30, player_id: 7 }], golf_rounds: [],
};
const db = { from(table) {
  const filters = []; queries.push({ table, filters });
  const q = { select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, or(value) { filters.push(['or', value]); return q; },
    is(key, value) { filters.push([key, value]); return q; }, order() { return q; }, in(key, values) { filters.push([key, values]); return q; },
    then(resolve) { return Promise.resolve({ error: null, data: (rows[table] ?? []).filter(row => filters.every(([key, value]) => (key === 'or' ? row.archived_at == null || row.external_event_id === value.split('external_event_id.eq.')[1] : (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)))) }).then(resolve); } };
  return q;
} };
const original = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request === '@/lib/auth') return { getCurrentUser: async () => ({ id: `viewer-${group}` }) };
  if (request === '@/lib/groups/context') return { getActiveLeagueForSport: async () => ({ context: { group: { id: group }, team: { id: group === 'a' ? 10 : 20 } }, league: { id: `league-${group}` } }) };
  if (request === '@/lib/supabaseAdmin') return { supabaseAdmin: db };
  if (request === '@/lib/golf/fantasy.server') return { loadGolfFantasy() {}, loadGolfRosters() {} };
  return original.call(this, request, parent, ...rest);
};
const { getGolfHomeSummary } = require('../lib/home/golfHomeSummary.ts');
Module._load = original;

test('Live queries use selected tournament slate, ownership isolation, Group scope, archived history and reject malformed IDs', async () => {
  group = 'a';
  const owned = await (await getGolfHomeSummary({ liveOnly: true, requestedEventId: '101' })).json();
  assert.equal(owned.latestSlate.id, 1);
  assert.equal(owned.tournamentLeaderboard[0].isCurrentUser, true);
  assert.deepEqual(owned.tournamentLeaderboard[0].draftedBy, ['Team A']);
  const other = await (await getGolfHomeSummary({ liveOnly: true, requestedEventId: '102' })).json();
  assert.equal(other.latestSlate.id, 2);
  assert.equal(other.tournamentLeaderboard[0].isCurrentUser, false, 'same golfer is not owned in another tournament');
  assert.deepEqual(other.tournamentLeaderboard[0].draftedBy, []);
  const missing = await (await getGolfHomeSummary({ liveOnly: true, requestedEventId: '999' })).json();
  assert.equal(missing.latestSlate, null);
  assert.deepEqual(missing.tournamentLeaderboard, []);
  group = 'b';
  const switched = await (await getGolfHomeSummary({ liveOnly: true, requestedEventId: '102' })).json();
  assert.equal(switched.latestSlate.id, 3);
  assert.deepEqual(switched.tournamentLeaderboard[0].draftedBy, ['Team B']);
  assert.ok(queries.some(q => q.table === 'slates' && q.filters.some(([key, value]) => key === 'external_event_id' && value === '102')));
  assert.equal((await getGolfHomeSummary({ liveOnly: true, requestedEventId: 'bad' })).status, 400);
});
