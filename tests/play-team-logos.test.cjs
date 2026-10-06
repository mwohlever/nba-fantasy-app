/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const { host, nodes } = require('./helpers/scores-harness.cjs');
const fixture = require('./fixtures/play-team-logos.json');
const { footballDisplayTeamId, nbaDisplayTeamId, resolvePlayLogoTeam } = require('../lib/live-scores/playTeamLogo.ts');
const { normalizeNbaPlays, nbaFullCourtMarker } = require('../lib/live-scores/nbaPlays.ts');
const { footballPlaysByQuarter } = require('../lib/live-scores/football-plays.ts');
const { normalizeFootballVisualizationPlay } = require('../lib/live-scores/footballPlayVisualization.ts');
const Pbp = require('../components/live-scores/FootballPlayByPlay.tsx').default;
const Field = require('../components/live-scores/FootballPlayField.tsx').default;
const Logo = require('../components/live-scores/PlayTeamLogo.tsx').default;
const teams = game => game.header.competitions[0].competitors.map(c => ({ id: c.team.id, logo: c.team.logos[0].href }));
const rawPlays = game => game.drives.previous.flatMap(d => d.plays);

for (const sport of ['nfl', 'ncaa']) {
  test(`${sport}: captured ordinary plays retain the structured start offense`, () => {
    const game = fixture[sport], ps = rawPlays(game), ts = teams(game);
    for (const type of ['Pass Reception', 'Pass Incompletion', 'Rush', 'Sack', 'Pass Interception Return',
      'Fumble Recovery (Opponent)', 'Fumble Return Touchdown', 'Punt', 'Field Goal Good']) {
      const p = ps.find(p => p.type.text === type);
      // This capture need not contain every event; the combined captures do.
      if (!p) continue;
      assert.equal(footballDisplayTeamId(p, ts), p.start.team.id, `${type}: ${p.id}`);
      assert.equal(footballDisplayTeamId({ ...p, isTurnover: !p.isTurnover, isPenalty: true,
        text: 'Unrelated player/team text; review and penalty information' }, ts), p.start.team.id);
    }
    const interception = ps.find(p => p.type.text === 'Pass Interception Return');
    assert.notEqual(interception.start.team.id, interception.end.team.id);
    assert.equal(footballDisplayTeamId(interception, ts), interception.start.team.id);
    const td = ps.find(p => p.type.text === 'Fumble Return Touchdown');
    assert.equal(footballDisplayTeamId({ ...td, team: td.end.team }, ts), td.start.team.id);
  });

  test(`${sport}: captured kickoffs, standalone penalties, timeouts and transitions are blank`, () => {
    const game = fixture[sport], ps = rawPlays(game), ts = teams(game);
    for (const type of ['Kickoff', 'Penalty', 'Timeout', 'End Period']) {
      const matches = ps.filter(p => p.type.text === type);
      assert.ok(matches.length, type);
      for (const p of matches) assert.equal(footballDisplayTeamId(p, ts), null, p.id);
    }
    const base = ps.find(p => p.type.text === 'Rush');
    for (const type of ['Review', 'Official Timeout', 'Two-minute warning', 'Start Period', 'End of Half', 'End of Game', 'Kickoff Return Touchdown']) {
      assert.equal(footballDisplayTeamId({ ...base, type: { text: type } }, ts), null);
    }
  });
}

test('captured blocked defensive score, reviewed play, incorrect turnover flag and kickoff fumble', () => {
  for (const key of ['blocked', 'reviewed', 'badTurnover', 'missedFieldGoal', 'twoPoint']) {
    const { play, teams } = fixture.edgeCases[key];
    assert.equal(footballDisplayTeamId(play, teams), play.start.team.id, key);
  }
  const { play, teams } = fixture.edgeCases.kickoffFumble;
  assert.equal(play.type.text, 'Fumble Recovery (Own)');
  assert.equal(play.start.down, 0);
  assert.equal(footballDisplayTeamId(play, teams), null);
});

test('football association fails closed for malformed, conflicting or unsupported facts', () => {
  const ts = teams(fixture.nfl), p = rawPlays(fixture.nfl).find(p => p.type.text === 'Rush');
  for (const id of [undefined, null, '', 'unknown', '999999', {}, 16, ' 16']) {
    assert.equal(footballDisplayTeamId({ ...p, start: { ...p.start, team: { id } } }, ts), null);
  }
  for (const down of [undefined, null, '1', 0, 5, 1.5, NaN]) {
    assert.equal(footballDisplayTeamId({ ...p, start: { ...p.start, down } }, ts), null);
  }
  assert.equal(footballDisplayTeamId({ ...p, type: { id: '53', text: 'Rush' } }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, type: { id: '999', text: 'Future play' } }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, type: { id: '999' } }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, type: { id: 5 } }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, teamParticipants: [{ type: 'offense', id: ts.find(t => t.id !== p.start.team.id).id }] }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, teamParticipants: [p.teamParticipants[0], p.teamParticipants[0]] }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, teamParticipants: [null] }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, teamParticipants: null }, ts), null);
  assert.equal(footballDisplayTeamId({ ...p, teamParticipants: [...p.teamParticipants].reverse() }, ts), p.start.team.id);
});

test('NBA captured clear event categories use ESPN event team, independent of descriptions', () => {
  const ts = teams(fixture.nba), ps = normalizeNbaPlays(fixture.nba.plays);
  const samples = [
    ps.find(p => p.shootingPlay && p.pointsAttempted > 1 && p.scoringPlay),
    ps.find(p => p.shootingPlay && p.pointsAttempted > 1 && !p.scoringPlay),
    ps.find(p => p.text.includes('blocks')),
    ps.find(p => p.isFreeThrow),
    ps.find(p => /Turnover/.test(p.type) && p.text.includes('steals')),
    ps.find(p => /Rebound/.test(p.type)), ps.find(p => /Foul/.test(p.type)),
    ps.find(p => p.type === 'Offensive Charge'),
    ps.find(p => p.type === 'Substitution'), ps.find(p => p.type === 'Full Timeout'),
    ps.find(p => p.type.startsWith("Coach's Challenge")),
  ];
  for (const p of samples) {
    assert.ok(p);
    assert.equal(nbaDisplayTeamId(p, ts), p.teamId, p.type);
    assert.equal(nbaDisplayTeamId({ ...p, text: 'Opponent steals, blocks, scores, calls timeout' }, ts), p.teamId);
  }
  const turnover = samples[4];
  assert.equal(turnover.teamId, '5'); // Mitchell loses possession despite White's steal.
  const blocked = samples[2];
  const raw = fixture.nba.plays.find(p => p.id === blocked.id);
  assert.equal(blocked.teamId, raw.team.id); // Never substitute the blocker's team.
});

test('NBA neutral/malformed events stay blank without modifying the existing teamId', () => {
  const ts = teams(fixture.nba), ps = normalizeNbaPlays(fixture.nba.plays);
  for (const type of ['Jumpball', 'End Period', 'End Game', 'Ref-Initiated Review (Supported)']) {
    const p = ps.find(p => p.type === type);
    assert.ok(p, type);
    const before = structuredClone(p);
    assert.equal(nbaDisplayTeamId(p, ts), null);
    assert.deepEqual(p, before);
    assert.equal(nbaDisplayTeamId({ ...p, teamId: ts[0].id, shootingPlay: true }, ts), null);
  }
  const p = ps.find(p => p.shootingPlay);
  for (const id of [undefined, null, '', 'unknown', '999', 2, {}, ' 2']) assert.equal(nbaDisplayTeamId({ ...p, teamId: id }, ts), null);
  for (const type of [null, '', 'Future event', 'Start Game', 'Start Period']) assert.equal(nbaDisplayTeamId({ ...p, shootingPlay: false, type }, ts), null);
});

test('resolution requires two distinct current-game teams; blank/broken images keep their slot', () => {
  const ts = teams(fixture.nba);
  assert.equal(resolvePlayLogoTeam(ts[0].id, ts), ts[0]);
  for (const invalid of [[], [ts[0]], [ts[0], ts[0]], [ts[0], { id: 'bad' }]]) assert.equal(resolvePlayLogoTeam(ts[0].id, invalid), null);
  const empty = Logo({ team: null }), missing = Logo({ team: { ...ts[0], logo: null } }), filled = Logo({ team: ts[0] });
  assert.equal(empty.props.className, filled.props.className);
  assert.equal(missing.props.className, filled.props.className);
  const img = filled.props.children;
  assert.equal(img.props.src, ts[0].logo);
  assert.equal(img.props.width, 20); assert.equal(img.props.height, 20);
  const target = { style: {} }; img.props.onError({ currentTarget: target });
  assert.equal(target.style.visibility, 'hidden');
});

test('association leaves provider plays, IDs, counts, order, filtering and replay facts unchanged', () => {
  for (const sport of ['nfl', 'ncaa']) {
    const game = fixture[sport], before = structuredClone(game), ts = teams(game);
    const grouped = footballPlaysByQuarter(game.drives.previous);
    const replay = rawPlays(game).map(p => normalizeFootballVisualizationPlay(p));
    rawPlays(game).forEach(p => footballDisplayTeamId(p, ts));
    assert.deepEqual(game, before);
    assert.deepEqual(footballPlaysByQuarter(game.drives.previous), grouped);
    assert.deepEqual(rawPlays(game).map(p => normalizeFootballVisualizationPlay(p)), replay);
  }
  const plays = normalizeNbaPlays(fixture.nba.plays), before = structuredClone(plays), ts = teams(fixture.nba);
  const context = { homeTeamId: '2', awayTeamId: '5' }, court = plays.map(p => nbaFullCourtMarker(p, context));
  plays.forEach(p => nbaDisplayTeamId(p, ts));
  assert.deepEqual(plays, before);
  assert.deepEqual(plays.map(p => nbaFullCourtMarker(p, context)), court);
});

test('football rows gain logos without changing selection or quarter state', () => {
  const game = fixture.nfl, ts = teams(game), drives = game.drives.previous;
  const h = host(Pbp), props = { drives, isLive: false, initialPeriod: 1, offenseNames: { '16': 'MIN', '4': 'CIN' } };
  const before = h.render(props);
  const after = h.render({ ...props, teams: ts });
  const replay = tree => nodes(tree).find(n => n.type === Field).props;
  assert.deepEqual(replay(after), replay(before));
  const rows = tree => nodes(tree).filter(n => n.type === 'button' && n.key?.includes('-'));
  assert.deepEqual(rows(after).map(n => n.key), rows(before).map(n => n.key));
  const row = rows(after)[0]; row.props.onClick();
  const selected = h.render({ ...props, teams: ts });
  const withoutLogos = h.render(props);
  assert.deepEqual(replay(selected), replay(withoutLogos));
  assert.ok(nodes(selected).some(n => n.type === Logo && n.props.team));
  h.unmount();
});
