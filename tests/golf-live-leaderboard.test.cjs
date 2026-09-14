/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { formatGolfLiveProgress } = require("../lib/golf/liveLeaderboard.ts");
const { relevantGolfRosterPeriodKey } = require("../lib/golf/relevantRosterPeriod.ts");

test("live progress uses accepted holes and never emits thru 0", () => {
  assert.equal(formatGolfLiveProgress({ statusState: "playing", lastHole: 14 }), "thru 14");
  assert.equal(formatGolfLiveProgress({ statusState: "playing", progressHoles: 14, lastHole: 5 }), "thru 14");
  assert.equal(formatGolfLiveProgress({ statusState: "playing", holesCompleted: 18 }), "F");
  assert.equal(formatGolfLiveProgress({ statusState: "upcoming", teeTime: "1:20 PM" }), "1:20 PM");
  assert.equal(formatGolfLiveProgress({ statusState: "upcoming", statusLabel: "thru 0" }), "Upcoming");
  assert.equal(formatGolfLiveProgress({ statusState: "upcoming", holesCompleted: 18, teeTime: "1:20 PM" }), "1:20 PM");
});

test("terminal and playoff conventions stay golf-native", () => {
  for (const [statusState, label] of [["cut", "CUT"], ["withdrawn", "WD"], ["disqualified", "DQ"], ["did_not_start", "DNS"]]) {
    assert.equal(formatGolfLiveProgress({ statusState }), label);
  }
  assert.equal(formatGolfLiveProgress({ status: "playoff" }), "Playoff");
  assert.equal(formatGolfLiveProgress({ statusState: "finished" }), "F");
});

test("Golf Live reuses accepted ordering and both ownership stores", () => {
  const summary = fs.readFileSync(
    require("node:path").join(__dirname, "../lib/home/golfHomeSummary.ts"),
    "utf8",
  );
  const nav = fs.readFileSync(
    require("node:path").join(__dirname, "../components/AppNav.tsx"),
    "utf8",
  );
  const home = fs.readFileSync(
    require("node:path").join(__dirname, "../components/home/SportHomePage.tsx"),
    "utf8",
  );
  const rosterRoute = fs.readFileSync(
    require("node:path").join(__dirname, "../app/api/team-slate-roster/route.ts"),
    "utf8",
  );

  assert.match(summary, /order\("leaderboard_order"/);
  assert.match(summary, /from\("lineup_players"\)/);
  assert.match(summary, /from\("golf_salary_cap_lineups"\)/);
  assert.match(summary, /relevantPeriod/);
  assert.match(summary, /isCurrentUser/);
  assert.match(summary, /rounds: playerRounds/);
  assert.match(nav, /href: "\/golf\/live", label: "Live"/);
  assert.match(nav, /href: "\/lineups\/draft", label: "Lineup"/);
  assert.doesNotMatch(home, /Full leaderboard →/);
  assert.match(rosterRoute, /from\("golf_salary_cap_lineups"\)/);
  assert.match(rosterRoute, /relevantGolfRosterPeriodKey/);
  const nextSlateIndex = summary.indexOf('nextSlate ??');
  const completedSlateIndex = summary.indexOf('latestCompletedSlate ??');
  assert.ok(nextSlateIndex >= 0 && nextSlateIndex < completedSlateIndex, 'upcoming slate precedes a completed event');
});

test("relevant ownership period follows retained lifecycle facts", () => {
  const split = { sport: "golf", rosterPeriods: { type: "split_after_round_2" } };
  const opening = { period_key: "opening", opened_at: "2026-09-10T00:00:00Z" };
  const unavailableWeekend = { period_key: "weekend", opened_at: null, started_rounds: [] };
  assert.equal(relevantGolfRosterPeriodKey(split, [opening, unavailableWeekend]), "opening");
  assert.equal(
    relevantGolfRosterPeriodKey(split, [opening, { ...unavailableWeekend, opened_at: "2026-09-12T00:00:00Z" }]),
    "weekend",
  );
  assert.equal(
    relevantGolfRosterPeriodKey(split, [opening, { ...unavailableWeekend, started_rounds: [3] }]),
    "weekend",
  );
  assert.equal(relevantGolfRosterPeriodKey(null, []), "full_tournament");
});
