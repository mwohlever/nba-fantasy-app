/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};

const { normalizeNbaGame, nbaStatusDetail } = require('../lib/providers/nbaLiveScores.ts');
const { nbaBoxscorePlayers, normalizeNbaPlays, defaultNbaPlayPeriod, nbaFullCourtMarker, nbaPeriodLabel, nbaPlayAttackIndicator, nbaPlayPeriods, latestMeaningfulNbaPlay } = require('../lib/live-scores/nbaPlays.ts');
const NbaPlayCourt = require('../components/live-scores/NbaPlayCourt.tsx').default;
const { buildNbaOwnership, canonicalNbaPlayerName, matchingNbaSlate, nbaAthleteId } = require('../lib/live-scores/nbaOwnership.ts');
const { fetchNbaGameDetail } = require('../lib/live-scores/nbaGameDetail.ts');
const { nbaDateKey, shiftNbaDate } = require('../lib/live-scores/nbaDate.ts');
const { shouldShowCompactNbaReplay } = require('../lib/live-scores/nbaStickyReplay.ts');

const competitor = (homeAway, id, score, winner = false) => ({ homeAway, winner, score, team: { id, displayName: `${id} Team`, abbreviation: id, logo: `https://example.test/${id}.png` }, records: [{ type: 'total', summary: '2-1' }], linescores: [{ period: 1, value: 20 }] });

test('NBA scoreboard normalizes scheduled, live, and final games with optional metadata', () => {
  const base = { id: '1', name: 'Away at Home', shortName: 'AWY @ HME', date: '2026-04-15T23:30Z', competitions: [{ competitors: [competitor('away', 'AWY', '80'), competitor('home', 'HME', '90', true)], status: { period: 4, displayClock: '02:31', type: { state: 'in', shortDetail: '4th Qtr' } }, broadcasts: [{ market: 'national', names: ['ABC'] }], odds: [{ spread: -4.5, overUnder: 220.5, homeTeamOdds: { favorite: true } }] }] };
  const live = normalizeNbaGame(base);
  assert.equal(live.status, 'in'); assert.equal(live.clock, '02:31'); assert.equal(live.broadcast.network, 'ABC'); assert.equal(live.odds.favoriteTeamId, 'HME');
  const scheduled = normalizeNbaGame({ ...base, competitions: [{ ...base.competitions[0], status: { type: { state: 'pre' } }, broadcasts: [], odds: [] }] });
  assert.equal(scheduled.status, 'pre'); assert.equal(scheduled.broadcast, null); assert.equal(scheduled.odds, null);
  const final = normalizeNbaGame({ ...base, competitions: [{ ...base.competitions[0], status: { type: { state: 'post', completed: true, shortDetail: 'Final/OT' } } }] });
  assert.equal(final.completed, true); assert.equal(final.statusDetail, 'Final/OT');
  assert.equal(nbaStatusDetail({ state: 'in', period: 5, displayClock: '1:02' }), 'OT1 · 1:02');
});

test('NBA play normalizer retains general PBP but only maps verified field-goal coordinates', () => {
  const plays = normalizeNbaPlays([
    { id: 'fg', period: { number: 1 }, clock: { displayValue: '10:00' }, text: 'Shooter makes three point jumper', shootingPlay: true, pointsAttempted: 3, scoreValue: 3, coordinate: { x: 30, y: 25 }, participants: [{ athlete: { id: '42' } }], awayScore: 3, homeScore: 0 },
    { id: 'ft', text: 'Shooter makes free throw', shootingPlay: true, pointsAttempted: 1, scoreValue: 1, type: { text: 'Free Throw - 1 of 2' }, coordinate: { x: -214748340, y: -214748365 } },
    { id: 'turnover', text: 'Turnover', shootingPlay: false, coordinate: { x: 25, y: 25 } },
    { id: 'outside', text: 'Misses jumper', shootingPlay: true, pointsAttempted: 2, coordinate: { x: 51, y: 20 } },
    { id: 'missing', text: 'Misses jumper', shootingPlay: true, pointsAttempted: 2 },
    { id: 'fg', text: 'duplicate' },
  ]);
  assert.equal(plays.length, 5); assert.deepEqual(plays[0].coordinate, { x: 30, y: 25 }); assert.equal(plays[0].shooterId, '42');
  for (const play of plays.slice(1)) assert.equal(play.coordinate, null);
  assert.equal(plays[1].isFreeThrow, true);
  assert.deepEqual(nbaFullCourtMarker({ ...plays[0], teamId: 'HME' }, { awayTeamId: 'AWY', homeTeamId: 'HME' }), { left: 30.25, top: 30, basket: 'left', made: true });
  assert.deepEqual(nbaFullCourtMarker({ ...plays[0], id: 'layup', teamId: 'HME', pointsAttempted: 2, coordinate: { x: 24, y: 1 } }, { awayTeamId: 'AWY', homeTeamId: 'HME' }), { left: 6.25, top: 24, basket: 'left', made: true });
  assert.deepEqual(nbaFullCourtMarker({ ...plays[0], id: 'midrange', teamId: 'AWY', pointsAttempted: 2, coordinate: { x: 31, y: 15 } }, { awayTeamId: 'AWY', homeTeamId: 'HME' }), { left: 73.75, top: 31, basket: 'right', made: true });
  assert.deepEqual(nbaFullCourtMarker({ ...plays[0], id: 'away-miss', teamId: 'AWY', scoreValue: 0, coordinate: { x: 2, y: 10 } }, { awayTeamId: 'AWY', homeTeamId: 'HME' }), { left: 78.75, top: 2, basket: 'right', made: false });
  assert.equal(nbaFullCourtMarker({ ...plays[0], teamId: 'HME', pointsAttempted: 1 }, { awayTeamId: 'AWY', homeTeamId: 'HME' }), null);
  assert.equal(nbaFullCourtMarker({ ...plays[0], teamId: 'unknown' }, { awayTeamId: 'AWY', homeTeamId: 'HME' }), null);
  assert.equal(nbaPlayAttackIndicator({ ...plays[0], teamId: 'HME' }, { awayTeamId: 'AWY', homeTeamId: 'HME', awayTeamAbbreviation: 'NY', homeTeamAbbreviation: 'CLE' }), '← CLE');
  assert.equal(nbaPlayAttackIndicator({ ...plays[0], teamId: 'AWY' }, { awayTeamId: 'AWY', homeTeamId: 'HME', awayTeamAbbreviation: 'NY', homeTeamAbbreviation: 'CLE' }), 'NY →');
  assert.equal(nbaPlayAttackIndicator({ ...plays[0], teamId: 'unknown' }, { awayTeamId: 'AWY', homeTeamId: 'HME', awayTeamAbbreviation: 'NY', homeTeamAbbreviation: 'CLE' }), null);
  assert.equal(nbaPlayAttackIndicator({ ...plays[0], teamId: 'HME' }, { awayTeamId: 'AWY', homeTeamId: 'HME', homeTeamAbbreviation: null }), null);
  assert.deepEqual(nbaPlayPeriods([{ ...plays[0], period: 1 }, { ...plays[0], id: 'ot', period: 5 }, { ...plays[0], id: '2ot', period: 6 }]), [1, 5, 6]);
  assert.equal(nbaPeriodLabel(5), 'OT'); assert.equal(nbaPeriodLabel(6), '2OT');
  const periodPlays = [{ ...plays[0], period: 1 }, { ...plays[0], id: 'q4', period: 4 }, { ...plays[0], id: 'ot', period: 5 }];
  assert.equal(defaultNbaPlayPeriod(periodPlays, false, null), 5);
  assert.equal(defaultNbaPlayPeriod(periodPlays, true, 4), 4);
  assert.equal(latestMeaningfulNbaPlay([{ ...plays[0], text: 'Actual play' }, { ...plays[0], id: 'end', text: 'End of Game' }]).id, 'fg');
});

test('NBA free throws use structured metadata and regulation origins instead of ESPN sentinels', () => {
  const [homeMade, awayMiss, nonFreeThrow] = normalizeNbaPlays([
    { id: 'home-ft', shootingPlay: true, pointsAttempted: 1, scoreValue: 1, type: { text: 'Free Throw - 2 of 2' }, team: { id: 'HME' }, coordinate: { x: -214748340, y: -214748365 } },
    { id: 'away-ft', shootingPlay: true, pointsAttempted: 1, scoreValue: 0, type: { text: 'Technical Free Throw' }, team: { id: 'AWY' }, coordinate: { x: -214748340, y: -214748365 } },
    { id: 'one-point-non-shot', shootingPlay: true, pointsAttempted: 1, scoreValue: 1, type: { text: 'Other scoring play' }, team: { id: 'HME' }, coordinate: { x: -214748340, y: -214748365 } },
  ]);
  const context = { awayTeamId: 'AWY', homeTeamId: 'HME' };
  assert.equal(homeMade.isFreeThrow, true);
  assert.equal(awayMiss.isFreeThrow, true);
  assert.equal(nonFreeThrow.isFreeThrow, false);
  assert.equal(homeMade.coordinate, null);
  assert.equal(awayMiss.coordinate, null);
  assert.deepEqual(nbaFullCourtMarker(homeMade, context), { left: 19, top: 25, basket: 'left', made: true });
  assert.deepEqual(nbaFullCourtMarker(awayMiss, context), { left: 75, top: 25, basket: 'right', made: false });
  assert.equal(nbaFullCourtMarker(nonFreeThrow, context), null);
});

test('NBA semantic events use typed ESPN plays, never shot positions or attack arrows', () => {
  const raw = (id, typeId, typeText, extra = {}) => ({
    id, type: { id: typeId, text: typeText }, text: typeText, period: { number: 1 },
    team: { id: '5' }, shootingPlay: false, coordinate: { x: 25, y: 25 }, ...extra,
  });
  const cases = [
    ['timeout', '16', 'Full Timeout', 'TIMEOUT', '5'],
    ['turnover', '62', 'Bad Pass\nTurnover', 'TURNOVER', '5'],
    ['shooting', '44', 'Shooting Foul', 'SHOOTING FOUL', '5'],
    ['personal', '45', 'Personal Foul', 'PERSONAL FOUL', '5'],
    ['take', '22', 'Personal Take Foul', 'PERSONAL TAKE FOUL', '5'],
    ['offensive', '42', 'Offensive Foul', 'OFFENSIVE FOUL', '5'],
    ['technical', '35', 'Technical Foul', 'TECHNICAL FOUL', '5'],
    ['double', '30', 'Double Technical Foul', 'DOUBLE TECHNICAL FOUL', undefined],
    ['flagrant', '32', 'Flagrant Foul Type 1', 'FLAGRANT FOUL TYPE 1', '5'],
    ['three-seconds', '29', 'Defensive 3-Seconds Technical', 'DEFENSIVE 3 SECONDS', '5'],
    ['challenge', '213', 'Challenge', "COACH'S CHALLENGE", '5'],
    ['supported', '214', "Coach's Challenge (Supported)", "COACH'S CHALLENGE", '5', 'SUPPORTED'],
    ['overturned', '215', "Coach's Challenge (Overturned)", "COACH'S CHALLENGE", '5', 'OVERTURNED'],
    ['stands', '216', "Coach's Challenge (Stands)", "COACH'S CHALLENGE", '5', 'STANDS'],
    ['ref-supported', '278', 'Ref-Initiated Review (Supported)', 'REF REVIEW', undefined, 'SUPPORTED'],
    ['ref-overturned', '279', 'Ref-Initiated Review (Overturned)', 'REF REVIEW', undefined, 'OVERTURNED'],
    ['ref-stands', '280', 'Ref-Initiated Review (Stands)', 'REF REVIEW', undefined, 'STANDS'],
    ['jump', '615', 'Jumpball', 'JUMP BALL', undefined],
  ];
  const plays = normalizeNbaPlays(cases.map(([id, typeId, typeText]) => raw(id, typeId, typeText)));
  for (const [index, [id, typeId, , label, teamId, secondary]] of cases.entries()) {
    const play = plays[index];
    assert.equal(play.id, id);
    assert.equal(play.typeId, typeId);
    assert.equal(play.semanticEvent.primaryLabel, label);
    assert.equal(play.semanticEvent.teamId, teamId);
    assert.equal(play.semanticEvent.secondaryLabel, secondary);
    assert.equal(play.coordinate, null);
    assert.equal(nbaFullCourtMarker(play, { homeTeamId: '5', awayTeamId: '18' }), null);
    assert.equal(nbaPlayAttackIndicator(play, { homeTeamId: '5', awayTeamId: '18', homeTeamAbbreviation: 'CLE' }), null);
  }
  const [substitution, unknown] = normalizeNbaPlays([raw('sub', '584', 'Substitution'), raw('other', '999', 'Unknown')]);
  assert.equal(substitution.semanticEvent, undefined);
  assert.equal(unknown.semanticEvent, undefined);
  const syntheticShot = { ...plays[0], shootingPlay: true, pointsAttempted: 2, coordinate: { x: 25, y: 25 } };
  assert.equal(nbaFullCourtMarker(syntheticShot, { homeTeamId: '5', awayTeamId: '18' }), null);
});

test('foul player labels require a single charged participant and matching box-score team', () => {
  const boxscore = { players: [
    { team: { id: '5' }, statistics: [{ athletes: [{ athlete: { id: '3992', shortName: 'J. Harden' } }] }] },
    { team: { id: '18' }, statistics: [{ athletes: [{ athlete: { id: '42', shortName: 'J. Brunson' } }] }] },
  ] };
  const players = nbaBoxscorePlayers(boxscore);
  const foul = (id, participants, teamId = '5', typeId = '44') => ({ id, type: { id: typeId, text: 'Shooting Foul' }, team: { id: teamId }, participants, text: 'foul' });
  const participant = id => ({ athlete: { id } });
  const [known, missing, unresolved, wrongTeam, multiple, doubleTechnical] = normalizeNbaPlays([
    foul('known', [participant('3992')]), foul('missing', []), foul('unresolved', [participant('999')]),
    foul('wrong-team', [participant('42')]), foul('multiple', [participant('3992'), participant('42')]),
    foul('double', [participant('3992'), participant('42')], '5', '30'),
  ], players);
  assert.equal(known.semanticEvent.chargedPlayerId, '3992');
  assert.equal(known.semanticEvent.playerLabel, 'J. HARDEN');
  assert.equal(missing.semanticEvent.playerLabel, undefined);
  assert.equal(unresolved.semanticEvent.playerLabel, undefined);
  assert.equal(wrongTeam.semanticEvent.playerLabel, undefined);
  assert.equal(multiple.semanticEvent.playerLabel, undefined);
  assert.equal(doubleTechnical.semanticEvent.teamId, undefined);
  assert.equal(doubleTechnical.semanticEvent.playerLabel, undefined);
  assert.equal(doubleTechnical.semanticEvent.chargedPlayerId, undefined);
  const ambiguous = nbaBoxscorePlayers({ players: [...boxscore.players, { team: { id: '18' }, statistics: [{ athletes: [{ athlete: { id: '3992', shortName: 'J. Harden' } }] }] }] });
  assert.equal(ambiguous.has('3992'), false);
});

test('full and sticky NBA courts share the semantic overlay without mounting a shot replay', () => {
  const players = nbaBoxscorePlayers({ players: [{ team: { id: '5' }, statistics: [{ athletes: [{ athlete: { id: '3992', shortName: 'J. Harden' } }] }] }] });
  const [play] = normalizeNbaPlays([{ id: 'foul', type: { id: '44', text: 'Shooting Foul' }, text: 'James Harden shooting foul', team: { id: '5' }, participants: [{ athlete: { id: '3992' } }], period: { number: 1 }, clock: { displayValue: '8:42' } }], players);
  const props = { play, homeTeamId: '5', awayTeamId: '18', homeTeamAbbreviation: 'CLE', awayTeamAbbreviation: 'NYK' };
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(NbaPlayCourt, { ...props, compact }));
    assert.match(html, /data-semantic-event="foul"/);
    assert.match(html, /SHOOTING FOUL · CLE/);
    assert.match(html, /J\. HARDEN/);
    assert.doesNotMatch(html, /← CLE|CLE →|fill-emerald-500|fill-rose-500/);
    if (!compact) assert.match(html, /James Harden shooting foul/);
  }
});

test('typed period endings remain manually selectable but never become the automatic latest play', () => {
  const plays = normalizeNbaPlays([
    { id: 'shot', text: 'Player makes jumper', type: { id: '92', text: 'Jump Shot' }, period: { number: 1 } },
    { id: 'q1', text: 'End of the 1st Quarter', type: { id: '412', text: 'End Period' }, period: { number: 1 } },
    { id: 'half', text: 'End of the 2nd Quarter', type: { id: '412', text: 'End Period' }, period: { number: 2 } },
    { id: 'ot', text: 'End of the 1st Overtime', type: { id: '412', text: 'End Period' }, period: { number: 5 } },
    { id: 'game', text: 'End of Game', type: { id: '402', text: 'End Game' }, period: { number: 4 } },
  ]);
  assert.deepEqual(plays.slice(1).map(p => p.semanticEvent.primaryLabel), ['END OF Q1', 'HALFTIME', 'END OF OT', 'END OF GAME']);
  assert.equal(latestMeaningfulNbaPlay(plays).id, 'shot');
  assert.equal(latestMeaningfulNbaPlay(plays.slice(1)), null);
  const manuallySelected = plays.find(p => p.id === 'q1');
  assert.match(renderToStaticMarkup(React.createElement(NbaPlayCourt, { play: manuallySelected })), /END OF Q1/);
  assert.equal(latestMeaningfulNbaPlay(normalizeNbaPlays([{ id: 'legacy', text: 'End of the 1st Quarter' }])), null);
});

test('NBA date selection keeps exact calendar dates and YYYYMMDD API keys', () => {
  assert.equal(nbaDateKey('2026-04-15'), '20260415');
  assert.equal(shiftNbaDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftNbaDate('2026-12-31', 1), '2027-01-01');
  assert.equal(nbaDateKey('2026-4-1'), null);
});

test('court keeps a permanent provider-derived origin separate from a time-bounded replay ball', () => {
  const court = fs.readFileSync(path.join(root, 'components/live-scores/NbaPlayCourt.tsx'), 'utf8');
  assert.match(court, /viewBox="0 0 94 50"/);
  assert.match(court, /23\.75/);
  assert.match(court, /prefers-reduced-motion: reduce/);
  assert.match(court, /translate\(\$\{marker\.left\}/);
  assert.match(court, /requestAnimationFrame/);
  assert.match(court, /playId, reducedMotion/);
  assert.doesNotMatch(court, /animateMotion/);
  assert.doesNotMatch(court, /fill="freeze"/);
  assert.match(court, /ShotReplay/);
  assert.match(court, /replayEnabled/);
  assert.match(court, /compact = false/);
  assert.match(court, /bg-slate-950\/80/);
  assert.match(court, /text-slate-100/);
});

test('compact replay eligibility is mobile-only and supplements a hidden normal court', () => {
  assert.equal(shouldShowCompactNbaReplay(true, true), false);
  assert.equal(shouldShowCompactNbaReplay(true, false), true);
  assert.equal(shouldShowCompactNbaReplay(false, false), false);
  const gameCenter = fs.readFileSync(path.join(root, 'components/live-scores/NbaGameCenterModal.tsx'), 'utf8');
  assert.match(gameCenter, /new IntersectionObserver/);
  assert.match(gameCenter, /closest\("main"\)/);
  assert.match(gameCenter, /shouldShowCompactNbaReplay\(narrow,normalReplayVisible\)/);
  assert.match(gameCenter, /replayEnabled=\{!compactVisible\}/);
  assert.match(gameCenter, /NbaPlayCourt compact play=\{selected\}/);
  assert.match(gameCenter, /sticky top-0 z-20 -mx-1 !-mt-4 bg-white/);
  assert.match(gameCenter, /<main className="min-h-0 flex-1 overflow-y-auto pb-24 sm:pb-5"><div className="p-4">/);
  assert.doesNotMatch(gameCenter, /overflow-y-auto p-4 pb-24/);
  assert.match(gameCenter, /\{periodNavigation\(true\)\}<\/div>:periodNavigation\(\)/);
  assert.match(gameCenter, /sticky\?"bg-white px-1 pb-1 pt-1":"pb-1"/);
  const football = fs.readFileSync(path.join(root, 'components/live-scores/FootballPlayByPlay.tsx'), 'utf8');
  assert.match(football, /sticky top-0 z-20 -mx-1 !-mt-4 bg-white/);
  const footballModal = fs.readFileSync(path.join(root, 'components/live-scores/GameCenterModal.tsx'), 'utf8');
  assert.match(footballModal, /data-game-center-scroll className="min-h-0 flex-1 overflow-y-auto pb-24 sm:pb-6"/);
  assert.match(football, /\{periodNavigation\(true\)\}<\/div> : periodNavigation\(\)/);
});

test('QA game shot transforms preserve ESPN rim distance for both display sides', () => {
  const context = { homeTeamId: '5', awayTeamId: '18' };
  const make = (id, teamId, x, y, scoreValue) => ({ id, teamId, coordinate: { x, y }, shootingPlay: true, pointsAttempted: 2, scoreValue });
  const cases = [
    ['Thomas Bryant 24-foot three', make('bryant', '5', 27, 25, 3), 25.08, [30.25, 27], [5.25, 25]],
    ['Tyler Kolek 15-foot fadeaway', make('kolek-make', '18', 14, 11, 2), 15.56, [77.75, 14], [88.75, 25]],
    ['Tyler Kolek floating miss', make('kolek-miss', '18', 19, 9, 0), 10.82, [79.75, 19], [88.75, 25]],
  ];
  for (const [label, play, expected, point, rim] of cases) {
    const marker = nbaFullCourtMarker(play, context);
    assert.ok(marker, label);
    assert.deepEqual([marker.left, marker.top], point, label);
    assert.ok(Math.abs(Math.hypot(play.coordinate.x - 25, play.coordinate.y) - expected) < 0.02, `${label} provider distance`);
    assert.ok(Math.abs(Math.hypot(marker.left - rim[0], marker.top - rim[1]) - expected) < 0.02, `${label} displayed distance`);
  }
});

test('NBA ownership is exact, slate-scoped, and avoids ambiguous matches', () => {
  assert.equal(nbaAthleteId('0042'), '42');
  assert.equal(nbaAthleteId('not-an-id'), null);
  assert.equal(canonicalNbaPlayerName('LeBron James Jr.'), 'lebron james');
  assert.equal(matchingNbaSlate([{ id: 1, date: '2026-04-15', start_date: '2026-04-14', end_date: '2026-04-16' }], '2026-04-15T23:30:00Z').id, 1);
  assert.equal(matchingNbaSlate([{ id: 1, date: '2026-04-15' }, { id: 2, date: '2026-04-15' }], '2026-04-15T23:30:00Z'), null);
  const owners = buildNbaOwnership([
    { id: '42', displayName: 'LeBron James' }, { id: '99', displayName: 'Unowned Player' }, { id: '12', displayName: 'Chris Smith' },
  ], [
    { localPlayerId: 7, playerName: 'LeBron James', teamId: 1, teamName: 'Mark' },
    { localPlayerId: 8, playerName: 'Chris Smith', teamId: 2, teamName: 'Andy' },
    { localPlayerId: 9, playerName: 'Chris Smith', teamId: 3, teamName: 'Josh' },
  ], 1);
  assert.deepEqual(owners['42'], { name: 'Mark', isYou: true });
  assert.equal(owners['99'], undefined);
  assert.equal(owners['12'], undefined);
});

test('supplemental NBA awards cannot block the scoped Home summary loading exit', () => {
  const home = fs.readFileSync(path.join(root, 'components/home/SportHomePage.tsx'), 'utf8');
  assert.match(home, /Awards are supplementary/);
  assert.match(home, /void \(async \(\) =>/);
  assert.match(home, /setIsLoading\(false\)/);
});

test('NBA player stats keeps one selected team table at a time', () => {
  const gameCenter = fs.readFileSync(path.join(root, 'components/live-scores/NbaGameCenterModal.tsx'), 'utf8');
  assert.match(gameCenter, /selectedTeamId/);
  assert.match(gameCenter, /grid-cols-2/);
  assert.match(gameCenter, /teams\.find\(team=>String\(team\.team\?\.id\)===selectedTeamId\)/);
  assert.match(gameCenter, /FantasyOwnerLabel owner=\{owner\}/);
  assert.doesNotMatch(gameCenter, /owner\?"bg-sky-50/);
});

test('completed NBA detail preserves box score and play-by-play payloads', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({
    header: { competitions: [{ status: { type: { state: 'post', completed: true } }, competitors: [competitor('away', 'AWY', '99'), competitor('home', 'HME', '100', true)] }] },
    boxscore: { teams: [{ team: { id: 'AWY' } }], players: [{ team: { id: 'AWY' }, statistics: [] }] },
    plays: [{ id: 'final-shot', text: 'Player makes jumper', shootingPlay: true, pointsAttempted: 2, scoreValue: 2, coordinate: { x: 20, y: 18 } }],
  });
  try {
    const detail = await fetchNbaGameDetail('12345');
    assert.equal(detail.boxscore.players.length, 1);
    assert.equal(detail.plays.length, 1);
    assert.equal(detail.plays[0].coordinate.x, 20);
  } finally { global.fetch = originalFetch; }
});

test('NBA game detail resolves a charged foul player from its own box score', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({
    header: { competitions: [{ competitors: [competitor('away', '18', '90'), competitor('home', '5', '91')] }] },
    boxscore: { players: [{ team: { id: '5' }, statistics: [{ athletes: [{ athlete: { id: '3992', shortName: 'J. Harden' } }] }] }] },
    plays: [{ id: 'foul', type: { id: '44', text: 'Shooting Foul' }, team: { id: '5' }, participants: [{ athlete: { id: '3992' } }], text: 'James Harden shooting foul' }],
  });
  try {
    const detail = await fetchNbaGameDetail('12345');
    assert.equal(detail.plays[0].semanticEvent.playerLabel, 'J. HARDEN');
    assert.equal(detail.plays[0].semanticEvent.chargedPlayerId, '3992');
  } finally { global.fetch = originalFetch; }
});
