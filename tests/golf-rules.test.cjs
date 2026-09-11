/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../lib/rules/leagueRules.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, structuredClone });
const { resolveGolfRules, resolveLeagueRules, getDefaultLeagueRules } = moduleUnderTest.exports;
const json = value => JSON.parse(JSON.stringify(value));

for (const gameType of ['standard', 'best_ball']) {
  for (const type of ['snake', 'salary_cap']) {
    for (const periodType of ['full_tournament', 'split_after_round_2']) {
    test(`${gameType} + ${type} + ${periodType}: independent axes and frozen JSON round trip`, () => {
      const settings = { gameType, draft: { type }, rosterPeriods: { type: periodType }, roster: { slots: [{ position: 'GOLFER', slotCount: 4 }] } };
      const resolved = resolveGolfRules(settings);
      assert.equal(resolved.gameType, gameType);
      assert.equal(resolved.draft.type, type);
      assert.equal(resolved.rosterPeriods.type, periodType);
      assert.equal(resolved.draft.salaryCap, type === 'salary_cap' ? 100 : undefined);
      assert.deepEqual(json(resolved.roster), settings.roster);
      const frozen = json(resolved);
      settings.gameType = 'changed';
      settings.draft.type = 'changed';
      settings.rosterPeriods.type = 'changed';
      settings.roster.slots[0].slotCount = 8;
      assert.deepEqual(json(resolveGolfRules(frozen)), frozen);
    });
    }
  }
}

test('historical missing fields preserve Standard, snake conventions, and canonical roster/scoring', () => {
  for (const input of [null, undefined, {}, [], { sport: 'golf', scoring: {}, draft: { type: 'snake' } }]) {
    const resolved = resolveGolfRules(input);
    assert.equal(resolved.gameType, 'standard');
    assert.equal(resolved.draft.type, 'snake');
    assert.equal(resolved.rosterPeriods.type, 'full_tournament');
    assert.deepEqual(json(resolved.roster), json(getDefaultLeagueRules('golf').roster));
    assert.deepEqual(json(resolved.scoring), {});
  }
});

test('invalid period input defaults safely without changing scoring, acquisition, cap or roster', () => {
  for (const rosterPeriods of [null, undefined, [], 'split_after_round_2', {}, { type: 'weekend' }, { type: 2 }]) {
    const rules = resolveGolfRules({ gameType: 'best_ball', draft: { type: 'salary_cap', salaryCap: 125 }, rosterPeriods,
      roster: { slots: [{ position: 'GOLFER', slotCount: 6 }] } });
    assert.equal(rules.rosterPeriods.type, 'full_tournament');
    assert.equal(rules.gameType, 'best_ball');
    assert.equal(rules.draft.type, 'salary_cap');
    assert.equal(rules.draft.salaryCap, 125);
    assert.equal(rules.roster.slots[0].slotCount, 6);
  }
});

test('changing only the period preserves unrelated rules and never updates a frozen snapshot', () => {
  const settings = { gameType: 'standard', draft: { type: 'salary_cap', salaryCap: 120 }, rosterPeriods: { type: 'full_tournament' } };
  const frozen = json(resolveGolfRules(settings));
  settings.rosterPeriods.type = 'split_after_round_2';
  const changed = json(resolveGolfRules(settings));
  assert.equal(changed.rosterPeriods.type, 'split_after_round_2');
  assert.deepEqual({ ...changed, rosterPeriods: frozen.rosterPeriods }, frozen);
  assert.equal(resolveGolfRules(frozen).rosterPeriods.type, 'full_tournament');
});

test('invalid axes default independently without erasing the valid axis', () => {
  for (const invalid of [null, '', 'budget', 'linear', 'standard_snake', 1, {}, []]) {
    assert.equal(resolveGolfRules({ gameType: invalid, draft: { type: 'salary_cap' } }).draft.type, 'salary_cap');
    assert.equal(resolveGolfRules({ gameType: invalid }).gameType, 'standard');
    const rules = resolveGolfRules({ gameType: 'best_ball', draft: { type: invalid }, rosterPeriods: { type: 'split_after_round_2' } });
    assert.equal(rules.gameType, 'best_ball');
    assert.equal(rules.draft.type, 'snake');
    assert.equal(rules.rosterPeriods.type, 'split_after_round_2');
  }
});

test('salary cap defaults safely and allows explicit positive finite values for either scoring strategy', () => {
  for (const gameType of ['standard', 'best_ball']) {
    for (const salaryCap of [undefined, null, '', '100', 0, -1, Infinity, NaN, true]) {
      assert.equal(resolveGolfRules({ gameType, draft: { type: 'salary_cap', salaryCap } }).draft.salaryCap, 100);
    }
    assert.equal(resolveGolfRules({ gameType, draft: { type: 'salary_cap', salaryCap: 125 } }).draft.salaryCap, 125);
  }
});

test('Group settings stay independent and historical snapshots never inherit another Group or current rules', () => {
  const a = { gameType: 'best_ball', draft: { type: 'salary_cap', salaryCap: 120 }, roster: { slots: [{ position: 'GOLFER', slotCount: 6 }] } };
  const b = { gameType: 'standard', draft: { type: 'snake' } };
  const frozen = json(resolveGolfRules(a));
  a.roster.slots[0].slotCount = 8;
  assert.equal(resolveGolfRules(frozen).roster.slots[0].slotCount, 6);
  assert.equal(resolveGolfRules(b).roster.slots[0].slotCount, 4);
  assert.equal(resolveGolfRules({ roster: frozen.roster }).gameType, 'standard');
  const switched = resolveGolfRules({ ...frozen, gameType: 'standard' });
  assert.deepEqual(json(switched.roster), frozen.roster);
  assert.deepEqual(json(switched.draft), frozen.draft);
});

test('sport-tagged NBA/NFL settings cannot contaminate Golf; existing runtime resolver remains unchanged', () => {
  for (const sport of ['nba', 'nfl']) {
    const defaults = getDefaultLeagueRules(sport);
    assert.deepEqual(json(resolveGolfRules(defaults)), json(resolveGolfRules(null)));
    assert.deepEqual(json(resolveLeagueRules({ sport, settings: { gameType: 'best_ball', draft: { type: 'salary_cap' }, rosterPeriods: { type: 'split_after_round_2' } } })), json(defaults));
    assert.equal(resolveLeagueRules({ sport, settings: { draft: { type: 'linear' } } }).draft.type, 'linear');
  }
  assert.deepEqual(json(resolveLeagueRules({ sport: 'golf', settings: null })), json(getDefaultLeagueRules('golf')));
});
