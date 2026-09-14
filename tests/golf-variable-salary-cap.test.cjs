/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);
const { buildGolfSlateRulesSnapshot } = require('../lib/slates/golfSlateRules.ts');
const { getGolfSalaryCapRules, validateGolfSalaryCapLineup } = require('../lib/golf/salaryCap.ts');
const { golfPeriodKeys } = require('../lib/golf/periodPersistence.ts');

for (const count of [3, 4, 5, 6]) {
  for (const gameType of ['standard', 'best_ball']) {
    for (const periodType of ['full_tournament', 'split_after_round_2']) {
      test(`${count} golfers / $${count * 25}: ${gameType}, ${periodType}`, () => {
        const snapshot = buildGolfSlateRulesSnapshot({ groupSettings: null,
          selection: { gameType, draft: { type: 'salary_cap', salaryCap: 999 }, rosterPeriods: { type: periodType } },
          rosterSlots: [{ position: 'GOLFER', slotCount: count }],
        });
        const frozen = JSON.parse(JSON.stringify(snapshot));
        const limits = getGolfSalaryCapRules(frozen);
        assert.deepEqual(limits, { rosterSize: count, budget: count * 25, periodType });
        const prices = Array.from({ length: count + 1 }, (_, index) => ({ playerId: index + 1, effectiveSalary: 25, eligible: true }));
        const playerIds = prices.slice(0, count).map(p => p.playerId);
        for (const period of golfPeriodKeys(frozen)) {
          const input = { playerIds, prices, rosterSize: limits.rosterSize, salaryCap: limits.budget, period };
          assert.deepEqual(validateGolfSalaryCapLineup(input), { ok: true, totalSalary: count * 25 });
          assert.match(validateGolfSalaryCapLineup({ ...input, playerIds: playerIds.slice(1) }).error, /exactly/);
          assert.match(validateGolfSalaryCapLineup({ ...input, playerIds: [...playerIds, count + 1] }).error, /exactly/);
          assert.match(validateGolfSalaryCapLineup({ ...input, playerIds: [playerIds[1], ...playerIds.slice(1)] }).error, /only once/);
          assert.match(validateGolfSalaryCapLineup({ ...input, playerIds: [999, ...playerIds.slice(1)] }).error, /not eligible/);
          for (const [change, error] of [[{ effectiveSalary: 26 }, /exceeds/], [{ eligible: false }, /not eligible/], [{ effectiveSalary: null }, /frozen salary/]]) {
            assert.match(validateGolfSalaryCapLineup({ ...input, prices: prices.map((p, i) => i ? p : { ...p, ...change }) }).error, error);
          }
        }
        // Different economics never mutate a tournament price board.
        assert.equal(prices[0].effectiveSalary, 25);
      });
    }
  }
}

test('existing frozen caps are authoritative, not re-derived; malformed snapshots fail closed', () => {
  const snapshot = { sport: 'golf', roster: { slots: [{ position: 'GOLFER', slotCount: 5 }] }, draft: { type: 'salary_cap', salaryCap: 110 } };
  assert.equal(getGolfSalaryCapRules(snapshot).budget, 110);
  for (const bad of [null, {}, { ...snapshot, draft: { type: 'snake' } },
    { ...snapshot, draft: { type: 'salary_cap' } },
    { ...snapshot, draft: { type: 'salary_cap', salaryCap: -5 } },
    { ...snapshot, roster: { slots: [{ position: 'GOLFER', slotCount: 0 }] } },
    { ...snapshot, roster: { slots: [{ position: 'QB', slotCount: 5 }] } }]) {
    assert.equal(getGolfSalaryCapRules(bad), null);
  }
});

test('additive RPC preserves all non-configuration acquisition checks from migration 160', () => {
  const old = fs.readFileSync('supabase/migrations/20260916000100_golf_salary_cap_acquisition.sql', 'utf8');
  const sql = fs.readFileSync('supabase/migrations/20260917000100_golf_salary_cap_variable_roster.sql', 'utf8');
  const fn = text => text.match(/create (?:or replace )?function public\.save_golf_salary_cap_lineup[\s\S]*?\n\$\$;/)[0];
  const original = fn(old), replacement = fn(sql);
  assert.equal(replacement.slice(0, replacement.indexOf('  -- Read limits')).replace('create or replace', 'create'),
    original.slice(0, original.indexOf('  select coalesce(sum(')));
  assert.equal(replacement.slice(replacement.indexOf('  if p_player_ids'))
    .replace("raise exception 'Select exactly % unique golfers', roster_size", "raise exception 'Select exactly four unique golfers'")
    .replace("raise exception 'Lineup exceeds the $% salary cap', cap", "raise exception 'Lineup exceeds the $100 salary cap'"),
    original.slice(original.indexOf('  if p_player_ids')));
  assert.match(sql, /roster_size:=\(s\.rules_snapshot#>>'\{roster,slots,0,slotCount\}'\)::integer/);
  assert.match(sql, /cap:=\(s\.rules_snapshot#>>'\{draft,salaryCap\}'\)::integer/);
  assert.doesNotMatch(sql, /roster_size<>4|cap<>100|p_salary|p_roster_size|p_total/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(sql, /grant execute.*to service_role/);
});
