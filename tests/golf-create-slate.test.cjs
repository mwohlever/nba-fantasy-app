/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
};

const {
  buildGolfSlateRulesSnapshot,
} = require("../lib/slates/golfSlateRules.ts");

const roster = (count) => [{ position: "GOLFER", slotCount: count }];

for (const gameType of ["standard", "best_ball"]) {
  for (const draftType of ["snake", "salary_cap"]) {
    for (const periodType of [
      "full_tournament",
      "split_after_round_2",
    ]) {
      test(`${gameType} + ${draftType} + ${periodType} is frozen independently`, () => {
        const snapshot = buildGolfSlateRulesSnapshot({
          groupSettings: null,
          selection: {
            gameType,
            draft: { type: draftType },
            rosterPeriods: { type: periodType },
          },
          rosterSlots: roster(4),
        });

        assert.equal(snapshot.sport, "golf");
        assert.equal(snapshot.gameType, gameType);
        assert.equal(snapshot.draft.type, draftType);
        assert.equal(snapshot.rosterPeriods.type, periodType);
        assert.deepEqual(snapshot.roster.slots, roster(4));
        assert.equal(
          snapshot.draft.salaryCap,
          draftType === "salary_cap" ? 100 : undefined,
        );
      });
    }
  }
}

test("Salary Cap derives the new slate cap, ignoring supplied cap values", () => {
  const snapshot = buildGolfSlateRulesSnapshot({
    groupSettings: {
      gameType: "best_ball",
      draft: { type: "salary_cap", salaryCap: 125 },
    },
    selection: { draft: { type: "salary_cap", salaryCap: 999 } },
    rosterSlots: roster(4),
  });

  assert.deepEqual(snapshot.draft, { type: "salary_cap", salaryCap: 100 });
  for (const count of [3, 4, 5, 6]) {
    const rules = buildGolfSlateRulesSnapshot({
        groupSettings: null,
        selection: { draft: { type: "salary_cap", salaryCap: 1 } },
        rosterSlots: roster(count),
    });
    assert.equal(rules.draft.salaryCap, count * 25);
    assert.deepEqual(rules.roster.slots, roster(count));
  }
  for (const count of [0, -1, 1.5, 51, NaN]) {
    assert.throws(() => buildGolfSlateRulesSnapshot({ groupSettings: null,
      selection: { draft: { type: "salary_cap" } }, rosterSlots: roster(count) }), /whole number/);
  }
});

test("missing newer settings preserve historical Golf defaults", () => {
  const snapshot = buildGolfSlateRulesSnapshot({ groupSettings: null });
  assert.equal(snapshot.gameType, "standard");
  assert.deepEqual(snapshot.draft, { type: "snake" });
  assert.deepEqual(snapshot.rosterPeriods, { type: "full_tournament" });
  assert.deepEqual(snapshot.roster.slots, roster(4));
});

test("creating one slate does not mutate Group defaults", () => {
  const groupSettings = {
    gameType: "best_ball",
    draft: { type: "snake" },
    rosterPeriods: { type: "full_tournament" },
    roster: { slots: roster(6) },
  };
  const before = JSON.stringify(groupSettings);
  const snapshot = buildGolfSlateRulesSnapshot({
    groupSettings,
    selection: {
      gameType: "standard",
      draft: { type: "salary_cap" },
      rosterPeriods: { type: "split_after_round_2" },
    },
    rosterSlots: roster(4),
  });

  assert.equal(JSON.stringify(groupSettings), before);
  assert.equal(snapshot.gameType, "standard");
  assert.equal(snapshot.draft.type, "salary_cap");
  assert.equal(snapshot.rosterPeriods.type, "split_after_round_2");
});

test("Create Slate wires canonical Golf rules into POST and persisted snapshot", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "../app/slates/new/page.tsx"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(__dirname, "../app/api/slates/route.ts"),
    "utf8",
  );
  const draftPage = fs.readFileSync(
    path.join(__dirname, "../app/lineups/draft/page.tsx"),
    "utf8",
  );

  assert.match(page, /golfRules:/);
  assert.match(page, /gameType: golfGameType/);
  assert.match(page, /rosterPeriods: \{ type: golfRosterPeriodType \}/);
  assert.match(route, /buildGolfSlateRulesSnapshot/);
  assert.match(route, /rules_snapshot:\s*resolvedRules/);
  assert.match(draftPage, /initialUsesSalaryCap/);
  assert.match(draftPage, /<GolfSalaryCapBuilder/);
  assert.match(draftPage, /<LineupBuilder/);
});

test("Golf Create Slate defaults missed-cut penalty to one", () => {
  const page = fs.readFileSync(path.join(__dirname, "../app/slates/new/page.tsx"), "utf8");
  assert.match(page, /useState\(1\)/);
});
