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
const {
  formatGolfLiveProgress,
  getGolfLiveRoundStatus,
  orderGolfLiveLeaderboard,
  resolveGolfLiveTournamentRound,
} = require("../lib/golf/liveLeaderboard.ts");
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

test("Live status describes the active tournament round, not a prior completed round", () => {
  const tee = (raw, parsed) => raw || parsed || null;
  const status = (round, playerStatus = "round_complete") => formatGolfLiveProgress(
    getGolfLiveRoundStatus({ status: playerStatus, round, formatTeeTime: tee }),
  );
  const r1 = { round_number: 1, holes_completed: 18 };
  const r2Scheduled = { round_number: 2, holes_completed: 0, tee_time_raw: "1:27 PM" };

  assert.equal(resolveGolfLiveTournamentRound([{ status: "round_complete", current_round: 2, rounds: [r1, r2Scheduled] }]), 2);
  assert.equal(status(r2Scheduled), "1:27 PM", "R1 complete does not make scheduled R2 final");
  assert.equal(status({ round_number: 2, holes_completed: 8 }), "thru 8");
  assert.equal(status({ round_number: 2, holes_completed: 18 }), "F");
  assert.equal(status({ round_number: 1, holes_completed: 0, tee_time_raw: "8:00 AM" }, "scheduled"), "8:00 AM");
  assert.equal(status({ round_number: 3, holes_completed: 4 }), "thru 4");
  assert.equal(status({ round_number: 4, holes_completed: 18 }), "F");
});

test("Live current-round status preserves terminal golfer states", () => {
  const tee = () => "1:27 PM";
  for (const [status, expected] of [["cut", "CUT"], ["withdrawn", "WD"], ["disqualified", "DQ"], ["did_not_start", "DNS"]]) {
    assert.equal(
      formatGolfLiveProgress(getGolfLiveRoundStatus({ status, round: { round_number: 2, holes_completed: 0 }, formatTeeTime: tee })),
      expected,
    );
  }
});

test("Live orders and ranks accepted tournament totals independently of stale provider rank", () => {
  const rows = orderGolfLiveLeaderboard([
    { playerId: 20, name: "Even Player", score: 0, status: "active", providerPosition: 20, isProjectedCutEligible: false },
    { playerId: 99, name: "Fabián Gómez", score: -4, status: "active", providerPosition: 99, isProjectedCutEligible: true },
    { playerId: 31, name: "Tie One", score: -2, status: "active", providerPosition: 31, isProjectedCutEligible: true },
    { playerId: 32, name: "Tie Two", score: -2, status: "active", providerPosition: 32, isProjectedCutEligible: true },
    { playerId: 41, name: "Plus One", score: 1, status: "active", providerPosition: 41, isProjectedCutEligible: false },
    { playerId: 50, name: "Cut Golfer", score: 2, status: "cut", providerPosition: 50, isProjectedCutEligible: false },
    { playerId: 6, name: "Withdrawn", score: -9, status: "withdrawn", providerPosition: 6, isProjectedCutEligible: false },
    { playerId: 7, name: "No Score", score: null, status: "did_not_start", providerPosition: 7, isProjectedCutEligible: false },
  ]);

  assert.deepEqual(
    rows.map(({ playerId, position, positionDisplay }) => ({ playerId, position, positionDisplay })),
    [
      { playerId: 99, position: 1, positionDisplay: "1" },
      { playerId: 31, position: 2, positionDisplay: "T2" },
      { playerId: 32, position: 2, positionDisplay: "T2" },
      { playerId: 20, position: 4, positionDisplay: "4" },
      { playerId: 41, position: 5, positionDisplay: "5" },
      { playerId: 50, position: 6, positionDisplay: "6" },
      { playerId: 6, position: 6, positionDisplay: "6" },
      { playerId: 7, position: 7, positionDisplay: "7" },
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.isProjectedCutEligible),
    [true, true, true, false, false, false, false, false],
    "accepted-score ordering keeps the projected in-cut block contiguous",
  );
  assert.equal(rows.at(-2).status, "withdrawn");
  assert.equal(rows.at(-1).status, "did_not_start");
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
  assert.match(summary, /orderGolfLiveLeaderboard/);
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
