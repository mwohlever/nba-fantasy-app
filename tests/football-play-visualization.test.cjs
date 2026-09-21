/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'); const test = require('node:test'); const fs = require('node:fs'); const path = require('node:path'); const Module = require('node:module'); const ts = require('typescript');
const root = path.resolve(__dirname, '..'); const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = function(module, filename) { module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename); };
const { normalizeFootballVisualizationPlay } = require('../lib/live-scores/footballPlayVisualization.ts');
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
  const noPlayInterception = semantic({ type: { text: 'Pass Interception Return' }, text: '(Shotgun) J.Allen pass short right intended for D.Kincaid INTERCEPTED by S.Gill-Howard. PENALTY on DET, Defensive Holding, 5 yards - No Play.', isTurnover: true }, 'PENALTY · NO PLAY');
  assert.equal(noPlayInterception.family, 'pass');
  semantic({ type: { text: 'Rush' }, text: 'Runner left tackle for 8 yards. PENALTY, No Play.' }, 'PENALTY · NO PLAY');
  const nullifiedTd = semantic({ type: { text: 'Passing Touchdown' }, text: 'QB pass deep middle for touchdown. PENALTY on DEF, Holding - No Play.', scoringPlay: true, scoringType: { name: 'touchdown' } }, 'PENALTY · NO PLAY');
  assert.equal(nullifiedTd.scoring, null);
});
test('penalty semantic context is conservative and only explicit first-down language is surfaced', () => {
  const nullified = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Incompletion' }, text: '(Shotgun) J.Goff pass incomplete short right to S.LaPorta. PENALTY on BUF-C.Benford, Defensive Pass Interference, 8 yards, enforced at BUF 9 - No Play.', isPenalty: true }));
  assert.equal(nullified.renderMode, 'semantic'); assert.equal(nullified.semanticLabel, 'PENALTY · NO PLAY'); assert.equal(nullified.animate, false); assert.equal(nullified.scoring, null);
  assert.deepEqual(nullified.penalty, { team: 'BUF', player: 'C. BENFORD', type: 'DEFENSIVE PASS INTERFERENCE', firstDown: false }); assert.equal(nullified.semanticSecondaryLabel, null); assert.equal(nullified.semanticContextLabel, 'DEFENSIVE PASS INTERFERENCE · BUF · C. BENFORD');
  const awarded = normalizeFootballVisualizationPlay(play({ type: { text: 'Penalty' }, text: 'PENALTY on DET-J.Scruggs, Defensive Holding, Automatic First Down.', isPenalty: true, end: { team: { id: '1' }, yardsToEndzone: 50, down: 1, distance: 10 } }));
  assert.equal(awarded.renderMode, 'semantic'); assert.equal(awarded.semanticLabel, 'PENALTY'); assert.equal(awarded.semanticSecondaryLabel, 'FIRST DOWN'); assert.equal(awarded.penalty.firstDown, true);
  const penaltyAwardedPass = normalizeFootballVisualizationPlay(play({ type: { text: 'Pass Incompletion' }, text: 'J.Goff pass incomplete short right. PENALTY on BUF-C.Benford, Defensive Pass Interference, Automatic First Down.', isPenalty: true }));
  assert.equal(penaltyAwardedPass.renderMode, 'semantic'); assert.equal(penaltyAwardedPass.semanticLabel, 'PENALTY'); assert.equal(penaltyAwardedPass.semanticSecondaryLabel, 'FIRST DOWN'); assert.equal(penaltyAwardedPass.animation, 'none');
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
  assert.equal(nullified.semanticLabel, 'PENALTY · NO PLAY'); assert.equal(nullified.animate, false);
});
test('shared PBP keeps one selection model for full and sticky replay', () => {
  const source = fs.readFileSync(path.join(root, 'components/live-scores/FootballPlayByPlay.tsx'), 'utf8');
  assert.match(source, /new IntersectionObserver/); assert.match(source, /sticky top-0 z-20 -mx-1 !-mt-4 bg-white/);
  assert.match(source, /manual && existing/); assert.match(source, /setSelectedId\(footballPlayId\(latest\)\)/);
  assert.match(source, /selectedRow/); assert.match(source, /stickyReplayEnabled/);
  assert.match(source, /priorSelection\.current !== selectedId/);
  assert.match(source, /periodNavigation\(true\)/); assert.match(source, /: periodNavigation\(\)/); assert.match(source, /value <= 4 \? `Q\$\{value\}` : `OT\$\{value - 4\}`/); assert.match(source, /Latest ↗/);
  const field = fs.readFileSync(path.join(root, 'components/live-scores/FootballPlayField.tsx'), 'utf8');
  assert.match(field, /if \(!play\.animate\) return/); assert.match(field, /play\.animation === "punt"/); assert.match(field, /play\.punt\?\.destination/); assert.doesNotMatch(field, /x1="299"/); assert.doesNotMatch(field, /x1="315"/); assert.match(field, /play\?\.text/); assert.match(field, /ballX/);
  assert.match(field, /play\.renderMode === "semantic"/); assert.ok(field.indexOf('play.renderMode === "semantic"') < field.indexOf('if (play.start === null)'));
  assert.match(field, /TOUCHDOWN/); assert.match(field, /progress >= 1/); assert.match(field, /reducedMotion \|\| progress >= 1/); assert.match(field, /compact \? "10" : "13"/);
  const modal = fs.readFileSync(path.join(root, 'components/live-scores/GameCenterModal.tsx'), 'utf8');
  assert.doesNotMatch(modal, /<FootballLiveField field=\{detail\?\.field\}/);
});
