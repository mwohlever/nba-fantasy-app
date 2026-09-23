/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
require.extensions[".ts"] = function (module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};

let db;
let providerEvents;
let providerCalls;
let writes;
let freezes;
let recomputes;
let failRecompute;
let authorizedDetail;

function query(table) {
  const filters = [];
  let patch = null;
  const rows = () => db[table].filter((row) => filters.every((filter) => filter(row)));
  const run = () => {
    const matching = rows();
    if (patch) {
      for (const row of matching) { Object.assign(row, structuredClone(patch)); writes.push({ table, id: row.id, patch: structuredClone(patch) }); }
    }
    return { data: matching.map((row) => structuredClone(row)), error: null };
  };
  const chain = {
    select: () => chain,
    eq: (field, value) => { filters.push((row) => row[field] === value); return chain; },
    is: (field, value) => { filters.push((row) => row[field] === value); return chain; },
    in: (field, values) => { filters.push((row) => values.includes(row[field])); return chain; },
    order: () => chain,
    update: (value) => { patch = value; return chain; },
    maybeSingle: async () => { const result = run(); return { data: result.data[0] ?? null, error: null }; },
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}
const admin = {
  from: query,
  rpc: async (name, args) => {
    assert.equal(name, "freeze_bracket_entry");
    const entry = db.bracket_entries.find((row) => row.id === args.p_entry_id);
    assert.ok(entry);
    if (!entry.locked_at) { entry.locked_at = "2026-01-01T00:00:00Z"; freezes.push(entry.id); }
    return { error: null };
  },
};
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "./challenge.server") return { getBracketChallengeDetail: async () => authorizedDetail };
  if (request === "@/lib/providers/ncaa") return { fetchBracketPostseasonEvents: async (competition) => { providerCalls.push(competition); return providerEvents; } };
  if (request === "./scoring.server") return { recomputeFrozenBracketEntriesForCompetition: async (id) => { recomputes.push(id); if (failRecompute) throw new Error("Scoring interrupted"); } };
  if (request === "@/lib/supabaseAdmin") return { supabaseAdmin: admin };
  return originalLoad.call(this, request, parent, isMain);
};
const { syncBracketCompetitionResults } = require("../lib/bracket/competitionSync.server.ts");
const { syncBracketOfficialResults } = require("../lib/bracket/resultSync.server.ts");
Module._load = originalLoad;

const competition = (id = 1) => ({ id, season: 2026, sport_key: "college_football", format_key: "cfp" });
const game = (id, key, round, sourceA, sourceB, eventId, competitionId = 1) => ({
  id, competition_id: competitionId, game_key: key, round_key: round, round_order: round === "first_four" ? 1 : round === "round_of_64" ? 2 : 3, game_order: 1,
  source_a_team_id: typeof sourceA === "string" ? sourceA : null, source_a_game_id: typeof sourceA === "number" ? sourceA : null,
  source_b_team_id: typeof sourceB === "string" ? sourceB : null, source_b_game_id: typeof sourceB === "number" ? sourceB : null,
  provider_event_id: eventId, scheduled_at: "2026-12-19T00:00:00Z", status: "scheduled", winner_team_id: null, metadata: {},
});
const event = (id, away, home, winner, status = "post", completed = true) => ({
  espnEventId: id, status, completed, winnerTeamId: winner,
  awayTeam: { id: away, winner: winner === away, score: winner === home ? 17 : 24 },
  homeTeam: { id: home, winner: winner === home, score: winner === home ? 24 : 17 },
});
function reset() {
  db = { bracket_competitions: [competition()], bracket_games: [game(10, "ff", "first_four", "A", "B", "event-ff")],
    bracket_contests: [{ id: "contest-1", competition_id: 1, status: "open", lock_at: null }],
    bracket_entries: [{ id: 100, competition_id: 1, contest_id: "contest-1", locked_at: null }] };
  providerEvents = []; providerCalls = []; writes = []; freezes = []; recomputes = []; failRecompute = false;
  authorizedDetail = { competition: { id: 1 } };
}

test("manual route retains signed-in, Group-scoped POST authorization and no result input", async () => {
  reset();
  const source = fs.readFileSync(path.join(root, "app/api/bracket-challenge/contests/[contestId]/sync-results/route.ts"), "utf8");
  assert.match(source, /export async function POST/);
  assert.match(source, /getCurrentUser\(\)/);
  assert.match(source, /syncBracketOfficialResults\(user, contestId\)/);
  assert.doesNotMatch(source, /request\.json\(|searchParams|winnerTeamId/);
  authorizedDetail = null;
  assert.equal(await syncBracketOfficialResults({ id: "other-group-user" }, "contest-1"), null);
  assert.equal(providerCalls.length, 0);
});

test("manual route rejects a request without a signed-in user before syncing", async () => {
  let syncCalls = 0;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/auth") return { getCurrentUser: async () => null };
    if (request === "@/lib/bracket/resultSync.server") return {
      syncBracketOfficialResults: async () => { syncCalls++; return { promoted: 1 }; },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  let route;
  try {
    route = require("../app/api/bracket-challenge/contests/[contestId]/sync-results/route.ts");
  } finally {
    Module._load = originalLoad;
  }
  const response = await route.POST(new Request("http://localhost/sync-results", { method: "POST" }), {
    params: Promise.resolve({ contestId: "contest-1" }),
  });
  assert.equal(response.status, 401);
  assert.equal(syncCalls, 0);
});

test("one competition fetch promotes a bound final, stores official scores, and freezes all Group contests", async () => {
  reset();
  db.bracket_contests.push({ id: "contest-2", competition_id: 1, status: "open", lock_at: null });
  db.bracket_entries.push({ id: 101, competition_id: 1, contest_id: "contest-2", locked_at: null });
  providerEvents = [event("event-ff", "A", "B", "A")];
  const result = await syncBracketCompetitionResults(1);
  assert.deepEqual(providerCalls.map((row) => row.sportKey), ["college_football"]);
  assert.deepEqual(freezes, [100, 101]);
  assert.equal(result.promoted, 1);
  assert.equal(db.bracket_games[0].status, "final");
  assert.equal(db.bracket_games[0].winner_team_id, "A");
  assert.equal(db.bracket_games[0].metadata.bracket_official_result.away_score, 24);
  assert.equal(db.bracket_games[0].metadata.bracket_official_result.completed, true);
  assert.deepEqual(recomputes, [1]);
});

test("First Four and later-round winners advance in one topological pass", async () => {
  reset();
  db.bracket_games.push(game(20, "r64", "round_of_64", "C", 10, "event-r64"));
  db.bracket_games.push(game(30, "later", "round_of_32", 20, "D", "event-later"));
  db.bracket_games.reverse();
  providerEvents = [event("event-ff", "A", "B", "A"), event("event-r64", "C", "A", "A"), event("event-later", "A", "D", "D")];
  const result = await syncBracketCompetitionResults(1);
  assert.equal(result.promoted, 3);
  assert.deepEqual(Object.fromEntries(db.bracket_games.map((row) => [row.game_key, row.winner_team_id])),
    { ff: "A", r64: "A", later: "D" });
  assert.deepEqual(recomputes, [1]);
});

test("unresolved downstream participants cannot be promoted", async () => {
  reset();
  db.bracket_games.push(game(20, "r64", "round_of_64", "C", 10, "event-r64"));
  providerEvents = [event("event-r64", "C", "A", "A")];
  const result = await syncBracketCompetitionResults(1);
  assert.equal(result.promoted, 0);
  assert.equal(db.bracket_games[1].winner_team_id, null);
});

test("repeated and stale provider snapshots cannot regress a final", async () => {
  reset();
  providerEvents = [event("event-ff", "A", "B", "A")];
  await syncBracketCompetitionResults(1);
  const priorWrites = writes.length;
  const repeated = await syncBracketCompetitionResults(1);
  assert.equal(repeated.promoted, 0);
  assert.equal(writes.length, priorWrites);
  providerEvents = [event("event-ff", "A", "B", "B", "pre", false)];
  await syncBracketCompetitionResults(1);
  providerEvents = [];
  await syncBracketCompetitionResults(1);
  assert.equal(db.bracket_games[0].status, "final");
  assert.equal(db.bracket_games[0].winner_team_id, "A");
  assert.equal(writes.length, priorWrites);
  providerEvents = [event("event-ff", "A", "B", "B")];
  assert.equal((await syncBracketCompetitionResults(1)).conflicts, 1);
  assert.equal(db.bracket_games[0].winner_team_id, "A");
});

test("live status advances once and incomplete provider state never moves it backward", async () => {
  reset();
  providerEvents = [event("event-ff", "A", "B", null, "in", false)];
  assert.equal((await syncBracketCompetitionResults(1)).liveUpdated, 1);
  providerEvents = [event("event-ff", "A", "B", null, "pre", false)];
  assert.equal((await syncBracketCompetitionResults(1)).liveUpdated, 0);
  assert.equal(db.bracket_games[0].status, "in_progress");
});

test("scoring failure leaves a retry marker; later retry works without provider event", async () => {
  reset(); providerEvents = [event("event-ff", "A", "B", "A")]; failRecompute = true;
  await assert.rejects(syncBracketCompetitionResults(1), /Scoring interrupted/);
  assert.equal(db.bracket_games[0].status, "final");
  assert.equal(db.bracket_games[0].metadata.bracket_scoring_synced_winner, undefined);
  failRecompute = false; providerEvents = [];
  await syncBracketCompetitionResults(1);
  assert.equal(db.bracket_games[0].metadata.bracket_scoring_synced_winner, "A");
});

test("competition ID scopes reads and writes; unbound or duplicate provider events cannot write", async () => {
  reset();
  db.bracket_competitions.push(competition(2));
  db.bracket_games.push(game(40, "other", "first_four", "X", "Y", "event-other", 2));
  db.bracket_games.push(game(50, "duplicate", "round_of_64", "C", 10, "event-ff"));
  providerEvents = [event("event-ff", "A", "B", "A"), event("event-other", "X", "Y", "X")];
  const result = await syncBracketCompetitionResults(1);
  assert.equal(result.promoted, 0);
  assert.equal(db.bracket_games[0].status, "scheduled");
  assert.equal(db.bracket_games[2].status, "scheduled");
  assert.equal(db.bracket_games[1].status, "scheduled");
  assert.ok(writes.every((write) => write.table !== "bracket_games"));
});
