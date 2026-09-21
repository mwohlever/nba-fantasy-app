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
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
};
Module._load = function load(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const { isValidBracketGameCenterEvent } = require("../lib/bracket/gameCenter.server.ts");
Module._load = originalLoad;

function liveScores(games) {
  return { games };
}

test("production Game Center authorization accepts only a fully validated explicitly bound event", () => {
  const valid = {
    providerEventId: "401858432",
    provider: { mappingState: "valid", game: { espnEventId: "401858432" } },
  };
  assert.equal(isValidBracketGameCenterEvent(liveScores([valid]), "401858432"), true);
  assert.equal(isValidBracketGameCenterEvent(liveScores([valid]), "999999"), false);

  for (const mappingState of ["unmapped", "not_found", "identity_mismatch", "provider_unavailable", "bound_unresolved", "partially_valid"]) {
    assert.equal(isValidBracketGameCenterEvent(liveScores([{
      providerEventId: "401858432",
      provider: { mappingState, game: { espnEventId: "401858432" } },
    }]), "401858432"), false);
  }
});

test("Bracket game-detail route authorizes the contest before shared ESPN detail handling and rejects arbitrary production events", () => {
  const route = fs.readFileSync(path.join(root, "app/api/bracket-challenge/contests/[contestId]/game-detail/route.ts"), "utf8");
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /getBracketContestLiveScores\(user, contestId\)/);
  assert.match(route, /isValidBracketGameCenterEvent\(liveScores, eventId\)/);
  assert.match(route, /if \(!developmentHarness && !productionEvent\)/);
  assert.match(route, /createFootballGameDetailHandler\(\s*"college-football"/);
  assert.doesNotMatch(route, /ncaa-pickem\/game-detail|fetch\([^\n]*ncaa-pickem/);
});

test("development harness is explicitly non-production, authenticated through the same contest route, and read-only", () => {
  const route = fs.readFileSync(path.join(root, "app/api/bracket-challenge/contests/[contestId]/game-detail/route.ts"), "utf8");
  const harness = fs.readFileSync(path.join(root, "components/bracket/BracketGameCenterDevHarness.tsx"), "utf8");
  assert.match(route, /process\.env\.NODE_ENV !== "production"/);
  assert.match(route, /devGameCenter/);
  assert.match(harness, /process\.env\.NODE_ENV === "production" \|\| !eventId/);
  assert.match(harness, /NEXT_PUBLIC_BRACKET_GAME_CENTER_DEV_EVENT_ID/);
  for (const source of [route, harness]) {
    assert.doesNotMatch(source, /provider_event_id|bracket_games|\.update\(|\.upsert\(|\.insert\(|\.delete\(|recomputeFrozenBracketEntriesForCompetition/);
  }
});

test("Bracket wrapper and valid score cards reuse shared GameCenterModal without copying Game Center UI", () => {
  const wrapper = fs.readFileSync(path.join(root, "components/bracket/BracketGameCenterModal.tsx"), "utf8");
  const card = fs.readFileSync(path.join(root, "components/bracket/BracketLiveScoreCard.tsx"), "utf8");
  const page = fs.readFileSync(path.join(root, "app/bracket-challenge/[contestId]/live/page.tsx"), "utf8");
  assert.match(wrapper, /GameCenterModal/);
  assert.match(wrapper, /detailQuery=\{developmentHarness \? "devGameCenter=1" : undefined\}/);
  assert.match(card, /game\.provider\.mappingState === "valid"/);
  assert.match(card, /onOpenGameCenter/);
  assert.match(card, /onClick=/);
  assert.match(page, /BracketGameCenterModal/);
  assert.match(page, /BracketGameCenterDevHarness/);
  assert.doesNotMatch(wrapper, /FootballPlayByPlay|FootballPlayField|scoringPlays|boxscore/);
});

test("shared Game Center polling and mobile replay structure remain untouched", () => {
  const modal = fs.readFileSync(path.join(root, "components/live-scores/GameCenterModal.tsx"), "utf8");
  const plays = fs.readFileSync(path.join(root, "components/live-scores/FootballPlayByPlay.tsx"), "utf8");
  assert.match(modal, /window\.setInterval\(\(\) => \{\s*void loadGameDetail\(\);\s*\}, 15000\)/);
  assert.match(modal, /FootballPlayByPlay/);
  assert.match(plays, /sticky top-0/);
  assert.match(plays, /FootballPlayField compact/);
});
