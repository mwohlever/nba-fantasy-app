/* eslint-disable @typescript-eslint/no-require-imports */
/* ESPN-only parser/reducer regression fixtures; no provider requests or database writes. */
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/tests/helpers/scores-harness.cjs');
const { parseGolfTournamentsFromPayload } = require(root + '/lib/providers/golf.ts');
const { reconcileGolfState } = require(root + '/lib/golf/reconcileState.ts');
const { buildGolfSlateRulesSnapshot } = require(root + '/lib/slates/golfSlateRules.ts');
const time = minute => `2026-10-08T12:${minute}:00.000Z`;
function state(gameType) {
  const snapshot = buildGolfSlateRulesSnapshot({ groupSettings: null, selection: {
    gameType, draft: { type: 'snake' }, rosterPeriods: { type: 'full_tournament' },
  } });
  return { slateId: 1, rulesSnapshot: snapshot, penaltyPerRound: 0, teams: [], lineups: [],
    slateTeams: gameType === 'standard' ? [{ team_id: 1, draft_order: 2 }, { team_id: 2, draft_order: 1 }] : [{ team_id: 1, draft_order: 1 }],
    rosters: gameType === 'standard' ? [101, 102].map((id, i) => ({ teamId: i + 1, periods: [{ period: 'full_tournament', playerIds: [id] }] }))
      : [{ teamId: 1, periods: [{ period: 'full_tournament', playerIds: [101, 102] }] }],
    events: [101, 102].map((player_id, i) => ({ id: i + 1, slate_id: 1, player_id, status: 'active', official_score_to_par: null,
      fantasy_score: null, holes_completed: 0, rounds_completed: 0, current_round: 1, last_hole: null, penalty_strokes: 0,
      golf_rounds: [{ id: i + 11, event_player_id: i + 1, round_number: 1, holes_completed: 0, strokes: null,
        score_to_par: null, status: 'scheduled', golf_holes: [] }] })),
  };
}
function batch({ caughtUp = false, aggregatesOnly = false, missingRelativeToPar = false, minute = '10' } = {}) {
  const golfers = [101, 102].map((id, i) => {
    const values = i === 0 ? caughtUp ? [4, 3] : [4] : [4, 4];
    return { id: String(id), athlete: { displayName: `Golfer ${id}` }, score: i === 0 && caughtUp ? '-1' : 'E',
      linescores: [{ period: 1, value: values.reduce((a, b) => a + b, 0), displayValue: i === 0 && caughtUp ? '-1' : 'E',
        linescores: aggregatesOnly ? [] : values.map((value, index) => ({ period: index + 1, value, displayValue: String(value),
          scoreType: missingRelativeToPar && i === 0 && index === 1 ? undefined : { displayValue: value === 4 ? 'E' : '-1' } })) }] };
  });
  const [tournament] = parseGolfTournamentsFromPayload({ events: [{ id: 'fixture', name: 'Scoring dependency fixture',
    competitions: [{ status: { period: 1, type: { state: 'in', name: 'STATUS_IN_PROGRESS' } }, competitors: golfers }] }] });
  return { observedAt: time(minute),
    events: tournament.competitors.map(c => ({ player_id: Number(c.espnPlayerId), official_score_to_par: c.officialScoreToPar,
      holes_completed: c.holesCompleted, rounds_completed: c.roundsCompleted, current_round: c.currentRound, last_hole: c.lastHole, status: c.status })),
    rounds: tournament.competitors.flatMap(c => c.rounds.map(r => ({ event_player_id: Number(c.espnPlayerId) - 100,
      round_number: r.roundNumber, holes_completed: r.holesCompleted, strokes: r.strokes, score_to_par: r.scoreToPar }))),
    holes: tournament.competitors.flatMap(c => c.rounds.flatMap(r => r.holes.map(h => ({ round_id: Number(c.espnPlayerId) - 90,
      hole_number: h.holeNumber, strokes: h.strokes, relative_to_par: h.relativeToPar,
      reconciliation: { source: 'espn', observedAt: time(minute), final: h.strokes != null && h.relativeToPar != null } })))),
  };
}
function persisted(base, result) {
  return { ...base, events: result.events, teams: result.teamRows };
}
function historical(gameType, finalized = false) {
  const base = state(gameType);
  // Already accepted records from before retirement; never acquire or reconstruct them.
  for (const [i, event] of base.events.entries()) {
    const values = i === 0 ? [4, 3] : [4, 4];
    const round = event.golf_rounds[0];
    round.golf_holes = values.map((strokes, index) => ({ hole_number: index + 1, strokes, relative_to_par: strokes - 4,
      reconciliation: { source: i === 0 && index === 1 ? 'shotcast' : 'espn', observedAt: time('09'), final: true } }));
    Object.assign(round, { holes_completed: 2, strokes: values.reduce((a, b) => a + b, 0), score_to_par: i === 0 ? -1 : 0,
      status: 'active', accepted_revision: 7, reconciliation: { source: 'espn', observedAt: time('09') } });
    Object.assign(event, { official_score_to_par: i === 0 ? -1 : 0, fantasy_score: i === 0 ? -1 : 0,
      holes_completed: 2, last_hole: 2, reconciliation: { source: 'espn', observedAt: time('09') } });
  }
  if (finalized) {
    for (const [i, event] of base.events.entries()) {
      event.golf_rounds = [1, 2, 3, 4].map(roundNumber => ({
        id: i + 11 + (roundNumber - 1) * 100, event_player_id: event.id, round_number: roundNumber,
        holes_completed: 18, strokes: i === 0 && roundNumber === 1 ? 71 : 72,
        score_to_par: i === 0 && roundNumber === 1 ? -1 : 0, status: 'finished', accepted_revision: 7,
        reconciliation: { source: 'espn', observedAt: time('09') },
        golf_holes: Array.from({ length: 18 }, (_, holeIndex) => ({ hole_number: holeIndex + 1,
          strokes: i === 0 && roundNumber === 1 && holeIndex === 1 ? 3 : 4,
          relative_to_par: i === 0 && roundNumber === 1 && holeIndex === 1 ? -1 : 0,
          reconciliation: { source: i === 0 && roundNumber === 1 && holeIndex === 1 ? 'shotcast' : 'espn',
            observedAt: time('09'), final: true } })),
      }));
      Object.assign(event, { status: 'finished', holes_completed: 72, rounds_completed: 4, current_round: 4, last_hole: 18 });
    }
  }
  const accepted = reconcileGolfState(base, { observedAt: time('09'), holes: [] }, 7);
  return persisted(base, accepted);
}

for (const game of ['standard', 'best_ball']) {
  test(`${game}: delayed ESPN updates converge without supplementary observations`, () => {
    const base = state(game), delayed = batch();
    assert.ok(delayed.holes.every(hole => hole.reconciliation.source === 'espn'));
    const first = reconcileGolfState(base, delayed, 1);
    const team = first.teamRows.find(team => team.team_id === 1);
    assert.equal(team.fantasy_points, 0);
    assert.equal(first.events[0].golf_rounds[0].golf_holes.length, 1);
    if (game === 'standard') assert.equal(team.finish_position, 2);
    else {
      const hole = team.bestBallRounds[0].holes[1];
      assert.equal(hole.status, 'provisional'); assert.deepEqual(hole.unresolvedPlayerIds, [101]);
      assert.equal(hole.strokes, 4); assert.deepEqual(hole.contributorPlayerIds, [102]);
      assert.equal(team.games_in_progress, 1);
      assert.equal(team.bestBallRounds[0].holes[2].status, 'unscored');
      assert.equal(team.bestBallRounds[0].holes[2].strokes, null);
    }
    const later = reconcileGolfState(persisted(base, first), batch({ caughtUp: true, minute: '12' }), 2);
    const caughtUp = later.teamRows.find(team => team.team_id === 1);
    assert.equal(caughtUp.fantasy_points, -1);
    assert.equal(later.events[0].golf_rounds[0].golf_holes.length, 2);
    if (game === 'standard') assert.equal(caughtUp.finish_position, 1);
    else {
      const hole = caughtUp.bestBallRounds[0].holes[1];
      assert.equal(hole.status, 'final'); assert.equal(hole.strokes, 3);
      assert.deepEqual(hole.contributorPlayerIds, [101]); assert.equal(caughtUp.games_in_progress, 0);
    }
    const repeated = reconcileGolfState(persisted(base, later), batch({ caughtUp: true, minute: '13' }), 3);
    assert.deepEqual(repeated.teamRows, later.teamRows);
    assert.equal(repeated.scoringChanged, false); assert.equal(repeated.teamWrites.length, 0);
  });

  test(`${game}: partial or stale ESPN preserves accepted legacy scores and later confirms them`, () => {
    const prior = historical(game), before = structuredClone(prior);
    const partial = reconcileGolfState(prior, batch({ minute: '12' }), 8);
    assert.equal(partial.events[0].golf_rounds[0].golf_holes.find(h => h.hole_number === 2).strokes, 3);
    assert.equal(partial.events[0].golf_rounds[0].golf_holes.find(h => h.hole_number === 2).reconciliation.source, 'shotcast');
    assert.deepEqual(partial.teamRows, prior.teams); assert.equal(partial.scoringChanged, false);
    const stale = reconcileGolfState(prior, batch({ caughtUp: true, minute: '08' }), 8);
    assert.equal(stale.holeWrites.length, 0); assert.deepEqual(stale.teamRows, prior.teams);
    const complete = reconcileGolfState(prior, batch({ caughtUp: true, minute: '12' }), 8);
    assert.equal(complete.events[0].golf_rounds[0].golf_holes.find(h => h.hole_number === 2).reconciliation.source, 'espn');
    assert.deepEqual(complete.teamRows, prior.teams); assert.equal(complete.scoringChanged, false);
    assert.equal(complete.teamWrites.length, 0);
    assert.deepEqual(prior, before, 'pure reconciliation does not mutate input historical records');
  });

  test(`${game}: incomplete ESPN cannot rewrite finalized historical results`, () => {
    const finalState = historical(game, true);
    const result = reconcileGolfState(finalState, batch({ minute: '12' }), 8);
    assert.deepEqual(result.teamRows, finalState.teams);
    assert.equal(result.teamWrites.length, 0); assert.equal(result.scoringChanged, false);
    assert.ok(result.events.every(event => event.status === 'finished'));
    assert.equal(result.events[0].fantasy_score, -1);
    assert.equal(result.events[0].golf_rounds[0].score_to_par, -1);
    assert.equal(result.events[0].golf_rounds[0].accepted_revision, 7);
  });
}

test('aggregate-only ESPN data cannot invent Best Ball hole values or finality', () => {
  const result = reconcileGolfState(state('best_ball'), batch({ aggregatesOnly: true }), 1);
  assert.equal(result.teamRows[0].fantasy_points, null);
  assert.equal(result.teamRows[0].games_completed, 0);
  assert.equal(result.teamRows[0].games_remaining, 72);
  assert.ok(result.teamRows[0].bestBallRounds.every(round => round.holes.every(hole => hole.status === 'unscored' && hole.strokes === null)));
});

test('ESPN holes with missing relative-to-par stay pending until the complete update arrives', () => {
  const base = state('best_ball'), incomplete = batch({ caughtUp: true, missingRelativeToPar: true });
  const hole = incomplete.holes.find(hole => hole.round_id === 11 && hole.hole_number === 2);
  assert.equal(hole.relative_to_par, null); assert.equal(hole.reconciliation.final, false);
  const first = reconcileGolfState(base, incomplete, 1);
  assert.equal(first.events[0].golf_rounds[0].golf_holes.length, 1);
  assert.equal(first.teamRows[0].bestBallRounds[0].holes[1].status, 'provisional');
  assert.equal(first.teamRows[0].fantasy_points, 0);
  const later = reconcileGolfState(persisted(base, first), batch({ caughtUp: true, minute: '12' }), 2);
  assert.equal(later.teamRows[0].bestBallRounds[0].holes[1].status, 'final');
  assert.equal(later.teamRows[0].fantasy_points, -1);
});
