/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const repositoryRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(repositoryRoot, request.slice(2))
    : request;

  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });

  module._compile(compiled.outputText, filename);
};

const { acceptGolfHole, shotcastObservation } = require('../lib/golf/holeAcceptance.ts');
const { reconcileGolfState } = require('../lib/golf/reconcileState.ts');
const { parseGolfTournamentsFromPayload } = require('../lib/providers/golf.ts');
const t = n => `2026-09-08T12:${String(n).padStart(2,'0')}:00.000Z`;
const hole = (strokes = 4, source = 'espn', minute = 1, number = 1) => ({
  round_id: 10, hole_number: number, strokes, relative_to_par: strokes - 4,
  reconciliation: { source, observedAt: t(minute), final: true },
});
function fixture() {
  return { slateId: 7, events: [{ id: 1, slate_id: 7, player_id: 100, status: 'active', official_score_to_par: 0,
    fantasy_score: 0, penalty_strokes: 0, holes_completed: 1, rounds_completed: 0,
    current_round: 1, last_hole: 1,
    golf_rounds: [{ id: 10, event_player_id: 1, round_number: 1, score_to_par: 0,
      strokes: 4, holes_completed: 1, status: 'active', tee_time: '2026-09-08T11:00:00Z',
      accepted_revision: 1, golf_holes: [hole()] }],
  }], lineups: [{team_id: 20, lineup_players: [{player_id: 100}]}], slateTeams: [{team_id:20,draft_order:1}],
  teams: [{slate_id:7,team_id:20,fantasy_points:0,finish_position:1,games_completed:0,games_in_progress:1,games_remaining:0}], penaltyPerRound: 10 };
}
function espn(strokes = 5, minute = 2) {
  // Real ESPN linescores shape passed through the existing parser.
  const [tournament] = parseGolfTournamentsFromPayload({events:[{id:'1',name:'Fixture',status:{type:{state:'in'}},competitions:[{
    status:{period:1,type:{state:'in'}},competitors:[{id:'100',athlete:{displayName:'Golfer'},score: strokes===4?'E':`+${strokes-4}`,
      linescores:[{period:1,value:strokes,displayValue:strokes===4?'E':`+${strokes-4}`,linescores:[{
        period:1,value:strokes,displayValue:strokes===4?'E':`+${strokes-4}`,scoreType:{displayValue:strokes===4?'E':`+${strokes-4}`},
      }]}]}],
  }]}]});
  const round = tournament.competitors[0].rounds[0];
  return { observedAt: t(minute), rounds:[{event_player_id:1,round_number:1,strokes:round.strokes,score_to_par:round.scoreToPar,holes_completed:round.holesCompleted}],
    holes:round.holes.map(h=>({...hole(h.strokes,'espn',minute),relative_to_par:h.relativeToPar})) };
}
const run = (state,batch,revision=2) => reconcileGolfState(state,batch,revision);
const roundOf = result => result.events[0].golf_rounds[0];
test('ESPN omission preserves accepted hole, round, and teams', () => {
 const result=run(fixture(),{observedAt:t(2),holes:[],rounds:[{event_player_id:1,round_number:1,holes_completed:0,score_to_par:null,strokes:null}]});
 assert.equal(roundOf(result).golf_holes[0].strokes,4); assert.equal(roundOf(result).strokes,4); assert.equal(result.teamWrites.length,0);
});
test('newer coherent ESPN correction to a WORSE score updates hole, round, and fantasy team', () => {
 const result=run(fixture(),espn(5));
 assert.equal(roundOf(result).golf_holes[0].strokes,5); assert.equal(roundOf(result).score_to_par,1);
 assert.equal(result.events[0].fantasy_score,1); assert.equal(result.teamWrites[0].fantasy_points,1);
 assert.equal(roundOf(result).tee_time,'2026-09-08T11:00:00Z');
});
test('ShotCast final evidence improves an incomplete ESPN observation', () => {
 const state=fixture(); const r=state.events[0].golf_rounds[0]; r.golf_holes=[];r.holes_completed=0;r.strokes=null;r.score_to_par=null;
 state.events[0].holes_completed=0;
 const observation=shotcastObservation({holeNumber:1,par:4,shots:[1,2,3].map(n=>({strokeNumber:n,finalStroke:n===3}))},t(2));
 const result=run(state,{observedAt:t(2),holes:[{...observation,round_id:10}]});
 assert.equal(roundOf(result).strokes,3); assert.equal(result.teamWrites[0].fantasy_points,-1);
});
test('stale ESPN cannot overwrite accepted ShotCast',()=>{
 const state=fixture(); state.events[0].golf_rounds[0].golf_holes=[hole(4,'shotcast',3)];
 const result=run(state,espn(5,2)); assert.equal(roundOf(result).golf_holes[0].strokes,4);assert.equal(result.teamWrites.length,0);
});
test('later validated official correction can replace ShotCast reconstruction',()=>{
 const state=fixture();state.events[0].golf_rounds[0].golf_holes=[hole(4,'shotcast',1)];
 const result=run(state,espn(5));assert.equal(roundOf(result).strokes,5);
 assert.equal(roundOf(result).golf_holes[0].reconciliation.source,'espn');
});
test('newer incomplete ESPN coverage cannot erase richer accepted ShotCast data',()=>{
 const state=fixture();state.events[0].golf_rounds[0].golf_holes=[hole(4,'shotcast',1)];
 const batch=espn(5);batch.rounds[0].strokes=8;
 const result=run(state,batch);assert.equal(roundOf(result).strokes,4);assert.equal(result.teamWrites.length,0);
});
test('temporarily absent golfer is unchanged, never retracted or withdrawn',()=>{
 const state=fixture(),result=run(state,{observedAt:t(5),events:[],holes:[]});
 assert.equal(result.events[0].status,'active');assert.equal(roundOf(result).golf_holes.length,1);assert.equal(result.teamWrites.length,0);
});
test('repeated refreshes converge; provenance confirmations do not rewrite team results or change round revision',()=>{
 const first=run(fixture(),espn(5));const state={...fixture(),events:first.events,teams:first.teamRows};
 const repeated=run(state,espn(5,3),3);assert.equal(repeated.teamWrites.length,0);
 assert.equal(roundOf(repeated).accepted_revision,2);assert.equal(repeated.scoringChanged,false);
 const exact=run({...state,events:repeated.events},espn(5,3),4);assert.equal(exact.holeWrites.length,0);
});
test('new ShotCast reconstruction does not override a completed official hole',()=>{
 assert.equal(acceptGolfHole(hole(),hole(3,'shotcast',3)),false);
});
test('malformed, nonfinal and gapped shots cannot become a completed hole',()=>{
 assert.equal(shotcastObservation({holeNumber:1,par:4,shots:[{strokeNumber:3,finalStroke:true}]},t(2)),null);
 assert.equal(shotcastObservation({holeNumber:1,par:4,shots:[{strokeNumber:1,finalStroke:false}]},t(2)),null);
 assert.equal(acceptGolfHole(hole(),{...hole(5),reconciliation:{source:'espn',observedAt:t(3),final:false}}),false);
});
test('explicit official retraction needs provider evidence; omission/null is insufficient',()=>{
 const next={...hole(),strokes:null,relative_to_par:null,reconciliation:{source:'espn',observedAt:t(3),final:false,operation:'retract',officialValidated:true}};
 assert.equal(acceptGolfHole(hole(),next),false);
 next.reconciliation.providerUpdatedAt=t(3);next.reconciliation.correctionReason='official score rescinded';
 assert.equal(acceptGolfHole(hole(),next),true);
});
test('Traditional missing-round penalty remains four rounds and uses configured penalty',()=>{
 const state=fixture();state.events[0].status='cut';state.events[0].rounds_completed=2;state.events[0].penalty_strokes=20;state.events[0].fantasy_score=20;
 const result=run(state,espn(5));assert.equal(result.events[0].penalty_strokes,20);assert.equal(result.events[0].fantasy_score,21);
});
test('modal has no persistent score overlay; accepted revision remounts replay after new props',()=>{
 const source=require('node:fs').readFileSync(path.join(repositoryRoot,'components/lineups/GolfPlayerModal.tsx'),'utf8');
 assert.doesNotMatch(source,/reconciledHoleMap|setReconciledHoleMap/);
 assert.match(source,/new Map\(round.holes.map/);assert.match(source,/key=\{`[^`]*round.accepted_revision/);
});

test('gradual historical card coverage never double-counts aggregate holes or strokes', () => {
  let state = fixture();
  Object.assign(state.events[0].golf_rounds[0], { holes_completed: 18, strokes: 72, score_to_par: 0, status: 'finished' });
  Object.assign(state.events[0], { holes_completed: 18, rounds_completed: 1, status: 'round_complete' });
  for (let n = 2; n <= 18; n++) {
    const result = run(state, { observedAt: t(n), holes: [hole(4, 'shotcast', n, n)] }, n);
    assert.equal(roundOf(result).holes_completed, 18);
    assert.equal(roundOf(result).strokes, 72);
    assert.equal(result.events[0].fantasy_score, 0);
    state = { ...state, events: result.events, teams: result.teamRows };
  }
  assert.equal(state.events[0].golf_rounds[0].reconciliation.legacyAggregate, undefined);
});

test('explicit retraction recomputes golfer progress and team results without deleting the hole row', () => {
  const observation = { ...hole(), strokes: null, relative_to_par: null, reconciliation: {
    source: 'espn', observedAt: t(3), final: false, operation: 'retract', officialValidated: true,
    providerUpdatedAt: t(3), correctionReason: 'official score rescinded',
  } };
  const state = fixture(); state.events[0].golf_rounds[0].golf_holes = [hole(5)];
  state.events[0].golf_rounds[0].score_to_par = 1; state.events[0].golf_rounds[0].strokes = 5;
  state.events[0].official_score_to_par = 1; state.events[0].fantasy_score = 1; state.teams[0].fantasy_points = 1;
  const result = run(state, { observedAt: t(3), holes: [observation] });
  assert.equal(roundOf(result).golf_holes.length, 1);
  assert.equal(roundOf(result).golf_holes[0].strokes, null);
  assert.equal(roundOf(result).holes_completed, 0);
  assert.equal(result.events[0].holes_completed, 0);
  assert.equal(result.events[0].status, 'scheduled');
  assert.equal(result.events[0].last_hole, null);
  assert.equal(result.teamWrites[0].fantasy_points, 0);
  assert.equal(result.teamWrites[0].games_remaining, 1);
});

test('stale batch has no hole, round, golfer, or team writes', () => {
  const first = run(fixture(), espn(5, 3));
  const state = { ...fixture(), events: first.events, teams: first.teamRows };
  const stale = run(state, espn(4, 2));
  for (const key of ['holeWrites', 'roundWrites', 'eventWrites', 'teamWrites']) assert.equal(stale[key].length, 0, key);
  assert.equal(stale.scoringChanged, false);
  assert.strictEqual(stale.teamRows, state.teams);
});

test('invalid round coverage cannot validate an official correction', () => {
  const batch = espn(5); batch.rounds[0].holes_completed = 2;
  assert.equal(roundOf(run(fixture(), batch)).golf_holes[0].strokes, 4);
});

test('mixed ESPN and ShotCast batch validates official coverage independently', () => {
  const batch = espn(5);
  batch.holes.push(hole(3, 'shotcast', 3, 2));
  const result = run(fixture(), batch);
  assert.deepEqual(roundOf(result).golf_holes.map(h => h.strokes), [5, 3]);
  assert.equal(roundOf(result).holes_completed, 2);
  assert.equal(result.teamRows[0].fantasy_points, 0);
});

test('coarse ESPN agreement cannot demote validated ShotCast provenance', () => {
  const state = fixture(); state.events[0].golf_rounds[0].golf_holes = [hole(4, 'shotcast', 1)];
  const batch = espn(4); batch.rounds[0].strokes = 8;
  assert.equal(roundOf(run(state, batch)).golf_holes[0].reconciliation.source, 'shotcast');
});

test('a correction to an earlier hole does not move the last played hole backward', () => {
  const state = fixture(); const round = state.events[0].golf_rounds[0];
  round.golf_holes.push(hole(4, 'espn', 1, 2)); round.holes_completed = 2; round.strokes = 8;
  state.events[0].holes_completed = 2; state.events[0].last_hole = 2;
  const batch = espn(5); batch.holes.push(hole(4, 'espn', 2, 2));
  Object.assign(batch.rounds[0], { strokes: 9, holes_completed: 2 });
  assert.equal(run(state, batch).events[0].last_hole, 2);
});

test('accepted revision guard rejects late responses, permits repeats, and scopes revisions to a slate', () => {
  const { shouldApplyGolfSnapshot } = require('../lib/client/refreshGolfFromBrowser.ts');
  const current = { slateId: 7, revision: 8 };
  assert.equal(shouldApplyGolfSnapshot(current, 7, 7), false);
  assert.equal(shouldApplyGolfSnapshot(current, 7, 8), true);
  assert.equal(shouldApplyGolfSnapshot(current, 7, 9), true);
  assert.equal(shouldApplyGolfSnapshot(current, 9, 0), true);
  assert.equal(shouldApplyGolfSnapshot(current, 7, NaN), false);
});

test('Traditional lower-score ranking and draft-order tiebreak remain unchanged', () => {
  const { calculateGolfTeamResults } = require('../lib/golf/teamResults.ts');
  const players = [{ player_id: 1, fantasy_score: -4, status: 'finished' }, { player_id: 2, fantasy_score: -4, status: 'finished' }, { player_id: 3, fantasy_score: 2, status: 'active' }];
  const teams = calculateGolfTeamResults(7, players, [], [1, 2, 3].map(n => ({ team_id: n, lineup_players: [{ player_id: n }] })), [{ team_id: 1, draft_order: 2 }, { team_id: 2, draft_order: 1 }]);
  assert.deepEqual(teams.map(t => [t.team_id, t.fantasy_points, t.finish_position]), [[2, -4, 1], [1, -4, 2], [3, 2, 3]]);
  assert.equal(teams[0].games_completed, 1); assert.equal(teams[2].games_in_progress, 1);
});

const originalLoad = Module._load;
const mockAdmin = {};
Module._load = function(request, parent, isMain) {
  if (request === '@/lib/supabaseAdmin') return { supabaseAdmin: mockAdmin };
  return originalLoad.call(this, request, parent, isMain);
};
const { reconcileGolf } = require('../lib/golf/reconcileGolf.ts');
Module._load = originalLoad;

function mockDatabase(state, rpc) {
  mockAdmin.from = table => {
    const rows = { golf_accepted_versions: { revision: 1 }, golf_event_players: state.events,
      lineups: state.lineups, slate_teams: state.slateTeams, team_slate_results: state.teams,
      slates: { sport: 'golf', has_cut: true, cut_penalty_per_round: 10 } };
    const query = { then: resolve => Promise.resolve({ data: rows[table], error: null }).then(resolve) };
    for (const method of ['select', 'eq', 'single', 'maybeSingle']) query[method] = () => query;
    return query;
  };
  mockAdmin.rpc = rpc;
}

test('shared service retries CAS conflicts and submits round and team changes in the same RPC', async () => {
  let calls = 0;
  mockDatabase(fixture(), async (name, patch) => {
    calls++;
    assert.equal(name, 'commit_golf_reconciliation');
    assert.equal(patch.p_holes[0].strokes, 5);
    assert.equal(patch.p_rounds[0].score_to_par, 1);
    assert.equal(patch.p_teams[0].fantasy_points, 1);
    return { data: calls === 1 ? { conflict: true } : { revision: 2 }, error: null };
  });
  const result = await reconcileGolf(7, espn(5));
  assert.equal(calls, 2); assert.equal(result.revision, 2);
});

test('failed atomic commit is surfaced rather than reporting accepted scoring', async () => {
  mockDatabase(fixture(), async () => ({ data: null, error: { message: 'transaction rejected' } }));
  await assert.rejects(reconcileGolf(7, espn(5)), /transaction rejected/);
});

test('migration restricts atomic writes to service_role and locks the slate revision', () => {
  const sql = require('node:fs').readFileSync(path.join(repositoryRoot, 'supabase/migrations/20260911000100_golf_accepted_reconciliation.sql'), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on function[^;]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[^;]+to service_role/);
  assert.match(sql, /for update/);
  assert.match(sql, /v_revision <> p_expected_revision/);
  assert.doesNotMatch(sql, /delete from|truncate /i);
});

test('backfilling an event-only historical aggregate does not count new rounds twice', () => {
  const state = fixture();
  Object.assign(state.events[0], { holes_completed: 36, rounds_completed: 2, official_score_to_par: -4, fantasy_score: -4, status: 'round_complete' });
  Object.assign(state.events[0].golf_rounds[0], { holes_completed: 0, strokes: null, score_to_par: null, golf_holes: [], status: 'scheduled' });
  const result = run(state, { observedAt: t(2), holes: [hole(3, 'shotcast', 2)] });
  assert.equal(result.events[0].holes_completed, 36);
  assert.equal(result.events[0].rounds_completed, 2);
  assert.equal(result.events[0].fantasy_score, -4);
});

test('replay route returns accepted scores rather than conflicting shot reconstruction', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const calls = [];
  const records = {
    slates: { id: 7, sport: 'golf', display_name: 'Fixture', start_date: '2026-09-08' },
    golf_players: { id: 100, display_name: 'Golfer' },
    golf_event_players: { id: 1, golf_rounds: [{ id: 10, round_number: 1 }] },
  };
  const db = { from(table) {
    const q = { then: resolve => Promise.resolve({ data: records[table], error: null }).then(resolve) };
    for (const method of ['select', 'eq', 'single', 'maybeSingle']) q[method] = () => q;
    return q;
  } };
  const accepted = run(fixture(), espn(5));
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabaseAdmin': { supabaseAdmin: db },
    '@/lib/security/resourceAuthorization': { authorizeSlateResource: async () => ({ ok: true }) },
    '@/lib/golf/holeAcceptance': { shotcastObservation },
    '@/lib/golf/reconcileGolf': { reconcileGolf: async (slate, batch) => { calls.push({ slate, batch }); return { ...accepted, revision: 2 }; } },
    '@/lib/providers/pgaTourShots': { fetchGolfHoleReplay: async () => ({ observedAt: t(1), par: 4,
      shots: [1, 2, 3].map(n => ({ strokeNumber: n, finalStroke: n === 3 })) }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(repositoryRoot, 'app/api/golf/hole-replay/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, console, require: id => mocks[id] });
  const result = await module.exports.GET({ nextUrl: new URL('http://localhost/?slateId=7&playerId=100&round=1&hole=1') });
  assert.equal(result.status, 200);
  assert.equal(calls[0].slate, 7);
  assert.equal(calls[0].batch.holes[0].reconciliation.observedAt, t(1));
  assert.equal(result.body.reconciledHole.strokes, 5);
  assert.equal(result.body.acceptedRevision, 2);
});
