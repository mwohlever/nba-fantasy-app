const assert = require('node:assert/strict');
const test = require('node:test');
require('./helpers/scores-harness.cjs');
const { buildGolfSlateRulesSnapshot } = require('../lib/slates/golfSlateRules.ts');
const { resolveGolfScoringRosters } = require('../lib/golf/rosterResolution.ts');
const { calculateGolfCompetition } = require('../lib/golf/competition.ts');
const events = [1, 2, 3].map(id => ({ player_id: id, fantasy_score: -4 * id, status: 'finished',
  golf_rounds: [1, 2, 3, 4].map(round_number => ({ round_number, holes_completed: 18, score_to_par: -id,
    golf_holes: [{ hole_number: 1, strokes: 4 - id, relative_to_par: -id }] })) }));
function setup(gameType, draft, split, weekend = [2]) {
  const snapshot = buildGolfSlateRulesSnapshot({ groupSettings: null,
    selection: { gameType, draft: { type: draft }, rosterPeriods: { type: split ? 'split_after_round_2' : 'full_tournament' } } });
  const first = split ? 'opening' : 'full_tournament';
  const salaryCap = [{ team_id: 1, period_key: first, player_ids: [1] }, ...(split ? [{ team_id: 1, period_key: 'weekend', player_ids: weekend }] : [])];
  const rosters = resolveGolfScoringRosters({ snapshot, teamIds: [1], snake: [{ team_id: 1, lineup_players: [{ player_id: 1 }] }], salaryCap,
    snakePeriods: split ? [{ team_id: 1, period_key: 'weekend', player_ids: weekend }] : [] });
  return { slateId: 9, snapshot, rosters, events, slateTeams: [{ team_id: 1, draft_order: 1 }], penaltyPerRound: 0 };
}
for (const game of ['standard', 'best_ball']) for (const draft of ['snake', 'salary_cap']) for (const split of [false, true]) {
  test(`${game} / ${draft} / ${split ? 'Split' : 'Full'} production scoring`, () => {
    const input = setup(game, draft, split);
    const result = calculateGolfCompetition(input)[0];
    assert.equal(result.fantasy_points, split ? -6 : -4);
    assert.equal(result.contributions.reduce((sum, c) => sum + (c.score ?? 0), 0), result.fantasy_points);
    if (game === 'best_ball') {
      assert.equal(result.contributions[0].countingHoles, split ? 2 : 4);
      assert.deepEqual(result.bestBallRounds.map(round => round.period), split ? ['opening', 'opening', 'weekend', 'weekend'] : Array(4).fill('full_tournament'));
    }
    if (draft === 'salary_cap') {
      input.snapshot.draft.salaryCap = 150;
      assert.deepEqual(calculateGolfCompetition(input)[0], result, 'budget cannot affect fantasy score');
    }
    if (split) {
      const changed = calculateGolfCompetition(setup(game, draft, true, [3]))[0];
      assert.deepEqual(changed.contributions[0], result.contributions[0], 'Weekend never rewrites Opening');
      assert.equal(changed.fantasy_points, -8);
      const repeated = calculateGolfCompetition(setup(game, draft, true, [1]))[0];
      assert.equal(repeated.fantasy_points, -4, 'independently selecting same golfer counts only applicable rounds');
      const missing = calculateGolfCompetition(setup(game, draft, true, []))[0];
      assert.equal(missing.fantasy_points, -2, 'no automatic Opening carry-forward');
    }
  });
}

test('split opening roster does not receive missed-cut penalties for rounds three and four', () => {
  const snapshot = buildGolfSlateRulesSnapshot({ groupSettings: null,
    selection: { gameType: 'standard', draft: { type: 'snake' }, rosterPeriods: { type: 'split_after_round_2' } } });
  const rosters = resolveGolfScoringRosters({ snapshot, teamIds: [1],
    snake: [{ team_id: 1, lineup_players: [{ player_id: 1 }] }], snakePeriods: [{ team_id: 1, period_key: 'weekend', player_ids: [] }], salaryCap: [] });
  const event = { player_id: 1, status: 'cut', fantasy_score: 1, penalty_strokes: 2,
    golf_rounds: [{ round_number: 1, holes_completed: 18, score_to_par: -2 }, { round_number: 2, holes_completed: 18, score_to_par: 1 }] };
  const result = calculateGolfCompetition({ slateId: 9, snapshot, events: [event], rosters,
    slateTeams: [{ team_id: 1, draft_order: 1 }], penaltyPerRound: 1 })[0];
  assert.equal(result.contributions[0].score, -1);
  assert.equal(result.fantasy_points, -1);
  assert.equal(result.contributions.some(contribution => contribution.period === 'opening' && contribution.score === 1), false);
});
