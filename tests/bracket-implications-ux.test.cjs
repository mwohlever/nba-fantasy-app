/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { parseBracketLiveState, bracketLiveSearch, resolveImplicationSubject } = require('../lib/bracket/liveState.ts');
const { gameImplicationsNarrative } = require('../lib/bracket/implicationsNarrative.ts');
const { deriveGameImplications } = require('../lib/bracket/gameImplications.ts');
const subject = (id, name, own = false) => ({ contestId: 'contest', competitionId: 1, entryId: id, masterBracketId: `m${id}`, entrantId: name,
  entrantName: name, isAccountOwner: own, bracketNumber: 1, label: `${name} · Bracket 1`, snapshotStatus: 'frozen' });
const topology = { games: [
  { id: 'semi', roundKey: 'semifinal', roundOrder: 1, gameOrder: 1, sources: [{ type: 'team', teamId: 'A' }, { type: 'team', teamId: 'B' }] },
  { id: 'final', roundKey: 'championship', roundOrder: 2, gameOrder: 1, sources: [{ type: 'winner', gameId: 'semi' }, { type: 'team', teamId: 'C' }] },
] };
const entries = [
  { id: 1, label: 'Mark · Bracket 1', picks: { semi: 'A', final: 'C' }, rules: { semifinal: 3, championship: 17 } },
  { id: 2, label: 'Josh · Bracket 1', picks: { semi: 'A', final: 'A' }, rules: { semifinal: 7, championship: 31 } },
  { id: 3, label: 'Andy · Bracket 1', picks: { semi: 'B', final: 'B' }, rules: { semifinal: 10, championship: 19 } },
];
function response({ own = true, results = {}, gameId = 'semi', pool = 'available', picks, rules } = {}) {
  const current = { ...entries[0], ...(picks ? { picks } : {}), ...(rules ? { rules } : {}) };
  return { contestId: 'contest', competitionId: 1, subject: subject(1, own ? 'Mark' : 'Nico', own),
    subjects: [subject(1, own ? 'Mark' : 'Nico', own), subject(2, 'Josh'), subject(3, 'Andy')],
    poolState: pool, teamNames: { A: 'Alpha', B: 'Beta', C: 'Gamma' },
    analysis: deriveGameImplications({ topology, gameId, subject: current, results, rivals: pool === 'available' ? entries.slice(1) : null }) };
}
test('default is exactly one account-owned subject; multiple or managed-only entries require selection', () => {
  const own = subject(1, 'Mark', true), managed = subject(2, 'Nico'), other = subject(3, 'Josh');
  assert.equal(resolveImplicationSubject([own, managed, other], null, false), own);
  assert.equal(resolveImplicationSubject([own, { ...own, entryId: 4, bracketNumber: 2 }], null, false), null);
  assert.equal(resolveImplicationSubject([managed], null, false), null);
  assert.equal(resolveImplicationSubject([own, other], { entryId: 3 }, true), other);
  assert.equal(resolveImplicationSubject([own], { entryId: 99 }, true), null);
  assert.equal(resolveImplicationSubject([own], null, true), null);
});
test('game/tab URLs survive reload; Back to games and switching games preserve selected identity', () => {
  const search = bracketLiveSearch('entryId=2&group=one', { gameId: 'semi', tab: 'implications' });
  assert.deepEqual(parseBracketLiveState(search), { gameId: 'semi', devEventId: null, tab: 'implications', selection: { entryId: 2 }, selectionRequested: true });
  const back = bracketLiveSearch(search, { gameId: null, devEventId: null });
  assert.equal(parseBracketLiveState(back).gameId, null);
  assert.equal(parseBracketLiveState(back).tab, 'implications');
  assert.deepEqual(parseBracketLiveState(back).selection, { entryId: 2 });
  assert.equal(new URLSearchParams(back).get('group'), 'one');
  assert.equal(parseBracketLiveState(bracketLiveSearch(back, { gameId: 'final' })).gameId, 'final');
});
test('malformed bracket identities never trigger a different personal default; invalid tabs fall back to Summary', () => {
  for (const search of ['entryId=', 'entryId=abc', 'entryId=2&entrantId=Josh', 'entrantId=Josh', 'bracket=2']) {
    const state = parseBracketLiveState(search);
    assert.equal(state.selection, null);
    assert.equal(state.selectionRequested, true);
  }
  assert.equal(parseBracketLiveState('gameId=&tab=bogus').gameId, '');
  assert.equal(parseBracketLiveState('gameId=semi&tab=bogus').tab, 'summary');
  const draft = { ...subject(4, 'Nico'), entryId: null, snapshotStatus: 'draft', bracketNumber: 2 };
  assert.deepEqual(parseBracketLiveState(bracketLiveSearch('entryId=1', { subject: draft })).selection, { entrantId: 'Nico', bracketNumber: 2 });
});
test('personal narrative names actual picks, rival needs, and per-entry points without a rooting recommendation', () => {
  const narrative = gameImplicationsNarrative(response());
  assert.match(narrative.headline, /You’ve got Alpha winning here. Josh needs them to go farther/);
  assert.equal(narrative.cards[0].award, 'You earn 3 points');
  assert.match(narrative.cards[0].rivals[0], /Andy has Beta reaching the championship.*19 points/);
  assert.match(narrative.notes[0], /then Gamma in the championship.*Josh picked Alpha to win it all/);
  assert.match(narrative.comparison, /You and Josh agree on Alpha. Andy picked Beta/);
  assert.doesNotMatch(JSON.stringify(narrative), /should root|scoring ceiling|downstream|win probability|guarantees/);
});
test('managed or other entrants are named, never addressed as the viewer', () => {
  const narrative = gameImplicationsNarrative(response({ own: false }));
  assert.match(narrative.headline, /^Nico has Alpha/);
  assert.equal(narrative.cards[0].award, 'Nico earns 3 points');
  assert.doesNotMatch(JSON.stringify(narrative), /\bYou\b|\byour\b|You’ve/);
});
test('completed games use past tense and only the actual outcome, including eliminated rival championship picks', () => {
  const narrative = gameImplicationsNarrative(response({ results: { semi: 'B' } }), 'post');
  assert.equal(narrative.cards.length, 1);
  assert.equal(narrative.headline, 'Beta won. You earned 0 points.');
  assert.match(narrative.cards[0].rivals[0], /Josh had Alpha.*win knocked out.*31 points/);
  assert.doesNotMatch(JSON.stringify(narrative.cards), /If |would |earns/);
});
test('live and provider-final scores never produce confirmed advancement prose', () => {
  assert.match(gameImplicationsNarrative(response(), 'in').context, /score is live/);
  assert.match(gameImplicationsNarrative(response(), 'post').context, /official advancement is still pending/);
  assert.ok(gameImplicationsNarrative(response(), 'post').cards.every(card => card.title.startsWith('If ')));
});
test('pre-lock and incomplete snapshots omit rival narratives; zero points do not imply an incorrect pick', () => {
  for (const pool of ['pre_lock', 'freezing']) {
    const narrative = gameImplicationsNarrative(response({ pool }));
    assert.ok(narrative.cards.every(card => card.rivals.length === 0));
    assert.equal(narrative.comparison, null);
    assert.equal(narrative.consensus.length, 0);
    assert.ok(narrative.privacy);
  }
  const narrative = gameImplicationsNarrative(response({ results: { semi: 'A' }, rules: { semifinal: 0, championship: 17 } }));
  assert.equal(narrative.cards[0].award, 'You earned 0 points');
  assert.doesNotMatch(narrative.headline, /wrong|incorrect|out/);
});
test('unresolved games describe conditional participation and no confirmed matchup', () => {
  const narrative = gameImplicationsNarrative(response({ gameId: 'final' }));
  assert.match(narrative.context, /matchup isn’t set/);
  assert.ok(narrative.cards.every(card => card.title.includes('reaches this game')));
});
