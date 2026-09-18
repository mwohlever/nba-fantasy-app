require("typescript").transpileModule;

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const originalTs = Module._extensions[".ts"];

Module._extensions[".ts"] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });

  module._compile(output.outputText, filename);
};

const {
  orderedBracketGames,
  resolveBracketGame,
  validateBracketPicks,
  validateBracketTopology,
} = require("../lib/bracket/topology.ts");

const {
  applyBracketPick,
  downstreamGameIds,
} = require("../lib/bracket/dependencies.ts");

const {
  maximumPossibleBracketPoints,
  scoreBracket,
} = require("../lib/bracket/scoring.ts");

test.after(() => {
  Module._extensions[".ts"] = originalTs;
});

const team = (teamId) => ({ type: "team", teamId });
const winner = (gameId) => ({ type: "winner", gameId });

function cfpTopology() {
  return {
    games: [
      {
        id: "r1-1",
        roundKey: "first_round",
        roundOrder: 1,
        gameOrder: 1,
        sources: [team("8"), team("9")],
      },
      {
        id: "r1-2",
        roundKey: "first_round",
        roundOrder: 1,
        gameOrder: 2,
        sources: [team("5"), team("12")],
      },
      {
        id: "r1-3",
        roundKey: "first_round",
        roundOrder: 1,
        gameOrder: 3,
        sources: [team("7"), team("10")],
      },
      {
        id: "r1-4",
        roundKey: "first_round",
        roundOrder: 1,
        gameOrder: 4,
        sources: [team("6"), team("11")],
      },
      {
        id: "qf-1",
        roundKey: "quarterfinal",
        roundOrder: 2,
        gameOrder: 1,
        sources: [team("1"), winner("r1-1")],
      },
      {
        id: "qf-2",
        roundKey: "quarterfinal",
        roundOrder: 2,
        gameOrder: 2,
        sources: [team("4"), winner("r1-2")],
      },
      {
        id: "qf-3",
        roundKey: "quarterfinal",
        roundOrder: 2,
        gameOrder: 3,
        sources: [team("2"), winner("r1-3")],
      },
      {
        id: "qf-4",
        roundKey: "quarterfinal",
        roundOrder: 2,
        gameOrder: 4,
        sources: [team("3"), winner("r1-4")],
      },
      {
        id: "sf-1",
        roundKey: "semifinal",
        roundOrder: 3,
        gameOrder: 1,
        sources: [winner("qf-1"), winner("qf-2")],
      },
      {
        id: "sf-2",
        roundKey: "semifinal",
        roundOrder: 3,
        gameOrder: 2,
        sources: [winner("qf-3"), winner("qf-4")],
      },
      {
        id: "champ",
        roundKey: "championship",
        roundOrder: 4,
        gameOrder: 1,
        sources: [winner("sf-1"), winner("sf-2")],
      },
    ],
  };
}

const cfpScoring = {
  first_round: 10,
  quarterfinal: 20,
  semifinal: 40,
  championship: 80,
};

test("CFP fixture is a valid 12-team, 11-game dependency graph", () => {
  const topology = cfpTopology();

  validateBracketTopology(topology);

  const games = orderedBracketGames(topology);

  assert.equal(games.length, 11);

  const initialTeams = new Set(
    games.flatMap((game) =>
      game.sources
        .filter((source) => source.type === "team")
        .map((source) => source.teamId),
    ),
  );

  assert.equal(initialTeams.size, 12);
  assert.equal(games[0].id, "r1-1");
  assert.equal(games.at(-1).id, "champ");
});

test("earlier winners resolve into later CFP games", () => {
  const topology = cfpTopology();

  assert.deepEqual(
    resolveBracketGame(topology, "qf-1", { "r1-1": "9" }).teamIds,
    ["1", "9"],
  );

  assert.deepEqual(
    resolveBracketGame(topology, "sf-1", {
      "r1-1": "9",
      "r1-2": "12",
      "qf-1": "1",
      "qf-2": "12",
    }).teamIds,
    ["1", "12"],
  );
});

test("changing an upstream winner clears only invalid dependent picks", () => {
  const topology = cfpTopology();

  const original = {
    "r1-1": "9",
    "r1-2": "5",
    "qf-1": "9",
    "qf-2": "4",
    "sf-1": "9",
    champ: "9",
  };

  const changed = applyBracketPick(topology, original, "r1-1", "8");

  assert.equal(changed.picks["r1-1"], "8");
  assert.equal(changed.picks["qf-1"], null);
  assert.equal(changed.picks["sf-1"], null);
  assert.equal(changed.picks.champ, null);

  assert.equal(changed.picks["r1-2"], "5");
  assert.equal(changed.picks["qf-2"], "4");

  assert.deepEqual(changed.clearedGameIds, ["qf-1", "sf-1", "champ"]);
});

test("dependency traversal returns the complete downstream branch", () => {
  assert.deepEqual(
    downstreamGameIds(cfpTopology(), "r1-1"),
    ["qf-1", "sf-1", "champ"],
  );
});

test("incomplete brackets remain valid and score only made picks", () => {
  const topology = cfpTopology();

  const picks = {
    "r1-1": "8",
    "r1-2": "5",
  };

  const results = {
    "r1-1": "8",
    "r1-2": "12",
  };

  validateBracketPicks(topology, picks);

  const score = scoreBracket(topology, picks, results, cfpScoring);

  assert.equal(score.points, 10);
  assert.equal(score.correctPicks, 1);
  assert.equal(score.incorrectPicks, 1);
  assert.equal(score.unmadePicks, 9);
});

test("CFP scoring is driven by supplied round rules rather than hardcoded values", () => {
  const topology = cfpTopology();

  const picks = {
    "r1-1": "8",
    "r1-2": "5",
    "r1-3": "7",
    "r1-4": "6",
    "qf-1": "1",
    "qf-2": "4",
    "qf-3": "2",
    "qf-4": "3",
    "sf-1": "1",
    "sf-2": "2",
    champ: "1",
  };

  const results = { ...picks };

  assert.equal(scoreBracket(topology, picks, results, cfpScoring).points, 280);

  const doubled = {
    first_round: 20,
    quarterfinal: 40,
    semifinal: 80,
    championship: 160,
  };

  assert.equal(scoreBracket(topology, picks, results, doubled).points, 560);
});

test("maximum possible points exclude already-busted picks but retain unsettled picks", () => {
  const topology = cfpTopology();

  const picks = {
    "r1-1": "8",
    "r1-2": "5",
    "r1-3": "7",
    "qf-1": "1",
  };

  const results = {
    "r1-1": "8",
    "r1-2": "12",
  };

  assert.equal(
    maximumPossibleBracketPoints(topology, picks, results, cfpScoring),
    40,
  );
});

test("invalid downstream picks are rejected instead of silently accepted", () => {
  const topology = cfpTopology();

  assert.throws(
    () =>
      validateBracketPicks(topology, {
        "r1-1": "8",
        "qf-1": "9",
      }),
    /not eligible/,
  );
});

test("generic graph supports a First Four winner feeding a later matchup", () => {
  const topology = {
    games: [
      {
        id: "ff-1",
        roundKey: "first_four",
        roundOrder: 1,
        gameOrder: 1,
        sources: [team("vcu"), team("miami")],
      },
      {
        id: "r64-1",
        roundKey: "round_of_64",
        roundOrder: 2,
        gameOrder: 1,
        sources: [team("duke"), winner("ff-1")],
      },
    ],
  };

  validateBracketTopology(topology);

  const picks = applyBracketPick(topology, {}, "ff-1", "miami").picks;

  assert.deepEqual(
    resolveBracketGame(topology, "r64-1", picks).teamIds,
    ["duke", "miami"],
  );

  const completed = applyBracketPick(topology, picks, "r64-1", "miami").picks;

  assert.deepEqual(completed, {
    "ff-1": "miami",
    "r64-1": "miami",
  });

  const score = scoreBracket(
    topology,
    completed,
    {
      "ff-1": "miami",
      "r64-1": "miami",
    },
    {
      first_four: 5,
      round_of_64: 10,
    },
  );

  assert.equal(score.points, 15);
});

test("topology rejects missing, duplicate, and non-forward dependencies", () => {
  assert.throws(
    () =>
      validateBracketTopology({
        games: [
          {
            id: "a",
            roundKey: "round_1",
            roundOrder: 1,
            gameOrder: 1,
            sources: [team("1"), winner("missing")],
          },
        ],
      }),
    /missing source game/,
  );

  assert.throws(
    () =>
      validateBracketTopology({
        games: [
          {
            id: "a",
            roundKey: "round_1",
            roundOrder: 1,
            gameOrder: 1,
            sources: [team("1"), team("2")],
          },
          {
            id: "a",
            roundKey: "round_2",
            roundOrder: 2,
            gameOrder: 1,
            sources: [team("3"), team("4")],
          },
        ],
      }),
    /duplicate game IDs/,
  );

  assert.throws(
    () =>
      validateBracketTopology({
        games: [
          {
            id: "a",
            roundKey: "round_1",
            roundOrder: 1,
            gameOrder: 1,
            sources: [team("1"), team("2")],
          },
          {
            id: "b",
            roundKey: "round_1",
            roundOrder: 1,
            gameOrder: 2,
            sources: [winner("a"), team("3")],
          },
        ],
      }),
    /earlier round/,
  );
});

test("real results eliminate downstream picks without mutating the saved bracket", () => {
  const topology = cfpTopology();

  const picks = {
    "r1-1": "8",
    "qf-1": "8",
    "sf-1": "8",
    champ: "8",
  };

  const results = {
    "r1-1": "9",
  };

  const {
    bracketPickViability,
  } = require("../lib/bracket/scoring.ts");

  const viability = bracketPickViability(
    topology,
    picks,
    results,
  );

  assert.deepEqual(
    viability
      .filter((item) => picks[item.gameId] != null)
      .map((item) => [item.gameId, item.status]),
    [
      ["r1-1", "incorrect"],
      ["qf-1", "eliminated"],
      ["sf-1", "eliminated"],
      ["champ", "eliminated"],
    ],
  );

  assert.deepEqual(picks, {
    "r1-1": "8",
    "qf-1": "8",
    "sf-1": "8",
    champ: "8",
  });
});

test("downstream picks remain alive while their required upstream result is unsettled", () => {
  const topology = cfpTopology();

  const picks = {
    "r1-1": "8",
    "qf-1": "8",
    "sf-1": "8",
    champ: "8",
  };

  const {
    bracketPickViability,
  } = require("../lib/bracket/scoring.ts");

  const viability = bracketPickViability(
    topology,
    picks,
    {},
  );

  assert.deepEqual(
    viability
      .filter((item) => picks[item.gameId] != null)
      .map((item) => [item.gameId, item.status]),
    [
      ["r1-1", "alive"],
      ["qf-1", "alive"],
      ["sf-1", "alive"],
      ["champ", "alive"],
    ],
  );
});

test("persisted CFP rows rebuild the same valid 12-team, 11-game graph", () => {
  const {
    bracketTopologyFromRows,
  } = require("../lib/bracket/persistence.ts");

  const rows = [
    {
      id: 101,
      game_key: "r1-1",
      round_key: "first_round",
      round_order: 1,
      game_order: 1,
      source_a_team_id: "seed-8",
      source_a_game_id: null,
      source_b_team_id: "seed-9",
      source_b_game_id: null,
    },
    {
      id: 102,
      game_key: "r1-2",
      round_key: "first_round",
      round_order: 1,
      game_order: 2,
      source_a_team_id: "seed-5",
      source_a_game_id: null,
      source_b_team_id: "seed-12",
      source_b_game_id: null,
    },
    {
      id: 103,
      game_key: "r1-3",
      round_key: "first_round",
      round_order: 1,
      game_order: 3,
      source_a_team_id: "seed-7",
      source_a_game_id: null,
      source_b_team_id: "seed-10",
      source_b_game_id: null,
    },
    {
      id: 104,
      game_key: "r1-4",
      round_key: "first_round",
      round_order: 1,
      game_order: 4,
      source_a_team_id: "seed-6",
      source_a_game_id: null,
      source_b_team_id: "seed-11",
      source_b_game_id: null,
    },
    {
      id: 105,
      game_key: "qf-1",
      round_key: "quarterfinal",
      round_order: 2,
      game_order: 1,
      source_a_team_id: "seed-1",
      source_a_game_id: null,
      source_b_team_id: null,
      source_b_game_id: 101,
    },
    {
      id: 106,
      game_key: "qf-2",
      round_key: "quarterfinal",
      round_order: 2,
      game_order: 2,
      source_a_team_id: "seed-4",
      source_a_game_id: null,
      source_b_team_id: null,
      source_b_game_id: 102,
    },
    {
      id: 107,
      game_key: "qf-3",
      round_key: "quarterfinal",
      round_order: 2,
      game_order: 3,
      source_a_team_id: "seed-2",
      source_a_game_id: null,
      source_b_team_id: null,
      source_b_game_id: 103,
    },
    {
      id: 108,
      game_key: "qf-4",
      round_key: "quarterfinal",
      round_order: 2,
      game_order: 4,
      source_a_team_id: "seed-3",
      source_a_game_id: null,
      source_b_team_id: null,
      source_b_game_id: 104,
    },
    {
      id: 109,
      game_key: "sf-1",
      round_key: "semifinal",
      round_order: 3,
      game_order: 1,
      source_a_team_id: null,
      source_a_game_id: 105,
      source_b_team_id: null,
      source_b_game_id: 106,
    },
    {
      id: 110,
      game_key: "sf-2",
      round_key: "semifinal",
      round_order: 3,
      game_order: 2,
      source_a_team_id: null,
      source_a_game_id: 107,
      source_b_team_id: null,
      source_b_game_id: 108,
    },
    {
      id: 111,
      game_key: "champ",
      round_key: "championship",
      round_order: 4,
      game_order: 1,
      source_a_team_id: null,
      source_a_game_id: 109,
      source_b_team_id: null,
      source_b_game_id: 110,
    },
  ];

  const topology = bracketTopologyFromRows(rows);

  validateBracketTopology(topology);

  assert.equal(topology.games.length, 11);

  const initialTeams = new Set(
    topology.games.flatMap((game) =>
      game.sources
        .filter((source) => source.type === "team")
        .map((source) => source.teamId),
    ),
  );

  assert.equal(initialTeams.size, 12);

  assert.deepEqual(
    resolveBracketGame(topology, "qf-1", {
      "r1-1": "seed-9",
    }).teamIds,
    ["seed-1", "seed-9"],
  );

  assert.deepEqual(
    resolveBracketGame(topology, "champ", {
      "r1-1": "seed-8",
      "r1-2": "seed-5",
      "r1-3": "seed-7",
      "r1-4": "seed-6",
      "qf-1": "seed-1",
      "qf-2": "seed-4",
      "qf-3": "seed-2",
      "qf-4": "seed-3",
      "sf-1": "seed-1",
      "sf-2": "seed-2",
    }).teamIds,
    ["seed-1", "seed-2"],
  );
});

test("persisted bracket adapter rejects malformed source rows", () => {
  const {
    bracketTopologyFromRows,
  } = require("../lib/bracket/persistence.ts");

  assert.throws(
    () =>
      bracketTopologyFromRows([
        {
          id: 1,
          game_key: "bad",
          round_key: "round",
          round_order: 1,
          game_order: 1,
          source_a_team_id: "team-a",
          source_a_game_id: 99,
          source_b_team_id: "team-b",
          source_b_game_id: null,
        },
      ]),
    /must have exactly one source/,
  );
});
