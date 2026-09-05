/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
};

const { selectNcaaApRankingGroup, selectNcaaOdds } = require("../lib/providers/ncaa.ts");
const {
  getNcaaIncludedEventIds,
  getNcaaLockAt,
  getNewlySelectedCompletedOptionalIds,
  hasExactlyOneNcaaRankedTeam,
  isNcaaRankedVsRanked,
} = require("../lib/ncaaPickEm/gameSelection.ts");
const { selectNcaaPickEmParticipants } = require("../lib/ncaaPickEm/participants.ts");

function game(id, awayRank, homeRank, kickoffAt, completed = false) {
  return {
    espnEventId: id,
    kickoffAt,
    awayTeam: { id: `${id}-a`, displayName: "Away", abbreviation: "AWY", logo: null, rank: awayRank, record: null, score: null },
    homeTeam: { id: `${id}-h`, displayName: "Home", abbreviation: "HME", logo: null, rank: homeRank, record: null, score: null },
    status: completed ? "final" : "scheduled",
    statusDetail: completed ? "Final" : "Scheduled",
    completed,
    winnerTeamId: null,
  };
}

test("participants use Group teams and exclude inactive or other-Group identities", () => {
  const users = [
    { id: "shared", avatar_url: "shared.png", is_active: true },
    { id: "inactive", avatar_url: null, is_active: true },
    { id: "disabled", avatar_url: null, is_active: false },
  ];
  const groupOne = selectNcaaPickEmParticipants({
    groupId: "111",
    memberships: [{ user_id: "shared" }],
    teams: [
      { id: 4, name: "Mark", user_id: "shared", group_id: "111" },
      { id: 8, name: "Mark (Test Group)", user_id: "shared", group_id: "test" },
      { id: 5, name: "Mark YMCA", user_id: "inactive", group_id: "111" },
      { id: 9, name: "Disabled", user_id: "disabled", group_id: "111" },
    ],
    users,
  });
  const groupTwo = selectNcaaPickEmParticipants({
    groupId: "test",
    memberships: [{ user_id: "shared" }],
    teams: [{ id: 8, name: "Mark (Test Group)", user_id: "shared", group_id: "test" }],
    users,
  });

  assert.deepEqual(groupOne.map((participant) => participant.teamId), [4]);
  assert.deepEqual(groupTwo.map((participant) => participant.teamId), [8]);
});

test("AP poll is selected by type regardless of array order", () => {
  const polls = [
    { type: "fcs", name: "FCS Poll", ranks: [{ current: 1 }] },
    { type: "usa", name: "AFCA Coaches", ranks: [{ current: 1 }] },
    { type: "ap", name: "AP Top 25", shortName: "AP Poll", ranks: [{ current: 1 }] },
  ];
  assert.equal(selectNcaaApRankingGroup(polls), polls[2]);
  assert.equal(selectNcaaApRankingGroup(polls.filter((poll) => poll.type !== "ap")), null);
});

test("current Week 1 ranking state makes Louisville-Ole Miss automatic and Clemson-LSU optional", () => {
  const louisvilleOleMiss = game("401856661", 24, 9, "2026-09-06T23:30:00.000Z");
  const clemsonLsu = game("401856660", null, 11, "2026-09-05T23:30:00.000Z");
  assert.equal(isNcaaRankedVsRanked(louisvilleOleMiss), true);
  assert.equal(hasExactlyOneNcaaRankedTeam(clemsonLsu), true);
  assert.deepEqual([...getNcaaIncludedEventIds([clemsonLsu, louisvilleOleMiss], new Set())], ["401856661"]);
});

test("automatic and commissioner provenance controls inclusion without deleting picks", () => {
  const automatic = game("automatic", 24, 9, "2026-09-06T23:30:00.000Z");
  const optional = game("optional", null, 11, "2026-09-05T23:30:00.000Z");
  const staleAutomatic = game("stale", null, 13, "2026-09-05T20:00:00.000Z");
  assert.deepEqual([...getNcaaIncludedEventIds([automatic, optional, staleAutomatic], new Set(["optional"]))].sort(), ["automatic", "optional"]);
  assert.deepEqual([...getNcaaIncludedEventIds([automatic, optional], new Set())], ["automatic"]);
});

test("lock follows earliest included game and moves when optional selection changes", () => {
  const laterAutomatic = game("automatic", 24, 9, "2026-09-06T23:30:00.000Z");
  const earlierOptional = game("optional", null, 11, "2026-09-05T23:30:00.000Z");
  assert.equal(getNcaaLockAt([laterAutomatic, earlierOptional], new Set(["automatic"])), laterAutomatic.kickoffAt);
  assert.equal(getNcaaLockAt([laterAutomatic, earlierOptional], new Set(["automatic", "optional"])), earlierOptional.kickoffAt);
  assert.equal(getNcaaLockAt([laterAutomatic, earlierOptional], new Set()), null);
});

test("completed optional games cannot be newly commissioner-selected", () => {
  const completed = game("optional", null, 11, "2026-09-05T23:30:00.000Z", true);
  assert.deepEqual(getNewlySelectedCompletedOptionalIds({ games: [completed], requestedIncludedEventIds: new Set(["optional"]), previouslyCommissionerSelectedEventIds: new Set() }), ["optional"]);
  assert.deepEqual(getNewlySelectedCompletedOptionalIds({ games: [completed], requestedIncludedEventIds: new Set(["optional"]), previouslyCommissionerSelectedEventIds: new Set(["optional"]) }), []);
});


test("ESPN odds parser returns favorite, spread, total, and provider", () => {
  const odds = selectNcaaOdds([
    {
      spread: 3,
      overUnder: 48.5,
      provider: {
        name: "DraftKings",
      },
      awayTeamOdds: {
        favorite: true,
        team: {
          id: "1",
        },
      },
      homeTeamOdds: {
        favorite: false,
        team: {
          id: "2",
        },
      },
    },
  ]);

  assert.deepEqual(odds, {
    favoriteTeamId: "1",
    spread: -3,
    overUnder: 48.5,
    provider: "DraftKings",
  });
});

test("ESPN odds parser treats missing odds as unavailable", () => {
  assert.equal(
    selectNcaaOdds(undefined),
    null,
  );

  assert.equal(
    selectNcaaOdds([]),
    null,
  );

  assert.equal(
    selectNcaaOdds([
      {
        spread: null,
        overUnder: null,
      },
    ]),
    null,
  );
});

test("ESPN odds parser supports total-only odds", () => {
  const odds = selectNcaaOdds([
    {
      spread: null,
      overUnder: 55.5,
      provider: {
        name: "DraftKings",
      },
    },
  ]);

  assert.deepEqual(odds, {
    favoriteTeamId: null,
    spread: null,
    overUnder: 55.5,
    provider: "DraftKings",
  });
});
