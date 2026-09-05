/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = function compile(module, filename) {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText,
    filename,
  );
};

const {
  calculateCorrectionFantasyPoints,
  getCorrectionPlayerSource,
  parseCorrectionSport,
  uniqueParticipatingTeamIds,
} = require("../lib/corrections/correctionPolicy.ts");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Corrections accepts only its explicitly supported URL sports", () => {
  assert.equal(parseCorrectionSport("nba"), "nba");
  assert.equal(parseCorrectionSport("nfl"), "nfl");
  assert.equal(parseCorrectionSport("golf"), null);
  assert.equal(parseCorrectionSport(null), null);
});

test("NBA and NFL correction pickers use separate player catalogs", () => {
  assert.equal(getCorrectionPlayerSource("nba").table, "players");
  assert.equal(getCorrectionPlayerSource("nfl").table, "players_nfl");

  const route = source("app/api/admin/correction-data/route.ts");
  assert.match(route, /\.eq\("league_id", activeLeague\.league\.id\)/);
  assert.match(route, /\.eq\("sport", sport\)/);
  assert.match(route, /\.eq\("group_id", activeLeague\.context\.group\.id\)/);
  assert.match(route, /\.from\("slate_teams"\)/);
  assert.doesNotMatch(route, /from\("teams"\)\.select\("id, name"\)\.order/);
});

test("selected-slate participant IDs are filtered and deduplicated without membership filtering", () => {
  assert.deepEqual(
    uniqueParticipatingTeamIds([
      { team_id: 11, is_participating: true },
      { team_id: 11, is_participating: true },
      { team_id: 12, is_participating: false },
      { team_id: 13, is_participating: true },
    ]),
    [11, 13],
  );
  assert.doesNotMatch(source("app/api/admin/correction-data/route.ts"), /group_memberships/);
});

test("manual corrections use immutable slate scoring for NBA and NFL", () => {
  assert.equal(
    calculateCorrectionFantasyPoints({
      sport: "nba",
      stats: { points: 10, rebounds: 2, assists: 1, steals: 0, blocks: 0, turnovers: 1 },
      scoring: { points: 2, rebounds: 3, assists: 4, steals: 5, blocks: 6, turnovers: -2 },
    }),
    28,
  );
  assert.equal(
    calculateCorrectionFantasyPoints({
      sport: "nfl",
      stats: {
        passing_yards: 100,
        passing_tds: 1,
        passing_ints: 1,
        rushing_yards: 10,
        rushing_tds: 0,
        receiving_yards: 0,
        receiving_tds: 0,
        receptions: 0,
        fumbles_lost: 0,
      },
      scoring: {
        passingYards: 0.05,
        passingTouchdowns: 6,
        passingInterceptions: -3,
        rushingYards: 0.2,
        rushingTouchdowns: 6,
        receivingYards: 0.1,
        receivingTouchdowns: 6,
        receptions: 1,
        fumblesLost: -2,
      },
    }),
    10,
  );

  const route = source("app/api/admin/manual-stat-correction/route.ts");
  assert.match(route, /resolveLeagueRules\(\{ sport, settings: slate\.rules_snapshot \}\)/);
  assert.doesNotMatch(route, /rebounds \* 1\.2/);
});

test("correction mutations retain Batch 1 target authorization and sport checks", () => {
  for (const file of [
    "app/api/admin/manual-stat-correction/route.ts",
    "app/api/admin/lineup-correction/route.ts",
    "app/api/admin/recompute-slate-results/route.ts",
  ]) {
    const route = source(file);
    assert.match(route, /authorizeSlateResource/);
    assert.match(route, /requireCommissioner:\s*true/);
  }
  assert.match(source("app/api/admin/lineup-correction/route.ts"), /players_nfl/);
});

test("Corrections is URL-authoritative and links back to sport Commissioner Center", () => {
  const page = source("app/admin/corrections/page.tsx");
  const admin = source("app/admin/page.tsx");
  assert.match(page, /searchParams\.get\("sport"\)/);
  assert.match(page, /href=\{`\/admin\?sport=\$\{sport\}`\}/);
  assert.match(admin, /`\/admin\/corrections\?sport=\$\{selectedSport\}`/);
});
