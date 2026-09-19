/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText, filename);
const { canViewerSeeGolfRosterPeriod } = require('../lib/golf/rosterVisibility.ts');
const { relevantGolfRosterPeriodKey } = require('../lib/golf/relevantRosterPeriod.ts');
const salary = { draft: { type: 'salary_cap' }, roster: { slots: [{ position: 'GOLFER', slotCount: 4 }] }, rosterPeriods: { type: 'split_after_round_2' } };
const snake = { ...salary, draft: { type: 'snake' } };
const open = period_key => ({ period_key: period_key, locked_at: null, completed_at: null, started_rounds: [], evidence_snapshot: { acquisitionDeadline: '2026-09-17T12:00:00Z' } });
const can = (snapshot, period, viewerTeamId, rosterTeamId, now = Date.parse('2026-09-17T11:00:00Z')) => canViewerSeeGolfRosterPeriod({ snapshot, period, viewerTeamId, rosterTeamId, now });

test('Salary Cap roster visibility is owner-aware and period-scoped', () => {
  const opening = open('opening');
  assert.equal(can(salary, opening, 1, 1), true);
  assert.equal(can(salary, opening, 2, 1), false);
  assert.equal(can(salary, { ...opening, locked_at: '2026-09-17T12:00:00Z' }, 2, 1), true);
  assert.equal(can(salary, { ...opening, started_rounds: [1] }, 2, 1), true);
  const weekend = open('weekend');
  assert.equal(can(salary, weekend, 2, 1), false);
  assert.equal(can(salary, weekend, 1, 1), true);
  assert.equal(can(salary, { ...weekend, started_rounds: [3] }, 2, 1), true);
  assert.equal(can(salary, { ...weekend, evidence_snapshot: { acquisitionDeadline: '2026-09-17T10:00:00Z' } }, 2, 1), false);
});

test('Full Tournament, Standard, and Best Ball use the same Salary Cap privacy boundary', () => {
  const full = open('full_tournament');
  const fullTournament = { ...salary, rosterPeriods: { type: 'full_tournament' } };
  assert.equal(can(fullTournament, full, 2, 1), false);
  assert.equal(can(fullTournament, { ...full, locked_at: '2026-09-17T12:00:00Z' }, 2, 1), true);
  for (const gameType of ['standard', 'best_ball']) {
    assert.equal(can({ ...fullTournament, gameType }, full, 2, 1), false, gameType);
    assert.equal(can({ ...fullTournament, gameType }, full, 1, 1), true, gameType);
  }
});

test('Opening visibility is retained while a Split Weekend roster remains private', () => {
  const opening = { ...open('opening'), locked_at: '2026-09-17T12:00:00Z' };
  const weekend = open('weekend');
  assert.equal(can(salary, opening, 2, 1), true);
  assert.equal(can(salary, weekend, 2, 1), false);
});

test('R1-open Weekend remains owner-editable but inactive and private until accepted R3', () => {
  const opening = { ...open('opening'), locked_at: '2026-09-17T12:00:00Z', started_rounds: [1] };
  const weekend = { ...open('weekend'), opened_at: '2026-09-17T12:05:00Z', started_rounds: [1] };
  assert.equal(relevantGolfRosterPeriodKey(salary, [opening, weekend]), 'opening');
  assert.equal(can(salary, weekend, 1, 1), true, 'owner can retrieve Weekend to edit');
  assert.equal(can(salary, weekend, 2, 1), false, 'another team receives no Weekend identities');
  const r3 = { ...weekend, locked_at: '2026-09-19T12:05:00Z', started_rounds: [1, 2, 3] };
  assert.equal(relevantGolfRosterPeriodKey(salary, [opening, r3]), 'weekend');
  assert.equal(can(salary, r3, 2, 1), true, 'normal locked-roster visibility begins at R3');
});

test('Snake draft roster visibility retains its existing public behavior', () => {
  assert.equal(can(snake, open('opening'), 2, 1), true);
});

test('server roster surfaces use the centralized visibility decision before serializing player identities', () => {
  const root = path.resolve(__dirname, '..');
  const fantasy = fs.readFileSync(path.join(root, 'lib/golf/fantasy.server.ts'), 'utf8');
  const roster = fs.readFileSync(path.join(root, 'app/api/team-slate-roster/route.ts'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'lib/home/golfHomeSummary.ts'), 'utf8');
  assert.match(fantasy, /canViewerSeeGolfRosterPeriod/);
  assert.match(fantasy, /const visibleRosters/);
  assert.match(fantasy, /playerIds: \[\]/);
  assert.match(fantasy, /contributions: t\.contributions\.filter/);
  assert.match(roster, /rosterHidden: true/);
  assert.match(home, /latestSalaryCapLineups[\s\S]*canViewerSeeGolfRosterPeriod/);
});
