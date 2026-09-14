/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};

const { buildGolfFieldRankingUpdates } = require("../lib/golf/fieldRankingUpdates.ts");

const fieldPlayer = (overrides = {}) => ({
  pgaPlayerId: "49964", displayName: "Aaron Wise", shortName: "Aaron Wise",
  firstName: "Aaron", lastName: "Wise", country: "United States", countryCode: "USA",
  headshotUrl: null, qualifier: null, isAlternate: false, isWithdrawn: false,
  isAmateur: false, status: null, owgrRank: 470, rankingPoints: 151, ...overrides,
});

test("existing field golfers retain PGA OWGR coverage when V1 history is unavailable", () => {
  const updates = buildGolfFieldRankingUpdates(
    [fieldPlayer()], new Map([["49964", 33]]),
    new Map([[33, { owgr_player_id: null, owgr_rank: null, owgr_points: null }]]),
    "2026-09-13T12:00:00.000Z",
  );
  assert.deepEqual(updates, [{
    id: 33, owgr_player_id: "49964", owgr_rank: 470, owgr_points: 151,
    owgr_updated_at: "2026-09-13T12:00:00.000Z",
  }]);
});

test("absent PGA rank does not overwrite an existing rank or invent coverage", () => {
  const updates = buildGolfFieldRankingUpdates(
    [fieldPlayer({ owgrRank: null, rankingPoints: null })], new Map([["49964", 33]]),
    new Map([[33, { owgr_player_id: "49964", owgr_rank: 470, owgr_points: 151 }]]),
    "2026-09-13T12:00:00.000Z",
  );
  assert.deepEqual(updates, []);
});
