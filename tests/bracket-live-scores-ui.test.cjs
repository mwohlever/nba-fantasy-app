/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = function compile(module, filename) {
    module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText, filename);
  };
}

const BracketLiveScoreCard = require("../components/bracket/BracketLiveScoreCard.tsx").default;

const team = (id, seed) => ({ seed, providerTeamId: id, displayName: `Team ${id}`, abbreviation: id, logoUrl: null });
const participants = { a: { status: "resolved", team: team("A", 1) }, b: { status: "resolved", team: team("B", 8) } };
const providerGame = {
  espnEventId: "event-1", name: "Team A at Team B", shortName: "A @ B", kickoffAt: "2026-12-20T01:00:00.000Z",
  awayTeam: { id: "A", displayName: "Team A", abbreviation: "A", logo: null, rank: null, record: null, score: 10, winner: false },
  homeTeam: { id: "B", displayName: "Team B", abbreviation: "B", logo: null, rank: null, record: null, score: 17, winner: true },
  status: "post", statusDetail: "Final", completed: true, winnerTeamId: "B", odds: null,
};

test("validated provider games reuse the shared score-card path and keep CFP seeds as bracket metadata", () => {
  const markup = renderToStaticMarkup(createElement(BracketLiveScoreCard, {
    game: { gameKey: "first-1", gameOrder: 1, scheduledAt: providerGame.kickoffAt, officialStatus: "scheduled", participants, provider: { mappingState: "valid", game: providerGame } },
  }));
  assert.match(markup, /CFP seeds/);
  assert.match(markup, /#1 A/);
  assert.match(markup, /17/);
  assert.doesNotMatch(markup, /#1 Team A/);
});

test("unmapped, provider-unavailable, and mismatched cards retain official teams or dependency labels without exposing implementation states", () => {
  const unresolved = { a: { status: "unresolved", sourceLabel: "Winner of First Round 1" }, b: { status: "resolved", team: team("C", 4) } };
  for (const mappingState of ["unmapped", "provider_unavailable", "identity_mismatch"]) {
    const markup = renderToStaticMarkup(createElement(BracketLiveScoreCard, {
      game: { gameKey: "champ", gameOrder: 1, scheduledAt: null, officialStatus: "scheduled", participants: unresolved, provider: { mappingState, game: providerGame } },
    }));
    assert.match(markup, /Winner of First Round 1/);
    assert.match(markup, /#4/);
    assert.doesNotMatch(markup, new RegExp(mappingState));
    assert.doesNotMatch(markup, /17/);
  }
});

test("Live Scores page is round-first, uses the new API, retains AppNav, and polls only safely live provider games", () => {
  const source = fs.readFileSync(path.join(root, "app/bracket-challenge/[contestId]/live/page.tsx"), "utf8");
  assert.match(source, /\/api\/bracket-challenge\/contests\/\$\{encodeURIComponent\(contestId\)\}\/live/);
  assert.match(source, /rounds\.slice\(\)\.sort\(\(left, right\) => left\.order - right\.order\)/);
  assert.match(source, /orderedRoundGames\(data\.games, round\.key\)/);
  assert.match(source, /<BracketLiveScoreCard game=\{game\} \/>/);
  assert.match(source, /game\.provider\.mappingState === "valid"/);
  assert.match(source, /game\.provider\.game\?\.status === "in"/);
  assert.match(source, /window\.setInterval\(\(\) => \{ void load\(\); \}, 20_000\)/);
  assert.match(source, /<AppNav \/>/);
  assert.match(source, /mx-auto max-w-5xl space-y-6/);
  assert.doesNotMatch(source, /NcaaGameCenterModal|game-detail|ncaa-pickem/);
});
