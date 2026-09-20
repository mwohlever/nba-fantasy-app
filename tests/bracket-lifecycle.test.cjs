require("typescript").transpileModule;
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const original = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { shouldFreezeBracketEntry, canEditBracketGame } = require("../lib/bracket/lifecycle.ts");
const { validateBracketPicks } = require("../lib/bracket/topology.ts");
test.after(() => { Module._extensions[".ts"] = original; });
const now = new Date("2026-12-19T12:00:00Z");
test("full contest finalization is explicit and does not make game-level locks the model", () => {
  assert.equal(shouldFreezeBracketEntry({ contestStatus: "open", contestLockAt: "2026-12-20T12:00:00Z" }, now), false);
  assert.equal(shouldFreezeBracketEntry({ contestStatus: "locked", contestLockAt: null }, now), true);
  assert.equal(canEditBracketGame({ contest: { contestStatus: "open", contestLockAt: null }, gameLockAt: "2026-12-18T12:00:00Z", gameStatus: "scheduled", now }), false);
  assert.equal(canEditBracketGame({ contest: { contestStatus: "open", contestLockAt: null }, gameLockAt: "2026-12-20T12:00:00Z", gameStatus: "scheduled", now }), true);
});

test("game editability closes for live/final games and for a contest-level deadline", () => {
  assert.equal(canEditBracketGame({ contest: { contestStatus: "open", contestLockAt: "2026-12-18T12:00:00Z" }, gameLockAt: null, gameStatus: "scheduled", now }), false);
  assert.equal(canEditBracketGame({ contest: { contestStatus: "open", contestLockAt: null }, gameLockAt: null, gameStatus: "in_progress", now }), false);
  assert.equal(canEditBracketGame({ contest: { contestStatus: "open", contestLockAt: null }, gameLockAt: null, gameStatus: "final", now }), false);
});

test("freeze-boundary validation rejects a stale downstream pick", () => {
  const topology = { games: [
    { id: "first", roundKey: "first", roundOrder: 1, gameOrder: 1, sources: [{ type: "team", teamId: "A" }, { type: "team", teamId: "B" }] },
    { id: "final", roundKey: "final", roundOrder: 2, gameOrder: 1, sources: [{ type: "winner", gameId: "first" }, { type: "team", teamId: "C" }] },
  ] };
  assert.throws(() => validateBracketPicks(topology, { first: "A", final: "B" }), /not eligible/);
});
