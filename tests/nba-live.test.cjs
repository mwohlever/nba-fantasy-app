/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

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
const { normalizeNbaPlays, defaultNbaPlayPeriod, nbaFullCourtMarker, nbaPeriodLabel, nbaPlayPeriods, latestMeaningfulNbaPlay } = require('../lib/live-scores/nbaPlays.ts');
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
  assert.match(gameCenter, /sticky top-\[-1rem\].*!mt-0/);
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
