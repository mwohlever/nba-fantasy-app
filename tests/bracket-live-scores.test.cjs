/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  return originalResolve.call(
    this,
    request.startsWith("@/") ? path.join(root, request.slice(2)) : request,
    parent,
    isMain,
    options,
  );
};
require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText, filename);
};
Module._load = function load(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/bracket/challenge.server") {
    return { getBracketChallengeDetail: async () => null };
  }
  if (request === "@/lib/providers/ncaa") {
    return { fetchNcaaPostseasonEvents: async () => [] };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { buildBracketLiveScoresModel } = require("../lib/bracket/liveScores.server.ts");
Module._load = originalLoad;

function team(id, seed) {
  return {
    seed,
    providerTeamId: id,
    displayName: `Team ${id}`,
    abbreviation: id,
    logoUrl: `https://logos.example/${id}.png`,
  };
}

function providerGame(id, awayId, homeId) {
  return {
    espnEventId: id,
    name: `${awayId} at ${homeId}`,
    shortName: null,
    kickoffAt: "2026-12-20T01:00:00.000Z",
    awayTeam: { id: awayId, displayName: `Team ${awayId}`, abbreviation: awayId, logo: null, rank: null, record: null, score: 20, winner: false },
    homeTeam: { id: homeId, displayName: `Team ${homeId}`, abbreviation: homeId, logo: null, rank: null, record: null, score: 24, winner: true },
    status: "post",
    statusDetail: "Final",
    completed: true,
    winnerTeamId: homeId,
    odds: null,
  };
}

function detail({ firstProviderEventId = "event-first", firstStatus = "scheduled", firstWinnerTeamId = null, finalProviderEventId = null } = {}) {
  return {
    group: { id: "group-1", name: "Test Group", slug: "test" },
    league: { id: "league-1", name: "Bracket Challenge", slug: "bracket" },
    canAdministerGroup: false,
    canManageCompetitionField: false,
    contest: { id: "contest-1", status: "open", lockAt: null, maxBracketsPerEntrant: 1, managedEntrantsAllowed: false, rulesVersion: 1, rulesSnapshot: {} },
    competition: { id: 1, sportKey: "college_football", formatKey: "cfp", season: 2026, name: "CFP", status: "open", startsAt: null, endsAt: null, topologyVersion: 1 },
    teams: [team("A", 1), team("B", 2), team("C", 3)],
    games: [
      {
        id: 10, gameKey: "first-1", roundKey: "first_round", roundOrder: 1, gameOrder: 1, regionKey: null,
        sourceATeamId: "A", sourceAGameId: null, sourceASeed: 1,
        sourceBTeamId: "B", sourceBGameId: null, sourceBSeed: 2,
        providerEventId: firstProviderEventId, scheduledAt: "2026-12-20T01:00:00.000Z", lockAt: null,
        status: firstStatus, winnerTeamId: firstWinnerTeamId,
      },
      {
        id: 20, gameKey: "championship", roundKey: "championship", roundOrder: 2, gameOrder: 1, regionKey: null,
        sourceATeamId: null, sourceAGameId: 10, sourceASeed: null,
        sourceBTeamId: "C", sourceBGameId: null, sourceBSeed: 3,
        providerEventId: finalProviderEventId, scheduledAt: null, lockAt: null,
        status: "scheduled", winnerTeamId: null,
      },
    ],
  };
}

test("valid explicit binding attaches a provider game only when both resolved canonical teams match", () => {
  const model = buildBracketLiveScoresModel({
    detail: detail(),
    providerGames: [providerGame("event-first", "A", "B")],
    providerAvailable: true,
  });
  const game = model.games[0];
  assert.equal(game.provider.mappingState, "valid");
  assert.equal(game.provider.game.espnEventId, "event-first");
  assert.equal(game.participants.a.team.providerTeamId, "A");
  assert.equal(game.participants.b.team.providerTeamId, "B");
});

test("unmapped and missing provider events remain in the official bracket slate", () => {
  const unmapped = buildBracketLiveScoresModel({
    detail: detail({ firstProviderEventId: null }),
    providerGames: [],
    providerAvailable: true,
  });
  assert.equal(unmapped.games[0].provider.mappingState, "unmapped");
  assert.equal(unmapped.games.length, 2);

  const missing = buildBracketLiveScoresModel({
    detail: detail({ firstProviderEventId: "absent" }),
    providerGames: [],
    providerAvailable: true,
  });
  assert.equal(missing.games[0].provider.mappingState, "not_found");
  assert.equal(missing.games.length, 2);
});

test("identity mismatch is surfaced and the provider game is not accepted", () => {
  const model = buildBracketLiveScoresModel({
    detail: detail(),
    providerGames: [providerGame("event-first", "A", "C")],
    providerAvailable: true,
  });
  assert.equal(model.games[0].provider.mappingState, "identity_mismatch");
  assert.equal(model.games[0].provider.game, undefined);
});

test("unresolved graph dependencies retain their official source label without entrant picks", () => {
  const model = buildBracketLiveScoresModel({
    detail: detail({ finalProviderEventId: "event-final" }),
    providerGames: [providerGame("event-final", "A", "C")],
    providerAvailable: true,
  });
  const final = model.games[1];
  assert.deepEqual(final.participants.a, {
    status: "unresolved",
    sourceLabel: "Winner of First Round 1",
  });
  assert.equal(final.participants.b.team.providerTeamId, "C");
  assert.equal(final.provider.mappingState, "partially_valid");
});

test("provider failure preserves official nodes and marks mapped events unavailable", () => {
  const model = buildBracketLiveScoresModel({
    detail: detail(),
    providerGames: [],
    providerAvailable: false,
  });
  assert.equal(model.provider.availability, "unavailable");
  assert.equal(model.games.length, 2);
  assert.equal(model.games[0].provider.mappingState, "provider_unavailable");
});

test("live-score boundary delegates contest authorization to the established detail loader and contains no writes", () => {
  const adapter = fs.readFileSync(path.join(root, "lib/bracket/liveScores.server.ts"), "utf8");
  const route = fs.readFileSync(path.join(root, "app/api/bracket-challenge/contests/[contestId]/live/route.ts"), "utf8");
  assert.match(adapter, /getBracketChallengeDetail\(user, contestId\)/);
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /getBracketContestLiveScores\(user, contestId\)/);
  assert.doesNotMatch(adapter, /\.update\(|\.upsert\(|\.insert\(|\.delete\(|recomputeFrozenBracketEntriesForCompetition/);
});
