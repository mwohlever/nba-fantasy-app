const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

// Execute the actual route's selection block without auth, database or provider access.
const source = fs.readFileSync('app/api/home-summary/route.ts', 'utf8');
const block = source.slice(source.indexOf('    const normalizedSlates ='), source.indexOf('    const latestProjectionSeason ='));
assert.ok(block.includes('const latestSlate ='));
const compiled = ts.transpileModule(block + '\nreturn latestSlate;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const select = new Function('sport', 'safeSlates', 'safeResults', 'safePlayerSlateStats', 'Date', compiled);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-26T12:00:00Z'])); }
}
const week1 = { id: 1, display_name: '2026 Week 1', date: '2026-09-10', start_date: '2026-09-10', end_date: '2026-09-14', is_locked: true, first_game_start_time: '2026-09-11T00:20:00Z' };
const week3 = { id: 3, display_name: '2026 Week 3', date: '2026-09-24', start_date: '2026-09-24', end_date: '2026-09-28', is_locked: false, first_game_start_time: null };
const results = [121, 97.3, 94.2, 86.2].map((fantasy_points, team_id) => ({
  slate_id: 1, team_id, fantasy_points, games_completed: 9, games_in_progress: 0, games_remaining: 0,
}));
results.push(...[34.3, 0, 0, 19.1].map((fantasy_points, team_id) => ({
  slate_id: 3, team_id, fantasy_points, games_completed: fantasy_points ? 1 : 0, games_in_progress: 0, games_remaining: fantasy_points ? 8 : 9,
})));
const stats = [
  { slate_id: 1, player_id: 1, fantasy_points: 25, game_status: 3 },
  { slate_id: 3, player_id: 2, fantasy_points: 34.3, game_status: 3 },
  { slate_id: 3, player_id: 3, fantasy_points: 19.1, game_status: 3 },
];

test('NFL Home selects active Week 3 with Thursday final stats and remaining games over completed Week 1', () => {
  for (const is_locked of [false, true]) {
    for (const first_game_start_time of [null, '2026-09-25T00:20:00Z']) {
      const current = { ...week3, is_locked, first_game_start_time };
      assert.equal(select('nfl', [week1, current], results, stats, FixedDate).id, 3);
    }
  }
});

test('NFL retains Scores fallback to previous slate until newest has stats, including zero-point stats', () => {
  assert.equal(select('nfl', [week3, week1], results, stats.slice(0, 1), FixedDate).id, 1);
  assert.equal(select('nfl', [week3, week1], results, [{ slate_id: 3, fantasy_points: 0 }], FixedDate).id, 3);
  assert.equal(select('nfl', [week3], [], [], FixedDate).id, 3);
  assert.equal(select('nfl', [], [], [], FixedDate), null);
});

test('NBA retains its existing metadata/result-based selection even with newer player stats', () => {
  assert.equal(select('nba', [week3, week1], results, stats, FixedDate).id, 1);
  const liveResults = results.map(row => row.slate_id === 3 ? { ...row, games_in_progress: 1 } : row);
  assert.equal(select('nba', [week3, week1], liveResults, stats, FixedDate).id, 3);
});
