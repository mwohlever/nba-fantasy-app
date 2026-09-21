/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
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

const {
  fetchNcaaPickEmWeek,
  fetchNcaaPostseasonEvents,
  normalizeNcaaEspnEvent,
} = require("../lib/providers/ncaa.ts");

function broadcast(network) {
  return {
    type: { shortName: "TV" },
    media: { shortName: network },
    market: { type: "National" },
    region: "us",
    lang: "en",
  };
}

function event({ state = "pre", completed = false, awayWinner = false, homeWinner = false } = {}) {
  return {
    id: "401999001",
    name: "Canonical Away at Canonical Home",
    shortName: "AWAY @ HOME",
    date: "2026-12-20T01:00:00.000Z",
    competitions: [{
      status: { type: { state, completed, detail: state === "in" ? "2nd Qtr - 03:21" : completed ? "Final/OT" : "Sat, 8:00 PM" } },
      geoBroadcasts: [broadcast("ESPN")],
      odds: [{
        spread: 3.5,
        overUnder: 51.5,
        provider: { name: "DraftKings" },
        awayTeamOdds: { favorite: true, team: { id: "team-away" } },
        homeTeamOdds: { favorite: false, team: { id: "team-home" } },
      }],
      competitors: [
        {
          id: "not-the-canonical-away-id",
          homeAway: "away",
          score: state === "pre" ? undefined : "24",
          winner: awayWinner,
          possession: state === "in",
          records: [{ type: "total", summary: "11-1" }],
          team: {
            id: "team-away",
            displayName: "Canonical Away",
            abbreviation: "AWAY",
            conferenceId: "8",
            logos: [{ href: "https://logos.example/away.png" }],
          },
        },
        {
          id: "not-the-canonical-home-id",
          homeAway: "home",
          score: state === "pre" ? undefined : "20",
          winner: homeWinner,
          records: [{ type: "total", summary: "10-2" }],
          team: {
            id: "team-home",
            displayName: "Canonical Home",
            abbreviation: "HOME",
            conferenceId: "5",
            logos: [{ href: "https://logos.example/home.png" }],
          },
        },
      ],
    }],
  };
}

test("shared CFB normalizer preserves ESPN event/team identity and scheduled metadata", () => {
  const game = normalizeNcaaEspnEvent(event(), new Map([["team-away", 3]]));

  assert.equal(game.espnEventId, "401999001");
  assert.equal(game.kickoffAt, "2026-12-20T01:00:00.000Z");
  assert.equal(game.status, "pre");
  assert.equal(game.completed, false);
  assert.equal(game.awayTeam.id, "team-away");
  assert.equal(game.homeTeam.id, "team-home");
  assert.notEqual(game.awayTeam.id, "not-the-canonical-away-id");
  assert.equal(game.awayTeam.rank, 3);
  assert.equal(game.homeTeam.rank, null);
  assert.equal(game.awayTeam.score, null);
  assert.equal(game.broadcast.network, "ESPN");
  assert.deepEqual(game.odds, {
    favoriteTeamId: "team-away",
    spread: -3.5,
    overUnder: 51.5,
    provider: "DraftKings",
  });
});

test("shared CFB normalizer handles live and final score states", () => {
  const live = normalizeNcaaEspnEvent(event({ state: "in" }));
  assert.equal(live.status, "in");
  assert.equal(live.statusDetail, "2nd Qtr - 03:21");
  assert.equal(live.awayTeam.score, 24);
  assert.equal(live.homeTeam.score, 20);
  assert.equal(live.possessionTeamId, "team-away");

  const final = normalizeNcaaEspnEvent(event({ state: "post", completed: true, awayWinner: true }));
  assert.equal(final.status, "post");
  assert.equal(final.completed, true);
  assert.equal(final.winnerTeamId, "team-away");
  assert.equal(final.statusDetail, "Final/OT");
});

test("postseason fetch requests ESPN's complete FBS postseason scoreboard and shares normalization", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(new URL(String(url)));
    return Response.json({ events: [event({ state: "post", completed: true, homeWinner: true })] });
  };

  try {
    const games = await fetchNcaaPostseasonEvents({ season: 2026 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname.endsWith("/college-football/scoreboard"), true);
    assert.equal(requests[0].searchParams.get("dates"), "2026");
    assert.equal(requests[0].searchParams.get("seasontype"), "3");
    assert.equal(requests[0].searchParams.get("groups"), "80");
    assert.equal(requests[0].searchParams.get("limit"), "500");
    assert.equal(games[0].espnEventId, "401999001");
    assert.equal(games[0].homeTeam.id, "team-home");
    assert.equal(games[0].winnerTeamId, "team-home");
    assert.equal(games[0].awayTeam.rank, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("regular-season NCAA Pick'em still uses its week/ranking policy with the shared normalizer", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    const request = new URL(String(url));
    requests.push(request);
    if (request.pathname.endsWith("/rankings")) {
      return Response.json({ rankings: [{ type: "ap", name: "AP Top 25", ranks: [{ current: 7, team: { id: "team-home" } }] }] });
    }
    return Response.json({ events: [event()] });
  };

  try {
    const result = await fetchNcaaPickEmWeek({ season: 2026, week: 4 });
    const scoreboard = requests.find((request) => request.pathname.endsWith("/scoreboard"));
    assert.equal(scoreboard.searchParams.get("seasontype"), "2");
    assert.equal(scoreboard.searchParams.get("week"), "4");
    assert.equal(scoreboard.searchParams.get("groups"), "80");
    assert.equal(result.scheduleGames[0].homeTeam.rank, 7);
    assert.equal(result.scheduleGames[0].status, "pre");
    assert.equal(result.eligibleGames.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
