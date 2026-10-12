/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { bracketContestLockContext, effectiveBracketLockAt, shouldFreezeBracketEntry } = require('../lib/bracket/lifecycle.ts');
const { bracketInsightVisibility } = require('../lib/bracket/insights.ts');
const { implicationLockConsistent } = require('../lib/bracket/implicationsContext.ts');
const sim = require('../lib/bracket/simulation.ts');
const { gameImplicationsNarrative } = require('../lib/bracket/implicationsNarrative.ts');
const { gameStory } = require('../lib/bracket/gameStory.ts');

test('contest status and effective deadline retain established global lock semantics', () => {
  const now = new Date('2026-12-20T12:00:00Z');
  for (const status of ['locked', 'in_progress', 'final']) {
    assert.equal(bracketContestLockContext({ contestStatus: status, contestLockAt: '2027-01-01' }, now).locked, true);
  }
  const lock = { contestStatus: 'open', contestLockAt: '2026-12-20T12:00:00Z' };
  assert.equal(shouldFreezeBracketEntry(lock, new Date('2026-12-20T11:59:59Z')), false);
  assert.equal(shouldFreezeBracketEntry(lock, now), true);
  assert.equal(effectiveBracketLockAt('2027-01-01', [{ scheduledAt: '2026-12-20' }]), '2026-12-20');
  assert.equal(effectiveBracketLockAt(null, [{ scheduledAt: null, status: 'in_progress' }]), '1970-01-01T00:00:00.000Z');
});
test('a provider display status does not enter the lock resolver; persisted game state remains the existing safety condition', () => {
  const lock = { contestStatus: 'open', contestLockAt: '2099-01-01' };
  const snapshots = sim.simulationEntries.map(row => ({ id: row.id, entrantId: row.label, lockedAt: '2026-01-01', picks: row.picks, rulesSnapshot: { scoring: { roundPoints: row.rules } } }));
  for (const displayStatus of ['pre', 'in', 'post']) {
    const status = bracketContestLockContext(lock, new Date('2026-01-01'));
    assert.equal(status.locked, false, displayStatus);
    assert.equal(bracketInsightVisibility(lock, snapshots, new Date('2026-01-01')).pool, 'pre_lock');
  }
  const persistedLock = { ...lock, contestLockAt: effectiveBracketLockAt(lock.contestLockAt, [{ scheduledAt: null, status: 'in_progress' }]) };
  assert.equal(bracketContestLockContext(persistedLock, new Date('2026-01-01')).locked, true);
});
test('after lock still requires complete snapshots; lock context and pool state remain separate', () => {
  const lock = { contestStatus: 'locked', contestLockAt: null };
  const entries = sim.simulationEntries.map(row => ({ id: row.id, entrantId: row.label, lockedAt: '2026-01-01', picks: row.picks, rulesSnapshot: { scoring: { roundPoints: row.rules } } }));
  assert.equal(bracketContestLockContext(lock).locked, true);
  assert.equal(bracketInsightVisibility(lock, entries).pool, 'available');
  entries[1].picks = null;
  assert.equal(bracketInsightVisibility(lock, entries).pool, 'freezing');
  assert.equal(implicationLockConsistent({ contestLock: { scope: 'contest', locked: true }, poolState: 'freezing' }), true);
  assert.equal(implicationLockConsistent({ contestLock: { scope: 'contest', locked: false }, poolState: 'available' }), false);
});
test('simulated lock state gates all Group facts independently of every game phase', () => {
  let state = sim.initialSimulationState();
  for (const phase of ['pregame', 'live', 'provider_final', 'official_final']) {
    state = sim.transitionSimulation(state, 'r1-1', phase, 'sim-team-9');
    const before = sim.simulationResponse(state, 'r1-1', { entryId: 2 }, true);
    assert.equal(before.contestLock.locked, false, phase);
    assert.equal(before.poolState, 'pre_lock', phase);
    assert.equal(before.analysis.otherEntries, null);
    assert.equal(before.analysis.entryStates.length, 1);
    assert.equal(before.analysis.finalStandings, null);
    assert.ok(before.analysis.exposure.every(row => row.rivalExposure === null && row.championEntries === null && row.selectedCount === null));
    const narrative = gameImplicationsNarrative(before, sim.simulationMatchup(state, 'r1-1').provider);
    assert.doesNotMatch(JSON.stringify(narrative), /Alex|Casey|Taylor/);
    const after = sim.simulationResponse(state, 'r1-1', { entryId: 2 }, false);
    assert.equal(after.contestLock.locked, true, phase);
    assert.equal(after.poolState, 'available');
    assert.equal(after.analysis.otherEntries, 3);
    assert.equal(after.analysis.subject.pointsEarned, before.analysis.subject.pointsEarned);
    assert.equal(after.analysis.officialWinner, phase === 'official_final' ? 'sim-team-9' : null);
    if (phase !== 'official_final') assert.equal(after.analysis.subject.pointsEarned, 0);
  }
});
test('ten presets explicitly establish after-lock state without changing priorities or completion recaps', () => {
  assert.equal(sim.simulationPresets.length, 10);
  for (const preset of sim.simulationPresets) {
    const loaded = sim.loadSimulationPreset(preset.id);
    assert.equal(loaded.contestLocked, true);
    const result = sim.simulationResponse(loaded.state, loaded.gameId, { entryId: loaded.entryId }, !loaded.contestLocked);
    assert.equal(result.contestLock.locked, true);
    assert.ok(gameStory(result));
  }
  const complete = sim.loadSimulationPreset('complete');
  const story = gameStory(sim.simulationResponse(complete.state, 'champ', { entryId: 1 }, false));
  assert.equal(story.significance.primary.kind, 'champion_recap');
  assert.equal(story.finalPosition.rank, 3);
});
test('lock/visibility evaluation does not mutate input state or pick snapshots', () => {
  const state = sim.initialSimulationState(), saved = JSON.stringify(state);
  Object.freeze(state.results); Object.freeze(state.phases); Object.freeze(state.winners); Object.freeze(state);
  sim.simulationResponse(state, 'r1-1', { entryId: 1 }, true);
  sim.simulationResponse(state, 'r1-1', { entryId: 1 }, false);
  assert.equal(JSON.stringify(state), saved);
});
