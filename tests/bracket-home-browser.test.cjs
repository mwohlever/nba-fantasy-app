require("typescript").transpileModule;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Module = require("node:module");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const original = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { competitionCategoryIdentity, competitionIdentity, defaultBracketHomeSeason, filterBracketHomeCompetitions } = require("../lib/bracket/homeBrowser.ts");
test.after(() => { Module._extensions[".ts"] = original; });

const competitions = [
  { competition: { id: 1, season: 2025, sportKey: "college_football", formatKey: "cfp", status: "final", startsAt: "2025-12-20T00:00:00Z", endsAt: "2026-01-20T00:00:00Z" } },
  { competition: { id: 2, season: 2026, sportKey: "college_football", formatKey: "cfp", status: "open", startsAt: "2026-12-20T00:00:00Z", endsAt: null } },
  { competition: { id: 3, season: 2027, sportKey: "mens_college_basketball", formatKey: "ncaa_mens", status: "setup", startsAt: "2027-03-15T00:00:00Z", endsAt: null } },
];

test("Home derives multiple seasons and defaults to the relevant current season", () => {
  assert.equal(defaultBracketHomeSeason(competitions, new Date("2026-09-22T00:00:00Z")), 2026);
  assert.equal(defaultBracketHomeSeason(competitions.filter((item) => item.competition.season !== 2026), new Date("2026-09-22T00:00:00Z")), 2027);
});

test("Home filters by year, competition, and their intersection", () => {
  assert.deepEqual(filterBracketHomeCompetitions(competitions, 2025, "all").map((item) => item.competition.id), [1]);
  assert.deepEqual(filterBracketHomeCompetitions(competitions, null, "college_football").map((item) => item.competition.id), [1, 2]);
  assert.deepEqual(filterBracketHomeCompetitions(competitions, 2026, "college_football").map((item) => item.competition.id), [2]);
  assert.equal(competitionCategoryIdentity(competitions[0]), "college_football");
  assert.equal(competitionIdentity(competitions[2]), "mens_college_basketball:ncaa_mens");
});

test("Home browser keeps global competitions distinct from active-Group contests and is read-only", () => {
  const source = fs.readFileSync(path.join(root, "lib/bracket/competitions.server.ts"), "utf8");
  assert.match(source, /from\("bracket_competitions"\)/);
  assert.match(source, /from\("bracket_contests"\)/);
  assert.match(source, /\.eq\("league_id", leagueId\)/);
  assert.match(source, /contest: contest \?/);
  assert.match(source, /personalSummary: contest \?/);
  assert.doesNotMatch(source, /loadBracketChallengeCompetitionBrowser[\s\S]*?\.insert\(/);
  assert.doesNotMatch(source, /loadBracketChallengeCompetitionBrowser[\s\S]*?\.update\(/);
});

test("Home cards preserve existing contest navigation and expose unavailable global competitions without a link", () => {
  const page = fs.readFileSync(path.join(root, "app/bracket-challenge/page.tsx"), "utf8");
  assert.match(page, /href=\{`\/bracket-challenge\/\$\{encodeURIComponent\(item\.contest\.contestId\)\}`\}/);
  assert.match(page, /Not set up for this Group/);
  assert.match(page, /Group contest unavailable/);
  assert.match(page, /aria-label="Bracket Challenge filters"/);
  assert.match(page, /college_football: "College Football"/);
  assert.match(page, /college_football:cfp": "College Football · 12-team playoff"/);
  assert.match(page, /<AppNav \/>/);
});
