require("typescript").transpileModule;

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

const originalTs = Module._extensions[".ts"];
Module._extensions[".ts"] = function compileTs(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const {
  fixedSeedGameSlots,
  hasCfpFieldIdentityChanged,
  normalizeCfpField,
} = require("../lib/bracket/field.ts");
const {
  normalizeNcaaEspnTeamDirectory,
} = require("../lib/providers/ncaaTeams.ts");

test.after(() => { Module._extensions[".ts"] = originalTs; });

const completeField = () => Array.from({ length: 12 }, (_, index) => ({
  seed: 12 - index,
  providerTeamId: `espn-${12 - index}`,
  displayName: `Team ${12 - index}`,
}));

test("CFP field requires the complete 12 unique ESPN-team assignments and orders seeds", () => {
  const field = normalizeCfpField(completeField());
  assert.deepEqual(field.map((team) => team.seed), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.throws(() => normalizeCfpField(completeField().filter((team) => team.seed !== 12)), /exactly 12 teams/);

  const missingSeed = completeField();
  missingSeed[1].seed = 12;
  assert.throws(() => normalizeCfpField(missingSeed), /seeds 1 through 12/);

  const duplicate = completeField();
  duplicate[1].providerTeamId = duplicate[0].providerTeamId;
  assert.throws(() => normalizeCfpField(duplicate), /cannot occupy multiple/);
});

test("fixed source-slot mapping excludes dependency slots and retains seed identity", () => {
  const slots = fixedSeedGameSlots([
    { id: 1, source_a_seed: 8, source_a_game_id: null, source_b_seed: 9, source_b_game_id: null },
    { id: 2, source_a_seed: 1, source_a_game_id: null, source_b_seed: null, source_b_game_id: 1 },
  ]);
  assert.deepEqual(slots, [
    { gameId: 2, side: "a", seed: 1 },
    { gameId: 1, side: "a", seed: 8 },
    { gameId: 1, side: "b", seed: 9 },
  ]);
});

test("provider identity changes, including seed swaps, require master-pick invalidation", () => {
  const current = [{ seed: 1, providerTeamId: "A" }, { seed: 2, providerTeamId: "B" }];
  assert.equal(hasCfpFieldIdentityChanged(current, [...current]), false);
  assert.equal(hasCfpFieldIdentityChanged(current, [{ seed: 1, providerTeamId: "B" }, { seed: 2, providerTeamId: "A" }]), true);
});

test("NCAA ESPN directory normalization preserves the Pick'em team identity shape", () => {
  const teams = normalizeNcaaEspnTeamDirectory({
    sports: [{ leagues: [{ teams: [
      { team: { id: "194", displayName: "Ohio State Buckeyes", abbreviation: "OSU", logos: [{ href: "https://example.test/osu.png" }] } },
      { team: { id: "61", displayName: "Georgia Bulldogs", abbreviation: "UGA" } },
      { team: { id: "bad" } },
    ] }] }],
  });
  assert.deepEqual(teams, [
    { id: "61", displayName: "Georgia Bulldogs", abbreviation: "UGA", logo: null },
    { id: "194", displayName: "Ohio State Buckeyes", abbreviation: "OSU", logo: "https://example.test/osu.png" },
  ]);
});
