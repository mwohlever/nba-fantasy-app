/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'); const test = require('node:test'); const fs = require('node:fs'); const path = require('node:path'); const Module = require('node:module'); const ts = require('typescript');
const root = path.resolve(__dirname, '..'); const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = function(module, filename) { module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename); };
const { normalizeFootballVisualizationPlay, footballEndZoneLabels, footballPuntCoordinates, footballPuntSvgGeometry, footballSelectedPlayContext, footballTeamAttackDirection, namedYardlineToMatchupPosition, nextFootballResultingState, orientFootballVisualizationPlay, withFootballResultingState } = require('../lib/live-scores/footballPlayVisualization.ts');
const play = (overrides = {}) => ({ id: 'nfl-1', type: { id: '5', text: 'Rush' }, text: 'Runner left tackle for 7 yards', period: { number: 2 }, clock: { displayValue: '8:42' }, start: { team: { id: '1' }, yardsToEndzone: 66, down: 2, distance: 7, shortDownDistanceText: '2nd & 7' }, end: { team: { id: '1' }, yardsToEndzone: 59 }, ...overrides });

test('shared football model uses yardsToEndzone and builds factual run/sack coordinates', () => {
  const run = normalizeFootballVisualizationPlay(play()); assert.equal(run.start, 34); assert.equal(run.end, 41); assert.equal(run.firstDown, 41); assert.equal(run.animation, 'run');
  const loss = normalizeFootballVisualizationPlay(play({ text: 'Runner left tackle for -4 yards', start: { team: { id: '1' }, yardsToEndzone: 60, down: 1, distance: 10 }, end: { team: { id: '1' }, yardsToEndzone: 64 } })); assert.equal(loss.start, 40); assert.equal(loss.end, 36);
  const scramble = normalizeFootballVisualizationPlay(play({ type: { text: 'Rush' }, text: 'QB scrambles right for 9 yards' })); assert.equal(scramble.family, 'scramble');
  const sack = normalizeFootballVisualizationPlay(play({ type: { text: 'Sack' }, text: 'QB sacked for -8 yards' })); assert.equal(sack.animation, 'sack');
});
test('touchdowns, goal-to-go and field goals are typed without trusting endpoint sentinels', () => {
  const td = normalizeFootballVisualizationPlay(play({ type: { id: '68', text: 'Rushing Touchdown' }, text: 'Runner touchdown', scoringPlay: true, scoringType: { name: 'touchdown' }, start: { team: { id: '1' }, yardsToEndzone: 3, down: 1, distance: 3 }, end: { team: { id: '1' }, yardsToEndzone: 15 } })); assert.equal(td.end, 100); assert.equal(td.firstDown, null); assert.equal(td.animation, 'run'); assert.equal(td.animate, true); assert.equal(td.scoring, 'touchdown');
  const fg = normalizeFootballVisualizationPlay(play({ type: { id: '60', text: 'Field Goal Missed' }, text: 'Kicker 48 yard field goal is No Good' })); assert.equal(fg.animation, 'field-goal'); assert.equal(fg.animate, true); assert.equal(fg.scoring, 'field-goal-missed'); assert.equal(fg.firstDown, null);
  const goodFg = normalizeFootballVisualizationPlay(play({ type: { id: '59', text: 'Field Goal Good' }, text: 'Kicker 31 yard field goal is GOOD', scoringPlay: true })); assert.equal(goodFg.renderMode, 'animated'); assert.equal(goodFg.animation, 'field-goal'); assert.equal(goodFg.scoring, 'field-goal-good');
  const unsupportedAttempt = normalizeFootballVisualizationPlay(play({ type: { id: '59', text: 'Field Goal Attempt' }, text: 'Kicker 48 yard field goal attempt aborted' })); assert.equal(unsupportedAttempt.renderMode, 'semantic'); assert.equal(unsupportedAttempt.semanticLabel, 'FIELD GOAL ATTEMPT');
});
test('NFL pass result uses only factual start/end and optional text labels', () => {
  const pass = normalizeFootballVisualizationPlay(play({ type: { id: '24', text: 'Pass Reception' }, text: '(Shotgun) C.Stroud pass short left to N.Collins for 28 yards', start: { team: { id: '34' }, yardsToEndzone: 76, down: 2, distance: 11 }, end: { team: { id: '34' }, yardsToEndzone: 48 } }));
  assert.equal(pass.animation, 'pass'); assert.equal(pass.qualifier, 'SHORT LEFT'); assert.equal(pass.start, 24); assert.equal(pass.end, 52);
  assert.equal('catchPoint' in pass, false); assert.equal('airYards' in pass, false); assert.equal('yac' in pass, false);
  const td = normalizeFootballVisualizationPlay(play({ type: { id: '67', text: 'Passing Touchdown' }, text: 'Pass deep middle for 75 yards, TOUCHDOWN', scoringPlay: true, scoringType: { name: 'touchdown' }, start: { team: { id: '34' }, yardsToEndzone: 75 }, end: { team: { id: '34' }, yardsToEndzone: 15 } })); assert.equal(td.qualifier, 'DEEP MIDDLE'); assert.equal(td.end, 100); assert.equal(td.animation, 'pass'); assert.equal(td.animate, true); assert.equal(td.scoring, 'touchdown');
  const incomplete = normalizeFootballVisualizationPlay(play({ type: { id: '3', text: 'Pass Incompletion' }, text: 'Pass incomplete short right', end: { team: { id: '1' }, yardsToEndzone: 66 } })); assert.equal(incomplete.animation, 'incomplete'); assert.equal(incomplete.qualifier, null);
});
test('NCAA-compatible payloads normalize and possession-changing plays fail closed', () => {
  const ncaa = normalizeFootballVisualizationPlay(play({ id: '401551786102946401', type: { id: '24', text: 'Pass Reception' }, text: 'J.J. McCarthy pass complete to Roman Wilson for 20 yds', start: { team: { id: '130' }, yardsToEndzone: 58, down: 1, distance: 10 }, end: { team: { id: '130' }, yardsToEndzone: 38 } })); assert.equal(ncaa.start, 42); assert.equal(ncaa.end, 62); assert.equal(ncaa.qualifier, null);
  const turnover = normalizeFootballVisualizationPlay(play({ type: { id: '26', text: 'Pass Interception Return' }, text: 'Pass intercepted return for 23 yards', isTurnover: true, start: { team: { id: '1' }, yardsToEndzone: 26 }, end: { team: { id: '2' }, yardsToEndzone: 63 } })); assert.equal(turnover.possessionChanged, true); assert.equal(turnover.animation, 'none'); assert.equal(turnover.confidence, 'result-only'); assert.equal(turnover.animate, false); assert.equal(turnover.renderMode, 'semantic'); assert.equal(turnover.semanticLabel, 'INTERCEPTION');
  const punt = normalizeFootballVisualizationPlay(play({ type: { id: '52', text: 'Punt' }, text: 'Punter punts 50 yards, fair catch', start: { team: { id: '1' }, yardsToEndzone: 60, down: 4, distance: 8 }, end: { team: { id: '2' }, yardsToEndzone: 80 } })); assert.equal(punt.animation, 'punt'); assert.equal(punt.animate, true); assert.equal(punt.start, 40); assert.equal(punt.end, 80); assert.equal(punt.firstDown, null); assert.equal(punt.renderMode, 'animated');
  const kickoff = normalizeFootballVisualizationPlay(play({ type: { id: '53', text: 'Kickoff' }, text: 'Kicker kicks 65 yards', start: { team: { id: '1' }, yardsToEndzone: 65, down: 4, distance: 8 }, end: { team: { id: '2' }, yardsToEndzone: 80 } })); assert.equal(kickoff.animate, false); assert.equal(kickoff.renderMode, 'semantic'); assert.equal(kickoff.firstDown, null); assert.equal(kickoff.semanticLabel, 'KICKOFF');
});
test('stable matchup orientation mirrors provider facts only for the home offense', () => {
  assert.equal(footballTeamAttackDirection('home', 'home', 'away'), 'left');
  assert.equal(footballTeamAttackDirection('away', 'home', 'away'), 'right');
  assert.equal(footballTeamAttackDirection('other', 'home', 'away'), null);
  const homeRun = normalizeFootballVisualizationPlay(play({ start: { team: { id: 'home' }, yardsToEndzone: 66, down: 3, distance: 7, shortDownDistanceText: '3rd & 7' }, end: { team: { id: 'home' }, yardsToEndzone: 59 } }));
  const awayRun = normalizeFootballVisualizationPlay(play({ start: { team: { id: 'away' }, yardsToEndzone: 66, down: 3, distance: 7 }, end: { team: { id: 'away' }, yardsToEndzone: 59 } }));
  const shownHome = orientFootballVisualizationPlay(homeRun, footballTeamAttackDirection(homeRun.offenseTeamId, 'home', 'away'));
  const shownAway = orientFootballVisualizationPlay(awayRun, footballTeamAttackDirection(awayRun.offenseTeamId, 'home', 'away'));
  assert.deepEqual([shownHome.start, shownHome.firstDown, shownHome.end], [66, 59, 59]); // LOS, first down and result all mirror.
  assert.deepEqual([shownAway.start, shownAway.firstDown, shownAway.end], [34, 41, 41]);
  assert.equal(homeRun.downDistance, '3rd & 7');
  const homePass = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Reception' }, text: 'QB pass short left for 7 yards', start: { team: { id: 'home' }, yardsToEndzone: 66, down: 2, distance: 7 }, end: { team: { id: 'home' }, yardsToEndzone: 59 } }));
  assert.deepEqual([orientFootballVisualizationPlay(homePass, 'left').start, orientFootballVisualizationPlay(homePass, 'left').end], [66, 59]);
  const td = normalizeFootballVisualizationPlay(play({ type: { text: 'Rushing Touchdown' }, text: 'Runner touchdown', scoringPlay: true, scoringType: { name: 'touchdown' }, start: { team: { id: 'home' }, yardsToEndzone: 3 }, end: { team: { id: 'home' }, yardsToEndzone: 15 } }));
  assert.deepEqual([orientFootballVisualizationPlay(td, 'left').start, orientFootballVisualizationPlay(td, 'left').end], [3, 0]);
});
test('matchup labels and selected-play context are stable, selected-play-specific, and conservative', () => {
  assert.deepEqual(footballEndZoneLabels({ id: 'home', abbreviation: 'LAR' }, { id: 'away', abbreviation: 'NYG' }), { left: 'LAR', right: 'NYG' });
  assert.equal(footballEndZoneLabels({ abbreviation: 'LAR' }, undefined).right, 'END');
  const historical = normalizeFootballVisualizationPlay(play({ id: 'historical', period: { number: 1 }, clock: { displayValue: '10:02' }, start: { team: { id: 'home' }, yardsToEndzone: 66, down: 3, distance: 5, shortDownDistanceText: '3rd & 5' } }));
  const latest = normalizeFootballVisualizationPlay(play({ id: 'latest', period: { number: 2 }, clock: { displayValue: '4:31' }, start: { team: { id: 'away' }, yardsToEndzone: 66, down: 2, distance: 7, shortDownDistanceText: '2nd & 7' } }));
  assert.equal(footballSelectedPlayContext(historical, 'LAR', 'left'), '← LAR · 3RD & 5 · Q1 · 10:02');
  assert.equal(footballSelectedPlayContext(latest, 'NYG', 'right'), 'NYG → · 2ND & 7 · Q2 · 4:31');
  const admin = normalizeFootballVisualizationPlay(play({ type: { text: 'Timeout' }, text: 'Timeout #1 by LAR', start: { team: { id: 'home' }, yardsToEndzone: 66, down: 3, distance: 5, shortDownDistanceText: '3rd & 5' } }));
  assert.equal(admin.downDistance, null); assert.equal(footballSelectedPlayContext(admin, 'LAR', 'left'), '← LAR · Q2 · 8:42');
});
test('punt phases mirror together without inventing a return', () => {
  const punt = normalizeFootballVisualizationPlay(play({ type: { text: 'Punt' }, text: 'J.Fox punts 44 yards to BUF 18, G.Dortch pushed ob at BUF 43 for 25 yards.', start: { team: { id: 'home' }, yardsToEndzone: 60, down: 4, distance: 8 }, end: { team: { id: 'away' }, yardsToEndzone: 57 } }), 0, { offenseAbbreviation: 'DET' });
  const left = orientFootballVisualizationPlay(punt, 'left');
  const right = orientFootballVisualizationPlay({ ...punt, offenseTeamId: 'away' }, 'right');
  assert.deepEqual([left.start, left.punt.destination, left.end], [60, 18, 43]);
  assert.deepEqual([right.start, right.punt.destination, right.end], [40, 82, 57]);
  assert.equal(left.punt.returnYards, 25); assert.equal(right.punt.returnYards, 25);
});
test('fair-catch punts and touchbacks use the factual kick landing spot in both stable orientations', () => {
  const fair = (team) => normalizeFootballVisualizationPlay(play({ type: { text: 'Punt' }, text: `E. Evans punts 38 yards to ${team === 'home' ? 'NYG' : 'LAR'} 47, fair catch by B. Berrios.`, start: { team: { id: team }, yardsToEndzone: 62, down: 4, distance: 8 }, end: { team: { id: team === 'home' ? 'away' : 'home' }, yardsToEndzone: 53 } }), 0, { offenseAbbreviation: team === 'home' ? 'LAR' : 'NYG', homeAbbreviation: 'LAR', awayAbbreviation: 'NYG' });
  const home = orientFootballVisualizationPlay(fair('home'), 'left');
  const away = orientFootballVisualizationPlay(fair('away'), 'right');
  assert.deepEqual([home.start, footballPuntCoordinates(home).kickEnd, footballPuntCoordinates(home).returnEnd], [62, 53, null]);
  assert.deepEqual([away.start, footballPuntCoordinates(away).kickEnd, footballPuntCoordinates(away).returnEnd], [38, 47, null]);
  assert.ok(footballPuntCoordinates(home).kickEnd < home.start); assert.ok(footballPuntCoordinates(away).kickEnd > away.start);
  const touchback = (team) => normalizeFootballVisualizationPlay(play({ type: { text: 'Punt' }, text: 'J. Stout punts 43 yards to end zone, Touchback.', start: { team: { id: team }, yardsToEndzone: 60, down: 4, distance: 8 }, end: { team: { id: team === 'home' ? 'away' : 'home' }, yardsToEndzone: 80 } }), 0, { offenseAbbreviation: team === 'home' ? 'LAR' : 'NYG' });
  const homeTouchback = orientFootballVisualizationPlay(touchback('home'), 'left');
  const awayTouchback = orientFootballVisualizationPlay(touchback('away'), 'right');
  assert.deepEqual([homeTouchback.start, footballPuntCoordinates(homeTouchback).kickEnd, homeTouchback.end], [60, 0, 20]);
  assert.deepEqual([awayTouchback.start, footballPuntCoordinates(awayTouchback).kickEnd, awayTouchback.end], [40, 100, 80]);
  assert.equal(homeTouchback.punt.outcome, 'touchback'); assert.equal(awayTouchback.punt.outcome, 'touchback');
});
test('exact NYG at LAR fair-catch punt numeric trace uses NYG 47 once', () => {
  const raw = play({ id: 'lar-fair-catch', type: { text: 'Punt' }, text: 'E.Evans punts 38 yards to NYG 47, Center-J.Cardona, fair catch by B.Berrios.', start: { team: { id: 'lar' }, yardsToEndzone: 15, down: 4, distance: 5, shortDownDistanceText: '4th & 5' }, end: { team: { id: 'nyg' }, yardsToEndzone: 53 } });
  const normalized = normalizeFootballVisualizationPlay(raw, 0, { offenseAbbreviation: 'LAR', homeAbbreviation: 'LAR', awayAbbreviation: 'NYG', homeTeamId: 'lar', awayTeamId: 'nyg' });
  // This is the selected-play boundary used before FootballPlayByPlay passes props to FootballPlayField.
  const display = withFootballResultingState(normalized, null);
  assert.equal(raw.start.yardsToEndzone, 15); assert.equal(raw.end.yardsToEndzone, 53);
  assert.equal(normalized.start, 85); assert.equal(normalized.end, 53);
  assert.equal(normalized.punt.destination, 47); assert.equal(normalized.punt.destinationAbsolute, 53);
  assert.equal(display.start, 85); assert.equal(display.punt.destination, 47);
  assert.ok(display.punt.destination < display.start); // SVG x increases with the stable display coordinate.
  assert.deepEqual([0, 10, 25, 49, 50, 51, 75, 90, 100], [0, 10, 25, 49, 50, 51, 75, 90, 100].map(position => position <= 50 ? namedYardlineToMatchupPosition('LAR', position, 'LAR', 'NYG') : namedYardlineToMatchupPosition('NYG', 100 - position, 'LAR', 'NYG')));
  const start = footballPuntSvgGeometry(display.start, display.punt.destination, 0);
  const middle = footballPuntSvgGeometry(display.start, display.punt.destination, .5);
  const finish = footballPuntSvgGeometry(display.start, display.punt.destination, 1);
  assert.equal(Math.abs(display.punt.destination - display.start), 38);
  assert.match(start.pathD, /^M 259\.4 33 Q 205\.4/); assert.match(start.pathD, /151\.4.* 33$/);
  assert.ok(Math.abs(start.renderedBallX - 259.4) < .001); assert.ok(Math.abs(finish.renderedBallX - 151.48) < .001);
  assert.ok(middle.renderedBallX < start.renderedBallX && middle.renderedBallX > finish.renderedBallX);
});
test('NYG at LAR scrimmage coordinates convert once while the verified punt source stays matchup-oriented', () => {
  const matchup = { homeTeamId: '14', awayTeamId: '19', homeAbbreviation: 'LAR', awayAbbreviation: 'NYG', offenseAbbreviation: 'LAR' };
  assert.equal(namedYardlineToMatchupPosition('LAR', 47, 'LAR', 'NYG'), 47);
  assert.equal(namedYardlineToMatchupPosition('NYG', 47, 'LAR', 'NYG'), 53);
  const stafford = normalizeFootballVisualizationPlay(play({ id: 'stafford-incomplete', type: { text: 'Pass Incompletion' }, text: '(Shotgun) M.Stafford pass incomplete short right to D.Adams (G.Newsome).', start: { team: { id: '14' }, yardsToEndzone: 85, down: 3, distance: 5, shortDownDistanceText: '3rd & 5' }, end: { team: { id: '14' }, yardsToEndzone: 85 } }), 0, matchup);
  const skattebo = normalizeFootballVisualizationPlay(play({ id: 'skattebo-run', type: { text: 'Rush' }, text: 'C.Skattebo up the middle to NYG 49 for 2 yards (P.Ford; O.Speights).', start: { team: { id: '19' }, yardsToEndzone: 53, down: 1, distance: 10, shortDownDistanceText: '1st & 10' }, end: { team: { id: '19' }, yardsToEndzone: 51 } }), 0, { ...matchup, offenseAbbreviation: 'NYG' });
  const evans = normalizeFootballVisualizationPlay(play({ id: 'evans-punt', type: { text: 'Punt' }, text: 'E.Evans punts 38 yards to NYG 47, Center-J.Cardona, fair catch by B.Berrios.', start: { team: { id: '14' }, yardsToEndzone: 15, down: 4, distance: 5, shortDownDistanceText: '4th & 5' }, end: { team: { id: '19' }, yardsToEndzone: 53 } }), 0, matchup);
  assert.deepEqual([stafford.start, stafford.end, stafford.firstDown], [85, 85, 80]);
  assert.deepEqual([skattebo.start, skattebo.end, skattebo.firstDown], [47, 49, 57]);
  assert.deepEqual([evans.start, evans.punt.destination], [85, 47]);
  const geometry = footballPuntSvgGeometry(evans.start, evans.punt.destination, 0);
  assert.ok(geometry.svgStartX > geometry.svgEndX);
  const awayPunt = normalizeFootballVisualizationPlay(play({ id: 'nyg-fair-catch', type: { text: 'Punt' }, text: 'N.Punter punts 32 yards to LAR 47, fair catch.', start: { team: { id: '19' }, yardsToEndzone: 85, down: 4, distance: 5 }, end: { team: { id: '14' }, yardsToEndzone: 47 } }), 0, { ...matchup, offenseAbbreviation: 'NYG' });
  assert.deepEqual([awayPunt.start, awayPunt.punt.destination], [15, 47]);
  assert.ok(footballPuntSvgGeometry(awayPunt.start, awayPunt.punt.destination, 0).svgStartX < footballPuntSvgGeometry(awayPunt.start, awayPunt.punt.destination, 0).svgEndX);
});
test('penalty semantics use only explicit provider prose and the narrow shared DPI first-down rule', () => {
  const context = { teamAbbreviations: ['LAR', 'NYG'] };
  const dpi = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Incompletion' }, text: 'Pass incomplete. PENALTY on LA-J.Wallace, Defensive Pass Interference, 5 yards, enforced at LA 39 - No Play.' }), 0, context);
  assert.equal(dpi.semanticLabel, 'DEFENSIVE PASS INTERFERENCE ON LAR'); assert.equal(dpi.semanticSecondaryLabel, 'FIRST DOWN'); assert.equal(dpi.renderMode, 'semantic'); assert.equal(dpi.start, null);
  const holding = normalizeFootballVisualizationPlay(play({ type: { text: 'Penalty' }, text: 'PENALTY on NYG, Offensive Holding, 10 yards - No Play.' }), 0, context);
  const falseStart = normalizeFootballVisualizationPlay(play({ type: { text: 'Penalty' }, text: 'PENALTY on NYG, False Start, 5 yards - No Play.' }), 0, context);
  assert.equal(holding.semanticLabel, 'OFFENSIVE HOLDING ON NYG'); assert.equal(holding.semanticSecondaryLabel, 'NO PLAY'); assert.equal(holding.penalty.firstDown, false);
  assert.equal(falseStart.semanticLabel, 'FALSE START ON NYG'); assert.equal(falseStart.penalty.firstDown, false);
  const ambiguous = normalizeFootballVisualizationPlay(play({ type: { text: 'Penalty' }, text: 'Penalty enforced.' }), 0, context);
  assert.equal(ambiguous.semanticLabel, 'PENALTY'); assert.equal(ambiguous.penalty.type, null); assert.equal(ambiguous.penalty.team, null); assert.equal(ambiguous.semanticSecondaryLabel, null);
  const declined = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Reception' }, text: 'Pass complete for 7 yards. PENALTY on NYG, Offensive Holding, declined.' }), 0, context);
  assert.equal(declined.renderMode, 'animated'); assert.equal(declined.animation, 'pass');
});
test('semantic plays use the next same-period structured scrimmage state and otherwise fail closed', () => {
  const dpi = play({ id: 'dpi', type: { text: 'Pass Incompletion' }, text: 'Pass incomplete. PENALTY on LA, Defensive Pass Interference, 5 yards - No Play.', start: { team: { id: 'lar' }, yardsToEndzone: 60, down: 3, distance: 9 } });
  const timeout = play({ id: 'timeout', type: { text: 'Timeout' }, text: 'Timeout', start: { team: { id: 'lar' }, yardsToEndzone: 60 } });
  const next = play({ id: 'next', type: { text: 'Rush' }, start: { team: { id: 'nyg' }, yardsToEndzone: 70, down: 1, distance: 10, shortDownDistanceText: '1st & 10' } });
  const state = nextFootballResultingState([dpi, timeout, next], 'dpi', { teamAbbreviations: ['LAR', 'NYG'] });
  assert.deepEqual(state, { teamId: 'nyg', downDistance: '1st & 10' });
  const shown = withFootballResultingState(normalizeFootballVisualizationPlay(dpi, 0, { teamAbbreviations: ['LAR', 'NYG'] }), state, 'NYG');
  assert.equal(shown.semanticLabel, 'DEFENSIVE PASS INTERFERENCE ON LAR'); assert.equal(shown.semanticSecondaryLabel, '1ST & 10 · NYG');
  const interception = play({ id: 'int', type: { text: 'Pass Interception Return' }, text: 'Pass intercepted', isTurnover: true, start: { team: { id: 'lar' }, yardsToEndzone: 60 } });
  assert.deepEqual(nextFootballResultingState([interception, next], 'int'), { teamId: 'nyg', downDistance: '1st & 10' });
  const fumble = play({ id: 'fum', type: { text: 'Fumble' }, text: 'Runner fumbles, recovered by NYG', isTurnover: true, start: { team: { id: 'lar' }, yardsToEndzone: 60 } });
  assert.deepEqual(nextFootballResultingState([fumble, next], 'fum'), { teamId: 'nyg', downDistance: '1st & 10' });
  const retainedFumble = play({ id: 'retained', type: { text: 'Fumble' }, text: 'Runner fumbles, recovered by LAR', start: { team: { id: 'lar' }, yardsToEndzone: 60 } });
  const retainedNext = { ...next, start: { team: { id: 'lar' }, yardsToEndzone: 60, down: 2, distance: 4, shortDownDistanceText: '2nd & 4' } };
  assert.deepEqual(nextFootballResultingState([retainedFumble, retainedNext], 'retained'), { teamId: 'lar', downDistance: '2nd & 4' });
  assert.equal(nextFootballResultingState([dpi], 'dpi'), null);
  assert.equal(nextFootballResultingState([dpi, { ...next, period: { number: 3 } }], 'dpi'), null);
});
test('consecutive penalties use each immediate next start state rather than skipping to a later snap', () => {
  const dpi = play({ id: 'dpi-706', clock: { displayValue: '7:06' }, type: { text: 'Pass Incompletion' }, text: 'Pass incomplete. PENALTY on LA-J.Wallace, Defensive Pass Interference, 5 yards - No Play.', start: { team: { id: 'nyg' }, yardsToEndzone: 61, down: 3, distance: 9, shortDownDistanceText: '3rd & 9' } });
  const holding = play({ id: 'holding-702', clock: { displayValue: '7:02' }, type: { text: 'Penalty' }, text: 'PENALTY on NYG-J.Runyan, Offensive Holding, 10 yards - No Play.', start: { team: { id: 'nyg' }, yardsToEndzone: 56, down: 1, distance: 10, shortDownDistanceText: '1st & 10' } });
  const next = play({ id: 'next-658', clock: { displayValue: '6:58' }, type: { text: 'Rush' }, start: { team: { id: 'nyg' }, yardsToEndzone: 66, down: 1, distance: 20, shortDownDistanceText: '1st & 20' } });
  const plays = [dpi, holding, next];
  const dpiState = nextFootballResultingState(plays, 'dpi-706', { teamAbbreviations: ['LAR', 'NYG'] });
  const holdingState = nextFootballResultingState(plays, 'holding-702', { teamAbbreviations: ['LAR', 'NYG'] });
  assert.deepEqual(dpiState, { teamId: 'nyg', downDistance: '1st & 10' });
  assert.deepEqual(holdingState, { teamId: 'nyg', downDistance: '1st & 20' });
  assert.equal(withFootballResultingState(normalizeFootballVisualizationPlay(dpi, 0, { teamAbbreviations: ['LAR', 'NYG'] }), dpiState, 'NYG').semanticSecondaryLabel, '1ST & 10 · NYG');
  assert.equal(withFootballResultingState(normalizeFootballVisualizationPlay(holding, 0, { teamAbbreviations: ['LAR', 'NYG'] }), holdingState, 'NYG').semanticSecondaryLabel, '1ST & 20 · NYG');
});
test('punts use a text-derived intermediate destination only when ESPN prose is explicit', () => {
  const returned = normalizeFootballVisualizationPlay(play({ type: { id: '52', text: 'Punt' }, text: 'J.Fox punts 44 yards to BUF 18, Center-H.Hatten. G.Dortch pushed ob at BUF 43 for 25 yards (D.Barnes).', start: { team: { id: '1' }, yardsToEndzone: 60, down: 4, distance: 8 }, end: { team: { id: '2' }, yardsToEndzone: 57 } }), 0, { offenseAbbreviation: 'DET' });
  assert.equal(returned.start, 40); assert.equal(returned.end, 57); assert.equal(returned.animation, 'punt'); assert.equal(returned.animate, true); assert.equal(returned.firstDown, null);
  assert.deepEqual(returned.punt, { destination: 82, destinationSource: 'text-derived', puntYards: 44, returnYards: 25, outcome: 'out-of-bounds' });
  const fairCatch = normalizeFootballVisualizationPlay(play({ type: { id: '52', text: 'Punt' }, text: 'T.Doman punts 43 yards to DET 22, Center-R.Ferguson, fair catch by T.Kennedy.', start: { team: { id: '1' }, yardsToEndzone: 65, down: 4, distance: 8 }, end: { team: { id: '2' }, yardsToEndzone: 78 } }), 0, { offenseAbbreviation: 'BUF' });
  assert.equal(fairCatch.punt.destination, 78); assert.equal(fairCatch.punt.destinationSource, 'text-derived'); assert.equal(fairCatch.punt.returnYards, null); assert.equal(fairCatch.punt.outcome, 'fair-catch');
  const fallback = normalizeFootballVisualizationPlay(play({ type: { id: '52', text: 'Punt' }, text: 'Punter punt for 44 yds, downed at BUF 18.', start: { team: { id: '1' }, yardsToEndzone: 60, down: 4, distance: 8 }, end: { team: { id: '2' }, yardsToEndzone: 82 } }), 0, { offenseAbbreviation: 'DET' });
  assert.equal(fallback.animation, 'punt'); assert.equal(fallback.animate, true); assert.equal(fallback.punt, null); assert.equal(fallback.firstDown, null);
});
test('administrative events do not receive spatial result state', () => {
  for (const [type, text, label] of [['Timeout', 'Timeout #1 by DET at 00:28.', 'TIMEOUT'], ['End Period', 'END QUARTER 1', 'END QUARTER'], ['End of Game', 'END GAME', 'END GAME'], ['Two-minute warning', 'Two-Minute Warning', 'TWO-MINUTE WARNING']]) { const admin = normalizeFootballVisualizationPlay(play({ type: { text: type }, text, start: { team: { id: '1' }, yardsToEndzone: 66, down: 2, distance: 7 }, end: { team: { id: '1' }, yardsToEndzone: 59 } })); assert.equal(admin.renderMode, 'semantic'); assert.equal(admin.administrativeLabel, label); assert.equal(admin.semanticLabel, label); assert.equal(admin.animate, false); assert.equal(admin.start, null); assert.equal(admin.end, null); assert.equal(admin.firstDown, null); }
});
test('unsupported outcomes share semantic field state and no-play takes precedence', () => {
  const semantic = (overrides, label) => { const normalized = normalizeFootballVisualizationPlay(play(overrides)); assert.equal(normalized.renderMode, 'semantic'); assert.equal(normalized.semanticLabel, label); assert.equal(normalized.animation, 'none'); assert.equal(normalized.animate, false); assert.equal(normalized.start, null); assert.equal(normalized.end, null); assert.equal(normalized.firstDown, null); return normalized; };
  semantic({ type: { id: '26', text: 'Pass Interception Return' }, text: 'J.Allen pass intercepted by S.Gill-Howard for 20 yards', isTurnover: true, start: { team: { id: '1' }, yardsToEndzone: 66, down: 2, distance: 7 }, end: { team: { id: '2' }, yardsToEndzone: 55 } }, 'INTERCEPTION');
  semantic({ type: { text: 'Fumble' }, text: 'Runner fumbles at DET 30', isTurnover: true }, 'TURNOVER · FUMBLE');
  semantic({ type: { text: 'Turnover on Downs' }, text: 'Turnover on downs', isTurnover: true }, 'TURNOVER');
  semantic({ type: { text: 'Kickoff' }, text: 'Kicker kicks off 65 yards' }, 'KICKOFF');
  semantic({ type: { text: 'Blocked Field Goal' }, text: 'Kicker 42 yard field goal is blocked' }, 'BLOCKED KICK');
  const noPlayInterception = semantic({ type: { text: 'Pass Interception Return' }, text: '(Shotgun) J.Allen pass short right intended for D.Kincaid INTERCEPTED by S.Gill-Howard. PENALTY on DET, Defensive Holding, 5 yards - No Play.', isTurnover: true }, 'DEFENSIVE HOLDING ON DET');
  assert.equal(noPlayInterception.family, 'pass');
  semantic({ type: { text: 'Rush' }, text: 'Runner left tackle for 8 yards. PENALTY, No Play.' }, 'PENALTY');
  const nullifiedTd = semantic({ type: { text: 'Passing Touchdown' }, text: 'QB pass deep middle for touchdown. PENALTY on DEF, Holding - No Play.', scoringPlay: true, scoringType: { name: 'touchdown' } }, 'HOLDING ON DEF');
  assert.equal(nullifiedTd.scoring, null);
});
test('penalty semantic context is conservative and only explicit first-down language is surfaced', () => {
  const nullified = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Incompletion' }, text: '(Shotgun) J.Goff pass incomplete short right to S.LaPorta. PENALTY on BUF-C.Benford, Defensive Pass Interference, 8 yards, enforced at BUF 9 - No Play.', isPenalty: true }));
  assert.equal(nullified.renderMode, 'semantic'); assert.equal(nullified.semanticLabel, 'DEFENSIVE PASS INTERFERENCE ON BUF'); assert.equal(nullified.semanticSecondaryLabel, 'FIRST DOWN'); assert.equal(nullified.animate, false); assert.equal(nullified.scoring, null);
  assert.deepEqual(nullified.penalty, { team: 'BUF', player: 'C. BENFORD', type: 'DEFENSIVE PASS INTERFERENCE', firstDown: true, outcome: 'FIRST DOWN', declined: false }); assert.equal(nullified.semanticContextLabel, 'C. BENFORD');
  const awarded = normalizeFootballVisualizationPlay(play({ type: { text: 'Penalty' }, text: 'PENALTY on DET-J.Scruggs, Defensive Holding, Automatic First Down.', isPenalty: true, end: { team: { id: '1' }, yardsToEndzone: 50, down: 1, distance: 10 } }));
  assert.equal(awarded.renderMode, 'semantic'); assert.equal(awarded.semanticLabel, 'DEFENSIVE HOLDING ON DET'); assert.equal(awarded.semanticSecondaryLabel, 'FIRST DOWN'); assert.equal(awarded.penalty.firstDown, true);
  const penaltyAwardedPass = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Incompletion' }, text: 'J.Goff pass incomplete short right. PENALTY on BUF-C.Benford, Defensive Pass Interference, Automatic First Down.', isPenalty: true }));
  assert.equal(penaltyAwardedPass.renderMode, 'semantic'); assert.equal(penaltyAwardedPass.semanticLabel, 'DEFENSIVE PASS INTERFERENCE ON BUF'); assert.equal(penaltyAwardedPass.semanticSecondaryLabel, 'FIRST DOWN'); assert.equal(penaltyAwardedPass.animation, 'none');
  const inferred = normalizeFootballVisualizationPlay(play({ type: { text: 'Penalty' }, text: 'PENALTY on DET-J.Scruggs, Defensive Holding, 12 yards.', isPenalty: true, end: { team: { id: '1' }, yardsToEndzone: 50, down: 1, distance: 10 } }));
  assert.equal(inferred.penalty.firstDown, false); assert.equal(inferred.semanticSecondaryLabel, null);
  const validPass = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Reception' }, text: 'J.Goff pass complete short right to S.LaPorta for 12 yards. PENALTY on BUF-C.Benford, Defensive Holding, declined.', isPenalty: true }));
  assert.equal(validPass.renderMode, 'animated'); assert.equal(validPass.animation, 'pass');
});
test('fumble semantic treatment only identifies a turnover when loss of possession is supported', () => {
  const lost = normalizeFootballVisualizationPlay(play({ type: { text: 'Sack' }, text: '(Shotgun) J.Strand sacked at ATL 47 for -6 yards. FUMBLES, RECOVERED by CAR-A.Hall at ATL 46.', start: { team: { id: '1' }, yardsToEndzone: 53 }, end: { team: { id: '2' }, yardsToEndzone: 54 } }), 0, { offenseAbbreviation: 'ATL' });
  assert.equal(lost.renderMode, 'semantic'); assert.equal(lost.semanticLabel, 'TURNOVER · FUMBLE'); assert.deepEqual(lost.fumble, { recoveryTeam: 'CAR', possessionLost: true, possessionLossSource: 'structured' }); assert.equal(lost.start, null); assert.equal(lost.end, null); assert.equal(lost.animate, false);
  const retained = normalizeFootballVisualizationPlay(play({ type: { text: 'Fumble' }, text: 'Runner fumbles, recovered by ATL-A.Teammate.', start: { team: { id: '1' }, yardsToEndzone: 53 }, end: { team: { id: '1' }, yardsToEndzone: 54 } }), 0, { offenseAbbreviation: 'ATL' });
  assert.equal(retained.semanticLabel, 'FUMBLE'); assert.deepEqual(retained.fumble, { recoveryTeam: 'ATL', possessionLost: false, possessionLossSource: 'text-derived' });
  const ambiguous = normalizeFootballVisualizationPlay(play({ type: { text: 'Fumble' }, text: 'Runner fumbles at ATL 46.' }));
  assert.equal(ambiguous.semanticLabel, 'FUMBLE'); assert.equal(ambiguous.fumble.possessionLost, false); assert.equal(ambiguous.fumble.possessionLossSource, null);
  const nullified = normalizeFootballVisualizationPlay(play({ type: { text: 'Fumble' }, text: 'Runner fumbles, recovered by CAR-A.Hall. PENALTY on CAR, Holding - No Play.', isTurnover: true }));
  assert.equal(nullified.semanticLabel, 'HOLDING ON CAR'); assert.equal(nullified.animate, false);
});
test('shared PBP keeps one selection model for full and sticky replay', () => {
  const source = fs.readFileSync(path.join(root, 'components/live-scores/FootballPlayByPlay.tsx'), 'utf8');
  assert.match(source, /new IntersectionObserver/); assert.match(source, /sticky top-0 z-20 -mx-1 !-mt-4 bg-white/);
  assert.match(source, /manual && existing/); assert.match(source, /setSelectedId\(footballPlayId\(latest\)\)/);
  assert.match(source, /selectedRow/); assert.match(source, /stickyReplayEnabled/);
  assert.match(source, /priorSelection\.current !== selectedId/);
  assert.match(source, /periodNavigation\(true\)/); assert.match(source, /: periodNavigation\(\)/); assert.match(source, /value <= 4 \? `Q\$\{value\}` : `OT\$\{value - 4\}`/); assert.match(source, /Latest ↗/);
  const field = fs.readFileSync(path.join(root, 'components/live-scores/FootballPlayField.tsx'), 'utf8');
  assert.match(field, /if \(!play\.animate\) return/); assert.match(field, /play\.animation === "punt"/); assert.match(field, /footballPuntCoordinates/); assert.doesNotMatch(field, /x1="299"/); assert.doesNotMatch(field, /x1="315"/); assert.match(field, /play\?\.text/); assert.match(field, /ballX/);
  assert.match(field, /play\.renderMode === "semantic"/); assert.ok(field.indexOf('play.renderMode === "semantic"') < field.indexOf('if (play.start === null)'));
  assert.match(field, /TOUCHDOWN/); assert.match(field, /progress >= 1/); assert.match(field, /reducedMotion \|\| progress >= 1/); assert.match(field, /compact \? "10" : "13"/);
  assert.match(field, /footballTeamAttackDirection/); assert.doesNotMatch(field, /orientFootballVisualizationPlay/); assert.match(field, /footballEndZoneLabels/); assert.match(field, /footballSelectedPlayContext/);
  assert.doesNotMatch(source, /orientFootballVisualizationForMatchup/); assert.match(source, /const selected = selectedWithState/);
  const modal = fs.readFileSync(path.join(root, 'components/live-scores/GameCenterModal.tsx'), 'utf8');
  assert.doesNotMatch(modal, /<FootballLiveField field=\{detail\?\.field\}/);
  assert.match(modal, /homeTeam=\{footballHomeTeam\} awayTeam=\{footballAwayTeam\}/);
  const nflModal = fs.readFileSync(path.join(root, 'components/live-scores/NflGameCenterModal.tsx'), 'utf8');
  const ncaaModal = fs.readFileSync(path.join(root, 'components/ncaa/NcaaGameCenterModal.tsx'), 'utf8');
  assert.match(nflModal, /GameCenterModal/); assert.match(ncaaModal, /GameCenterModal/);
});
