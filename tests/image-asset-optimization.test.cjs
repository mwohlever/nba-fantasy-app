/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement } = require("react");

require.extensions[".tsx"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText, filename);
};

const TeamAvatar = require("../components/ui/TeamAvatar.tsx").default;

test("shared static UI assets use small WebP display files while masters remain available", () => {
  for (const name of ["logo_all_sports", "nba", "nfl", "golf"]) {
    assert.ok(fs.existsSync(path.join("public/logos", `${name}.png`)), `${name} master retained`);
    const optimized = path.join("public/logos", `${name}.webp`);
    assert.ok(fs.existsSync(optimized), `${name} optimized display asset exists`);
    assert.ok(fs.statSync(optimized).size < fs.statSync(path.join("public/logos", `${name}.png`)).size);
  }
  assert.match(fs.readFileSync("lib/sports.ts", "utf8"), /\/logos\/golf\.webp/);
  assert.match(fs.readFileSync("components/AppNav.tsx", "utf8"), /logo_all_sports\.webp/);
});

test("shared team avatar uses the optimized default portrait and preserves custom-avatar preference", () => {
  const custom = renderToStaticMarkup(createElement(TeamAvatar, { teamName: "Mark", avatarUrl: "https://images.example/custom.jpg" }));
  const fallback = renderToStaticMarkup(createElement(TeamAvatar, { teamName: "Mark", avatarUrl: null }));
  assert.match(custom, /images\.example\/custom\.jpg/);
  assert.match(fallback, /team-headshots\/mark\.webp/);
  assert.match(fallback, /width="40"/);
  assert.match(fallback, /height="40"/);
});

test("NBA and NFL primary Draft, Scores, history, and Game Center DTOs carry optimized headshot URLs", () => {
  const draft = fs.readFileSync("app/lineups/draft/page.tsx", "utf8");
  const scores = fs.readFileSync("app/lineups/scores/page.tsx", "utf8");
  const history = fs.readFileSync("app/api/player-history/route.ts", "utf8");
  const roster = fs.readFileSync("app/api/team-slate-roster/route.ts", "utf8");
  const gameCenter = fs.readFileSync("app/api/live-scores/nfl/game-detail/route.ts", "utf8");
  assert.match(draft, /nfl_player_id, team_abbreviation, headshot_url/);
  assert.match(draft, /nba_player_id, headshot_url/);
  assert.match(scores, /headshot_url: p\.headshot_url \?\? null/);
  assert.match(history, /external_id:nfl_player_id, headshot_url/);
  assert.match(roster, /headshotUrl:\s*player\?\.headshot_url/);
  assert.match(gameCenter, /optimizedHeadshotsByAthleteId/);
});
