const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
require('./helpers/scores-harness.cjs');
let version = 0, playerId = 1, calls = [];
const events = [1, 2].map(id => ({ id, player_id: id, fantasy_score: -id, status: 'active', golf_rounds: [] }));
const db = {
  from(table) {
    const query = { select() { return query; }, eq() { return query; }, maybeSingle() { return query; }, single() { return query; },
      then(resolve) {
        const data = table === 'golf_accepted_versions' ? { revision: version }
          : table === 'golf_event_players' ? events
          : table === 'slates' ? { sport: 'golf', has_cut: false, rules_snapshot: null }
          : table === 'lineups' ? [{ team_id: 1, lineup_players: [{ player_id: playerId }] }]
          : table === 'slate_teams' ? [{ team_id: 1, draft_order: 1 }]
          : table === 'golf_roster_periods' ? [{ period_key: 'full_tournament', revision: 0, group_id: 'group', league_id: 'league' }]
          : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      } }; return query;
  },
  async rpc(name, args) {
    calls.push({ name, args });
    if (calls.length === 1) { playerId = 2; version++; return { data: { conflict: true }, error: null }; }
    assert.equal(args.p_expected_revision, version);
    return { data: { revision: ++version }, error: null };
  },
};
const original = Module._load;
Module._load = function(request, ...args) { return request.endsWith('supabaseAdmin') ? { supabaseAdmin: db } : original.call(this, request, ...args); };
const { reconcileGolf } = require('../lib/golf/reconcileGolf.ts');
Module._load = original;
test('production refresh retries a changed roster and publishes only the winning revision', async () => {
  const result = await reconcileGolf(9, { observedAt: '2026-09-12T00:00:00Z', holes: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'commit_golf_reconciliation_with_lifecycle');
  assert.equal(calls[0].args.p_teams[0].fantasy_points, -1);
  assert.equal(calls[1].args.p_teams[0].fantasy_points, -2);
  assert.equal(result.teamWrites[0].fantasy_points, -2);
  assert.equal(result.revision, 2);
});
