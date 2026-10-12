/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const sim = require('../lib/bracket/simulation.ts');
const { gameSignificance } = require('../lib/bracket/gameSignificance.ts');
const { gameStory } = require('../lib/bracket/gameStory.ts');
const { gameImplicationsNarrative } = require('../lib/bracket/implicationsNarrative.ts');
const { deriveGameImplications } = require('../lib/bracket/gameImplications.ts');
const { refreshedBracketProvider } = require('../lib/bracket/providerContext.ts');
const setup = preset => { const p = sim.loadSimulationPreset(preset); return { ...p, data: sim.simulationResponse(p.state, p.gameId, { entryId: p.entryId }) }; };
test('consensus with a real later split is distinct from a low-impact game', () => {
  const consensus = setup('unanimous'), quiet = setup('quiet');
  const together = gameStory(consensus.data), low = gameStory(quiet.data);
  assert.equal(together.significance.primary.kind, 'consensus');
  assert.match(together.main.body, /part ways.*semifinal/);
  assert.equal(low.significance.primary.kind, 'low_impact');
  assert.equal(low.supports.length, 0);
  assert.equal(low.showOutcomes, false);
  assert.doesNotMatch(low.main.body, /next round|part ways|championship/);
});
test('unique championship threat outranks obvious current-game points and overlapping facts', () => {
  const { data } = setup('unique');
  const story = gameStory(data);
  assert.equal(story.significance.primary.kind, 'unique_champion');
  assert.match(story.main.headline, /Jordan is the only one.*winning it all/);
  assert.ok(story.significance.candidates.some(row => row.kind === 'personal_path'));
  const occupied = new Set(story.significance.primary.overlap);
  for (const candidate of story.significance.supporting) {
    assert.ok(candidate.overlap.every(key => !occupied.has(key)));
    candidate.overlap.forEach(key => occupied.add(key));
  }
  assert.ok(story.supports.length <= 2);
});
test('shared interest recognizes a rival’s materially larger future dependence', () => {
  const story = gameStory(setup('shared').data);
  assert.equal(story.significance.primary.kind, 'shared_dependency');
  assert.match(story.main.headline, /You need River Rebels.*Jordan.*more riding/);
  assert.match(story.main.body, /140 points.*championship pick/);
});
test('an eliminated personal selection pivots to meaningful rival stakes', () => {
  const story = gameStory(setup('eliminated').data);
  assert.equal(story.significance.primary.kind, 'eliminated_interest');
  assert.match(story.main.headline, /Jordan is out of points.*Casey.*94/);
});
test('a later round or large raw award alone does not create competitive significance', () => {
  const original = setup('championship');
  const entries = sim.simulationEntriesFor(original.state).map(entry => ({ ...entry, picks: { ...sim.simulationEntriesFor(original.state)[0].picks }, rules: { ...entry.rules, championship: 999 } }));
  const analysis = deriveGameImplications({ topology: sim.simulationTopology, gameId: 'champ', results: original.state.results, subject: entries[0], rivals: entries });
  assert.equal(gameSignificance(analysis, true).primary.kind, 'low_impact');
  assert.equal(gameSignificance(analysis, true).competitiveDifference, false);
});
test('pre-lock generation and hidden candidates do not summarize rivals, even with an overfull response', () => {
  const { data } = setup('unique'); data.poolState = 'pre_lock';
  const story = gameStory(data);
  assert.equal(story.significance.primary.kind, 'personal_champion');
  assert.doesNotMatch(JSON.stringify(story), /Alex|Casey|Taylor|unique_champion|consensus|shared_dependency/);
  assert.equal(story.finalPosition, null);
  assert.doesNotMatch(JSON.stringify(gameImplicationsNarrative(data)), /Alex|Casey|Taylor|shared_dependency|unique_champion/);
});
test('live lead and provider final are conditional; refreshed scores are ID-matched', () => {
  const { state, gameId, data } = setup('unique');
  const live = sim.transitionSimulation(state, gameId, 'live', 'sim-team-9');
  const liveProvider = sim.simulationMatchup(live, gameId).provider;
  const story = gameStory(data, liveProvider);
  assert.match(story.main.headline, /Lake Lions leads by 7/);
  assert.match(story.main.body, /If that holds.*Jordan’s championship pick would be gone/);
  assert.match(story.status, /Nothing is settled/);
  const final = sim.transitionSimulation(live, gameId, 'provider_final', 'sim-team-9');
  const pending = gameStory(sim.simulationResponse(final, gameId, { entryId: 2 }), sim.simulationMatchup(final, gameId).provider);
  assert.match(pending.main.headline, /finished ahead on the scoreboard/);
  assert.match(pending.main.body, /If the official result confirms it/);
  assert.equal(pending.showOutcomes, false);
  assert.equal(pending.championship, null);
  const updated = refreshedBracketProvider(liveProvider, { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [
    { id: 'sim-team-8', score: '21' }, { id: 'sim-team-9', score: '10' }, { id: 'foreign', score: '99' },
  ] }] } });
  assert.equal(updated.awayTeam.score, 21);
  assert.match(gameStory(data, updated).main.headline, /River Rebels leads by 11/);
  const tied = { ...updated, homeTeam: { ...updated.homeTeam, score: 21 } };
  assert.doesNotMatch(gameStory(data, tied).main.headline, /leads/);
});
test('official first-round elimination uses lost points, excluding current and already impossible selections', () => {
  const { data } = setup('upset');
  const story = gameStory(data);
  assert.equal(story.phase, 'official');
  assert.equal(story.showOutcomes, false);
  assert.match(story.main.body, /140 points that had been possible from later River Rebels wins/);
  assert.doesNotMatch(JSON.stringify(story), /140 points are still available|If that holds|would be gone/);
  assert.equal(data.analysis.entryStates.find(row => row.entryId === 2).championStatus, 'eliminated');
});
test('quarterfinal loss removes only semifinal/championship opportunities, while later valid winners can still score', () => {
  let state = sim.transitionSimulation(sim.initialSimulationState(), 'r1-1', 'official_final', 'sim-team-8');
  state = sim.transitionSimulation(state, 'qf-1', 'official_final', 'sim-team-1');
  const data = sim.simulationResponse(state, 'qf-1', { entryId: 2 });
  assert.equal(data.analysis.outcomes[0].subject.futureCeilingLost, 120);
  assert.match(gameStory(data).main.body, /120 points that had been possible/);
  const viewed = sim.simulationResponse(state, 'qf-1', { entryId: 4 });
  assert.equal(viewed.analysis.subject.gamePointsEarned, 20);
  let unexpected = sim.transitionSimulation(sim.initialSimulationState(), 'r1-1', 'official_final', 'sim-team-9');
  unexpected = sim.transitionSimulation(unexpected, 'qf-1', 'official_final', 'sim-team-1');
  const correctDespiteOpponent = sim.simulationResponse(unexpected, 'qf-1', { entryId: 4 });
  assert.equal(correctDespiteOpponent.analysis.subject.gamePointsEarned, 20);
  assert.match(gameStory(correctDespiteOpponent).recap.join(' '), /Taylor \(20\)/);
});
test('championship official result celebrates winner/runner-up, correct picks and confirmed final points positions', () => {
  const p = setup('complete');
  const story = gameStory(p.data, sim.simulationMatchup(p.state, p.gameId).provider);
  assert.equal(story.significance.primary.kind, 'champion_recap');
  assert.equal(story.championship.champion, 'Harbor Bears');
  assert.equal(story.championship.runnerUp, 'Summit Eagles');
  assert.ok(story.championship.score);
  assert.match(story.main.headline, /Harbor Bears are national champions/);
  assert.match(story.main.body, /Summit Eagles.*final added no points/);
  assert.equal(story.finalPosition.rank, 3);
  assert.equal(story.finalPosition.earned, 200);
  assert.match(story.recap.join(' '), /You finished tied #3.*Casey and Taylor shared first place/);
  const correct = gameStory(sim.simulationResponse(p.state, 'champ', { entryId: 4 }));
  assert.match(correct.main.body, /Taylor picked the champion and earned 80 championship points/);
  assert.equal(correct.finalPosition.rank, 1);
  assert.doesNotMatch(JSON.stringify(story), /out of points here|scoring ceiling|win probability/);
});
test('final ranks and contest leaders remain hidden without an authoritative frozen pool', () => {
  const p = setup('complete');
  for (const poolState of ['pre_lock', 'freezing']) {
    const data = sim.simulationResponse(p.state, 'champ', { entryId: 1 }, true); data.poolState = poolState;
    assert.equal(data.analysis.finalStandings, null);
    const story = gameStory(data);
    assert.equal(story.finalPosition, null);
    assert.doesNotMatch(story.recap.join(' '), /first place|finished.*#|Casey|Taylor/);
  }
  const pending = setup('championship');
  assert.equal(pending.data.analysis.finalStandings, null);
  assert.equal(gameStory(pending.data, 'post').championship, null);
});
test('final recap does not present earlier eliminated selections as still attainable', () => {
  const p = setup('complete');
  // View a earlier game after the entire graph has finished: historical loss is past tense, current future is zero.
  const data = sim.simulationResponse(p.state, 'qf-1', { entryId: 2 });
  const story = gameStory(data);
  assert.doesNotMatch(story.recap.join(' '), /still has.*available/);
  assert.ok(data.analysis.entryStates.every(row => row.remaining === 0));
});
test('all presets validate picks/results, and scenario/entrant changes produce different story kinds', () => {
  const kinds = new Set();
  for (const preset of sim.simulationPresets) {
    const p = setup(preset.id); kinds.add(gameStory(p.data).significance.primary.kind);
    assert.equal(p.data.analysis.gameId, p.gameId);
  }
  assert.ok(kinds.size >= 6, [...kinds].join(','));
});
test('selection and prioritization never mutate graphs, rules, results or response facts', () => {
  const p = setup('unique'); const saved = JSON.stringify(p);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(p); gameStory(p.data); gameSignificance(p.data.analysis, true);
  assert.equal(JSON.stringify(p), saved);
});
