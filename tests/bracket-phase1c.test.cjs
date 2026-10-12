/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const sim = require('../lib/bracket/simulation.ts');
const { derivePersonalGamePath } = require('../lib/bracket/personalPath.ts');
const { deriveGameImplications } = require('../lib/bracket/gameImplications.ts');
const { gameImplicationsNarrative } = require('../lib/bracket/implicationsNarrative.ts');
const { bracketMatchupFacts, unboundBracketGame } = require('../lib/bracket/gameCenter.ts');
const { validateBracketResults, scoreBracket } = require('../lib/bracket/scoring.ts');
const { validateBracketPicks } = require('../lib/bracket/topology.ts');
const Center = require('../components/bracket/BracketGameCenter.tsx').default;
const CfpSimulationPage = require('../app/dev/cfp-simulation/page.tsx').default;
Module._resolveFilename = resolve;
const team = seed => `sim-team-${seed}`;
const fixture = sim.simulationTopology;
const pathFor = (id, results = {}) => {
  const entry = sim.simulationEntries.find(entry => entry.id === id);
  return derivePersonalGamePath(fixture, 'r1-1', entry.picks, results, entry.rules);
};

test('unbound resolved CFP game reuses the complete shared Game Center shell, with names, logos, seeds, time and four tabs', () => {
  const { matchup } = sim.simulationMatchup(sim.initialSimulationState(), 'r1-1');
  const markup = renderToStaticMarkup(React.createElement(Center, { contestId: 'fixture', gameId: 'r1-1', game: null, matchup,
    gameLabel: 'First round · Game 1', selection: null, selectionRequested: false, onSelectionChange() {}, tab: 'summary', onTabChange() {}, onBack() {} }));
  for (const expected of ['First round · Game 1', '#8 River Rebels', '#9 Lake Lions', 'Time TBD', 'Scheduled', 'Summary', 'Play-by-Play', 'Player Stats', 'Implications', 'Back to games', 'Refresh game center', '/simulation/cfp-team.svg']) assert.ok(markup.includes(expected), expected);
  assert.match(markup, /Live game details aren’t available yet/);
  assert.doesNotMatch(markup, /Invalid Date|Loading away team|role="dialog"/);
  const fallback = unboundBracketGame(matchup);
  assert.equal(fallback.espnEventId, '');
  assert.equal(fallback.kickoffAt, '');
  assert.equal(fallback.awayTeam.score, null);
});
test('unbound tabs remain navigable and unresolved matchups expose only official slots', () => {
  const { matchup } = sim.simulationMatchup(sim.initialSimulationState(), 'qf-1');
  const facts = bracketMatchupFacts(matchup, null);
  assert.equal(facts.participants[0].name, 'Summit Eagles');
  assert.equal(facts.participants[1].name, 'TBD');
  assert.match(facts.participants[1].sourceLabel, /Winner/);
  for (const tab of ['summary', 'pbp', 'stats']) {
    const markup = renderToStaticMarkup(React.createElement(Center, { contestId: 'fixture', gameId: 'qf-1', game: null, matchup,
      selection: null, selectionRequested: false, onSelectionChange() {}, tab, onTabChange() {}, onBack() {} }));
    assert.match(markup, /Live game details aren’t available yet/);
    assert.ok(markup.includes('TBD'));
    assert.doesNotMatch(markup, /River Rebels|Lake Lions/);
  }
});
test('pre-lock personal path explains predicted opponents, next loss, and actual rules', () => {
  const path = pathFor(1);
  assert.equal(path.teamId, team(8));
  assert.equal(path.nextLoss.roundKey, 'semifinal');
  assert.equal(path.additionalPoints, 20);
  assert.equal(path.pointsAtRisk, 30);
  assert.deepEqual(path.wins.map(row => row.predictedOpponentId), [team(9), team(1)]);
  const personal = sim.simulationResponse(sim.initialSimulationState(), 'r1-1', { entryId: 1 }, true);
  const narrative = gameImplicationsNarrative(personal);
  assert.match(narrative.headline, /isn’t just your pick/);
  assert.match(narrative.pathText, /Lake Lions and Summit Eagles.*losing to Forest Owls.*semifinals/);
  assert.match(narrative.stakes.explanation, /30 possible points.*20 from later wins/);
  assert.doesNotMatch(JSON.stringify(narrative), /Jordan|Casey|Taylor/);
});
test('champion exposure, different round values and win-now/lose-next-round paths are personal facts', () => {
  assert.equal(pathFor(2).champion, true);
  assert.equal(pathFor(2).additionalPoints, 140);
  assert.equal(pathFor(2).pointsAtRisk, 150);
  assert.equal(pathFor(3).additionalPoints, 113);
  assert.equal(pathFor(3).pointsAtRisk, 120);
  assert.equal(pathFor(4).nextLoss.nextRound, true);
  assert.equal(pathFor(4).additionalPoints, 0);
  const champion = gameImplicationsNarrative(sim.simulationResponse(sim.initialSimulationState(), 'r1-1', { entryId: 2 }, true));
  assert.match(champion.headline, /Jordan has Lake Lions|Jordan has River Rebels going all the way/);
  assert.doesNotMatch(JSON.stringify(champion), /You’ve|your/);
});
test('wrong predicted opponent does not erase a later correct selected winner', () => {
  let state = sim.transitionSimulation(sim.initialSimulationState(), 'r1-1', 'official_final', team(9));
  state = sim.transitionSimulation(state, 'qf-1', 'official_final', team(1));
  const entry = sim.simulationEntries.find(entry => entry.id === 4);
  const path = derivePersonalGamePath(fixture, 'qf-1', entry.picks, state.results, entry.rules);
  assert.equal(path.status, 'correct');
  assert.equal(scoreBracket(fixture, entry.picks, state.results, entry.rules).pointsEarned, 20);
});
test('eliminated selections and incomplete picks add no imaginary future points', () => {
  const results = sim.transitionSimulation(sim.initialSimulationState(), 'r1-1', 'official_final', team(9)).results;
  const path = pathFor(2, results);
  assert.equal(path.status, 'incorrect');
  assert.equal(path.futureWins.length, 0);
  assert.equal(path.pointsAtRisk, 0);
  const entry = sim.simulationEntries[0];
  assert.equal(derivePersonalGamePath(fixture, 'r1-1', {}, {}, entry.rules), null);
});
test('unresolved games provide conditional personal exposure without naming projected participants as actual', () => {
  const data = sim.simulationResponse(sim.initialSimulationState(), 'qf-1', { entryId: 2 }, true);
  assert.equal(data.analysis.matchupConfirmed, false);
  assert.equal(data.analysis.outcomes.length, 0);
  const narrative = gameImplicationsNarrative(data);
  assert.match(narrative.context, /matchup isn’t set/);
  assert.ok(narrative.cards.every(card => card.title.includes('reaches this game')));
});
test('post-lock agreement works even for zero-point rounds and entry-specific future rules remain distinct', () => {
  const data = sim.simulationResponse(sim.initialSimulationState(), 'r1-1', { entryId: 1 }, false);
  assert.equal(data.analysis.totalEntries, 4);
  assert.equal(data.analysis.exposure.find(row => row.teamId === team(8)).selectedCount, 3);
  const lake = data.analysis.outcomes.find(row => row.teamId === team(9));
  assert.equal(lake.rivals.find(row => row.entryId === 2).futureCeilingLost, 140);
  assert.equal(lake.rivals.find(row => row.entryId === 4).futureCeilingLost, 0);
  const narrative = gameImplicationsNarrative(data);
  assert.match(narrative.comparison, /Jordan, and Taylor agree.*Casey picked Lake Lions/);
  const zeros = sim.simulationEntries.map(entry => ({ ...entry, rules: { ...entry.rules, first_round: 0 } }));
  data.analysis = deriveGameImplications({ topology: fixture, gameId: 'r1-1', results: {}, subject: zeros[0], rivals: zeros });
  assert.match(gameImplicationsNarrative(data).comparison, /Jordan, and Taylor agree/);
  assert.ok(data.analysis.outcomes.every(row => row.subject.immediatePoints === 0));
});
test('simulation pregame/live/provider-final never advances an official winner; official-final does', () => {
  let state = sim.initialSimulationState();
  for (const phase of ['pregame', 'live', 'provider_final']) {
    state = sim.transitionSimulation(state, 'r1-1', phase, team(9));
    assert.equal(state.results['r1-1'], undefined);
    const response = sim.simulationResponse(state, 'r1-1', { entryId: 2 });
    assert.equal(response.analysis.outcomes.length, 2);
    assert.equal(response.analysis.officialWinner, null);
  }
  const provider = sim.simulationMatchup(state, 'r1-1');
  assert.match(bracketMatchupFacts(provider.matchup, provider.provider).status, /Awaiting official result/);
  state = sim.transitionSimulation(state, 'r1-1', 'official_final', team(9));
  assert.equal(state.results['r1-1'], team(9));
  assert.equal(sim.simulationResponse(state, 'r1-1', { entryId: 2 }).analysis.outcomes.length, 1);
});
test('changing an earlier result clears all dependent official outcomes and state, preserving unrelated results', () => {
  let state = sim.prepareSimulationMatchup(sim.initialSimulationState(), 'champ', 2);
  state = sim.transitionSimulation(state, 'champ', 'official_final', team(8));
  assert.equal(state.results.champ, team(8));
  state = sim.transitionSimulation(state, 'r1-1', 'official_final', team(9));
  for (const id of ['qf-1', 'sf-1', 'champ']) { assert.equal(state.results[id], undefined); assert.equal(state.phases[id], undefined); }
  assert.ok(state.results['qf-3']);
  validateBracketResults(fixture, state.results);
  assert.throws(() => sim.transitionSimulation(state, 'champ', 'official_final', team(2)), /feeder/);
  assert.throws(() => sim.transitionSimulation(state, 'r1-1', 'official_final', team(12)), /legal participant/);
});
test('removing an official result also invalidates descendants; reset produces clean independent state', () => {
  const initial = sim.initialSimulationState();
  let state = sim.prepareSimulationMatchup(initial, 'champ', 2);
  state = sim.transitionSimulation(state, 'r1-1', 'provider_final', team(8));
  assert.equal(state.results['qf-1'], undefined);
  assert.deepEqual(initial, sim.initialSimulationState());
});
test('all fictional picks are complete and valid, with four distinct championship selections', () => {
  for (const entry of sim.simulationEntries) { validateBracketPicks(fixture, entry.picks); assert.equal(Object.keys(entry.picks).length, 11); }
  assert.equal(new Set(sim.simulationEntries.map(entry => entry.picks.champ)).size, 4);
});
test('analysis and simulation transitions never mutate their source objects', () => {
  const state = sim.prepareSimulationMatchup(sim.initialSimulationState(), 'champ', 2);
  const serialized = JSON.stringify(state);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(state);
  sim.transitionSimulation(state, 'r1-1', 'official_final', team(9));
  sim.simulationResponse(state, 'r1-1', { entryId: 2 }, true);
  assert.equal(JSON.stringify(state), serialized);
  const originalEntries = JSON.stringify(sim.simulationEntries);
  for (const entry of sim.simulationEntries) freeze(entry);
  sim.simulationResponse(state, 'r1-1', { entryId: 2 }, false);
  assert.equal(JSON.stringify(sim.simulationEntries), originalEntries);
});
test('simulation gate denies production/test/unknown environments; server page guard throws notFound', () => {
  const old = process.env.NODE_ENV;
  try {
    for (const environment of ['production', 'test', undefined]) {
      if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
      assert.equal(sim.simulationAvailable(environment), false);
      assert.throws(() => CfpSimulationPage(), /404/);
    }
    process.env.NODE_ENV = 'development';
    assert.ok(CfpSimulationPage());
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});
test('simulation import graph is isolated from production data access and background integrations', () => {
  const visited = new Set();
  function inspect(file) {
    if (visited.has(file)) return; visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    assert.doesNotMatch(compiled, /supabaseAdmin|AppHeartbeat|GroupProvider|AppResumeTracker|sync-results|app-heartbeat|freeze_bracket_entry/);
    for (const match of compiled.matchAll(/require\(["']([^"']+)["']\)/g)) {
      if (!match[1].startsWith('.') && !match[1].startsWith('@/')) continue;
      const base = match[1].startsWith('@/') ? path.join(root, match[1].slice(2)) : path.resolve(path.dirname(file), match[1]);
      const target = [base, `${base}.ts`, `${base}.tsx`].find(target => fs.existsSync(target) && fs.statSync(target).isFile());
      if (target && !target.endsWith('.css')) inspect(target);
    }
  }
  inspect(path.join(root, 'app/dev/cfp-simulation/page.tsx'));
  const runtime = fs.readFileSync(path.join(root, 'components/platform/AppRuntime.tsx'), 'utf8');
  assert.match(runtime, /if \(pathname === "\/dev\/cfp-simulation"\) return <>{children}<\/>/);
  assert.ok(runtime.indexOf('if (pathname') < runtime.indexOf('return <><AppHeartbeat'));
  const simulator = fs.readFileSync(path.join(root, 'components/bracket/BracketTournamentSimulation.tsx'), 'utf8');
  assert.match(simulator, /isolatedSource=\{isolatedSource\}/);
  assert.doesNotMatch(simulator, /fetch\(|localStorage|sessionStorage|setActiveGroup/);
});
