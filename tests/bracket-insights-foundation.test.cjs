/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
require.extensions[".ts"] = function (module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};
const { decideBracketResultPromotion } = require("../lib/bracket/resultPromotion.ts");
const { bracketInsightVisibility, deriveBracketConsensus, deriveBracketIdentity } = require("../lib/bracket/insights.ts");
const { bracketDisplayLabel, normalizeBracketName } = require("../lib/bracket/names.ts");
const { effectiveBracketLockAt } = require("../lib/bracket/lifecycle.ts");
Module._resolveFilename = originalResolve;

const topology = { games: [
  { id: "semi", roundKey: "semifinal", roundOrder: 1, gameOrder: 1, sources: [{ type: "team", teamId: "A" }, { type: "team", teamId: "B" }] },
  { id: "final", roundKey: "championship", roundOrder: 2, gameOrder: 1, sources: [{ type: "winner", gameId: "semi" }, { type: "team", teamId: "C" }] },
] };
const competition = { sportKey: "college_football", formatKey: "cfp" };
const first = { id: 1, gameKey: "semi", status: "scheduled", winnerTeamId: null, providerEventId: "event-1" };
const event = { espnEventId: "event-1", status: "post", completed: true, winnerTeamId: "A",
  awayTeam: { id: "A", winner: true, score: 24 }, homeTeam: { id: "B", winner: false, score: 17 } };
const decide = (changes = {}) => decideBracketResultPromotion({ game: first, event, topology, results: {}, competition, boundEventCount: 1, ...changes });

test("only an exact, bound, final ESPN event promotes", () => {
  assert.deepEqual(decide(), { state: "promote", winnerTeamId: "A" });
  for (const status of ["pre", "in"]) assert.equal(decide({ event: { ...event, status, completed: false } }).state, "unsafe");
  assert.equal(decide({ event: { ...event, espnEventId: "other" } }).state, "unsafe");
  assert.equal(decide({ event: { ...event, homeTeam: { ...event.homeTeam, id: "X" } } }).state, "unsafe");
  assert.equal(decide({ boundEventCount: 2 }).state, "unsafe");
  assert.equal(decide({ event: { ...event, homeTeam: { ...event.homeTeam, winner: true } } }).state, "unsafe");
  assert.equal(decide({ event: { ...event, winnerTeamId: null } }).state, "unsafe");
  assert.equal(decide({ competition: { sportKey: "basketball", formatKey: "march_madness" } }).state, "unsafe");
  assert.equal(decide({ competition: { sportKey: "mens_college_basketball", formatKey: "ncaa_mens" } }).state, "promote");
  assert.equal(decide({ game: { ...first, gameKey: "final", providerEventId: "event-1" } }).state, "unsafe");
});

test("identical finals are idempotent and conflicting finals require manual correction", () => {
  assert.equal(decide({ game: { ...first, status: "final", winnerTeamId: "A" }, results: { semi: "A" } }).state, "identical");
  assert.equal(decide({ game: { ...first, status: "final", winnerTeamId: "B" }, results: { semi: "B" } }).state, "conflict");
});

test("persisted upstream result resolves the next game safely", () => {
  const next = { ...first, gameKey: "final" };
  assert.equal(decide({ game: next, results: {} }).state, "unsafe");
  assert.equal(decide({ game: next, results: { semi: "A" }, event: { ...event, homeTeam: { ...event.homeTeam, id: "C" } } }).state, "promote");
});

const frozen = (id, entrantId, picks) => ({ id, entrantId, lockedAt: "2026-12-01", picks, rulesSnapshot: { scoring: { roundPoints: { semifinal: 1, championship: 2 } } } });
test("pool visibility waits for every admitted entry snapshot", () => {
  const lock = { contestStatus: "open", contestLockAt: "2026-12-01" };
  assert.equal(bracketInsightVisibility(lock, [frozen(1, "nico", {})], new Date("2026-11-01")).pool, "pre_lock");
  assert.equal(bracketInsightVisibility(lock, [frozen(1, "nico", {}), { ...frozen(2, "mark", {}), picks: null }], new Date("2026-12-02")).pool, "freezing");
  assert.equal(bracketInsightVisibility(lock, [frozen(1, "nico", {}), frozen(2, "mark", {})], new Date("2026-12-02")).pool, "available");
});

test("first scheduled game caps the contest lock time", () => {
  assert.equal(effectiveBracketLockAt("2026-12-30", [{ scheduledAt: "2026-12-20" }, { scheduledAt: "2026-12-25" }]), "2026-12-20");
  assert.equal(effectiveBracketLockAt(null, [{ scheduledAt: null, status: "in_progress" }]), "1970-01-01T00:00:00.000Z");
});

test("consensus counts brackets, including two from one entrant, and handles divergent downstream picks", () => {
  const entries = [frozen(1, "nico", { semi: "A", final: "A" }), frozen(2, "nico", { semi: "A", final: "C" }), frozen(3, "mark", { semi: "B", final: "B" }), frozen(4, "izzy", { semi: "B", final: "C" })];
  const result = deriveBracketConsensus(topology, entries);
  assert.equal(result.totalBrackets, 4);
  assert.deepEqual(result.games[0].teams.map((team) => team.count), [2, 2]);
  assert.equal(result.champion.find((team) => team.teamId === "C").percentage, 50);
  assert.equal(result.champion.find((team) => team.teamId === "A").unique, true);
  assert.equal(deriveBracketConsensus(topology, entries.map((entry) => ({ ...entry, picks: { semi: "A", final: "C" } }))).games[0].teams[0].unanimous, true);
});

test("identity derives viewed picks and official alive/busted state with frozen rules", () => {
  const identity = deriveBracketIdentity({ topology, picks: { semi: "A", final: "A" },
    officialGames: [{ gameId: "semi", status: "final", winnerTeamId: "B" }, { gameId: "final", status: "scheduled", winnerTeamId: null }],
    rulesSnapshot: frozen(1, "nico", {}).rulesSnapshot });
  assert.equal(identity.championPick, "A");
  assert.equal(identity.bustedPicks, 2);
  assert.equal(identity.alivePicks, 0);
  assert.equal(identity.deepRoundPicks.length, 2);
});

test("names keep bracket number as fallback and normalize clear", () => {
  assert.equal(bracketDisplayLabel(2, null), "Bracket 2");
  assert.equal(bracketDisplayLabel(2, " Chaos "), "Chaos");
  assert.equal(normalizeBracketName("  "), null);
  assert.equal(normalizeBracketName(" Chalk "), "Chalk");
  assert.throws(() => normalizeBracketName("x".repeat(81)));
});
