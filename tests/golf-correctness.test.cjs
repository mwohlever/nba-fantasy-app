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

const {
  decomposeGolfFantasyScoreByRound,
} = require("../lib/scoring/golf.ts");
const {
  parseGolfTournamentsFromPayload,
} = require("../lib/providers/golf.ts");

function holes(count) {
  return Array.from({ length: count }, (_, index) => ({
    period: index + 1,
    value: 4,
    displayValue: "E",
    scoreType: { displayValue: "E" },
  }));
}

function payload({ eventState, completed, currentRound, rounds }) {
  const type = {
    name: completed ? "STATUS_FINAL" : "STATUS_IN_PROGRESS",
    state: eventState,
    completed,
    description: completed ? "Final" : "In Progress",
  };

  return {
    events: [{
      id: "event-1",
      name: "Test Tournament",
      status: { type },
      competitions: [{
        status: { period: currentRound, type },
        competitors: [{
          id: "player-1",
          athlete: { displayName: "Test Golfer" },
          score: "+4",
          linescores: rounds,
        }],
      }],
    }],
  };
}

test("authoritative final event stays final with a partial competitor", () => {
  const [tournament] = parseGolfTournamentsFromPayload(payload({
    eventState: "post",
    completed: true,
    currentRound: 4,
    rounds: [{
      period: 1,
      value: 24,
      displayValue: "+4",
      linescores: holes(5),
    }],
  }));

  assert.equal(tournament.status, "final");
  assert.equal(tournament.competitors[0].status, "finished");
  assert.equal(tournament.competitors[0].rounds[0].holesCompleted, 5);
  assert.equal(tournament.competitors[0].rounds[0].scoreToPar, 4);
});

test("genuinely live partial activity remains live", () => {
  const [tournament] = parseGolfTournamentsFromPayload(payload({
    eventState: "in",
    completed: false,
    currentRound: 1,
    rounds: [{
      period: 1,
      value: 24,
      displayValue: "+4",
      linescores: holes(5),
    }],
  }));

  assert.equal(tournament.status, "in_progress");
  assert.equal(tournament.competitors[0].status, "active");
});

test("two completed rounds still infer a cut after round three begins", () => {
  const [tournament] = parseGolfTournamentsFromPayload(payload({
    eventState: "in",
    completed: false,
    currentRound: 3,
    rounds: [1, 2].map((roundNumber) => ({
      period: roundNumber,
      value: 70,
      displayValue: "-2",
      linescores: holes(18),
    })),
  }));

  assert.equal(tournament.competitors[0].status, "cut");
});

test("round decomposition retains partial score and allocates Wyndham missing-round penalties", () => {
  assert.deepEqual(
    decomposeGolfFantasyScoreByRound({
      rounds: [
        { roundNumber: 1, scoreToPar: -2, holesCompleted: 18 },
        { roundNumber: 2, scoreToPar: 1, holesCompleted: 18 },
      ],
      penaltyStrokes: 2,
      penaltyPerRound: 1,
      fantasyScore: 1,
    }),
    [-2, 1, 1, 1],
  );

  assert.deepEqual(
    decomposeGolfFantasyScoreByRound({
      rounds: [
        { roundNumber: 1, scoreToPar: 4, holesCompleted: 5 },
      ],
      penaltyStrokes: 4,
      penaltyPerRound: 1,
      fantasyScore: 8,
    }),
    [5, 1, 1, 1],
  );
});

test("the four settled tournament round totals reconcile and yield expected averages", () => {
  const tournamentRoundsByTeam = {
    Andy: [
      [-6, -11, -9, 0],
      [-4, -6, 0, -3],
      [-14, -12, -13, -3],
      [-7, -14, -12, -4],
    ],
    Jon: [
      [0, -11, -1, -1],
      [-5, -12, -7, -1],
      [-7, -8, -2, 4],
      [-16, -8, -6, -9],
    ],
    Josh: [
      [-12, -6, -11, -2],
      [-8, -9, -11, 2],
      [-7, -15, -4, -2],
      [-14, -9, -12, 5],
    ],
    Mark: [
      [-11, -5, -7, -9],
      [-2, -5, 1, 3],
      [-1, -15, 0, -5],
      [-12, -3, -18, -4],
    ],
  };
  const canonicalTournamentTotals = {
    Andy: [-26, -13, -42, -37],
    Jon: [-13, -25, -13, -39],
    Josh: [-31, -26, -28, -30],
    Mark: [-32, -3, -21, -37],
  };
  const expectedAverages = {
    Andy: [-7.75, -10.75, -8.5, -2.5],
    Jon: [-7, -9.75, -4, -1.75],
    Josh: [-10.25, -9.75, -9.5, 0.75],
    Mark: [-6.5, -7, -6, -3.75],
  };

  for (const [team, tournamentRounds] of Object.entries(tournamentRoundsByTeam)) {
    tournamentRounds.forEach((rounds, tournamentIndex) => {
      assert.equal(
        rounds.reduce((total, score) => total + score, 0),
        canonicalTournamentTotals[team][tournamentIndex],
      );
    });

    const averages = [0, 1, 2, 3].map(
      (roundIndex) =>
        tournamentRounds.reduce(
          (total, rounds) => total + rounds[roundIndex],
          0,
        ) / tournamentRounds.length,
    );

    assert.deepEqual(averages, expectedAverages[team]);
  }
});
