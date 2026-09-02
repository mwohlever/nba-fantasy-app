/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = function compile(module, filename) {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText,
    filename,
  );
};

const {
  canAccessOwnedResource,
  hasGroupCompetitiveHistory,
  hasValidInternalAuthorization,
  validateSlateTeamConfigurations,
} = require("../lib/security/resourcePolicy.ts");

function access(overrides = {}) {
  return canAccessOwnedResource({
    isSuperAdmin: false,
    activeGroupId: "group-111",
    targetGroupId: "group-111",
    canAdministerActiveGroup: true,
    requireCommissioner: true,
    activeLeagueIds: ["league-111"],
    targetLeagueId: "league-111",
    ...overrides,
  });
}

test("commissioners are limited to resources owned by their active Group", () => {
  assert.equal(access(), true);
  assert.equal(access({ targetGroupId: "other-group" }), false);
  assert.equal(access({ targetLeagueId: "other-league" }), false);
  assert.equal(access({ canAdministerActiveGroup: false }), false);
  assert.equal(access({ activeGroupId: null }), false);
});

test("Super Admin target-resource access is intentionally broader", () => {
  assert.equal(
    access({
      isSuperAdmin: true,
      activeGroupId: null,
      targetGroupId: "other-group",
      activeLeagueIds: [],
      targetLeagueId: "other-league",
      canAdministerActiveGroup: false,
    }),
    true,
  );
});

test("interactive member refresh allows only an enabled active-Group league", () => {
  assert.equal(access({ requireCommissioner: false, canAdministerActiveGroup: false }), true);
  assert.equal(access({ requireCommissioner: false, targetGroupId: "other-group" }), false);
});

test("internal authorization requires the configured Bearer secret", () => {
  assert.equal(hasValidInternalAuthorization("Bearer secret", "secret"), true);
  assert.equal(hasValidInternalAuthorization(null, "secret"), false);
  assert.equal(hasValidInternalAuthorization("Bearer wrong", "secret"), false);
  assert.equal(hasValidInternalAuthorization("Bearer secret", ""), false);
});

const validConfigs = [
  { team_id: 1, draft_order: 1, is_participating: true },
  { team_id: 2, draft_order: 2, is_participating: false },
];

test("slate team validation accepts exactly the active Group teams", () => {
  assert.equal(validateSlateTeamConfigurations(validConfigs, [1, 2]).ok, true);
});

test("slate team validation rejects cross-Group, unknown, duplicate, inactive, and missing teams", () => {
  assert.equal(validateSlateTeamConfigurations([...validConfigs, { team_id: 3, draft_order: 3, is_participating: true }], [1, 2]).ok, false);
  assert.equal(validateSlateTeamConfigurations([{ ...validConfigs[0] }, { ...validConfigs[0] }], [1]).ok, false);
  assert.equal(validateSlateTeamConfigurations([validConfigs[0]], [1, 2]).ok, false);
  assert.equal(validateSlateTeamConfigurations([{ team_id: 9, draft_order: 1, is_participating: true }], [1, 2]).ok, false);
});

test("all competitive history types block permanent Group deletion", () => {
  assert.equal(hasGroupCompetitiveHistory({ fantasySlates: 1, ncaaWeeks: 0, nbaSkinsSeasons: 0 }), true);
  assert.equal(hasGroupCompetitiveHistory({ fantasySlates: 0, ncaaWeeks: 1, nbaSkinsSeasons: 0 }), true);
  assert.equal(hasGroupCompetitiveHistory({ fantasySlates: 0, ncaaWeeks: 0, nbaSkinsSeasons: 1 }), true);
  assert.equal(hasGroupCompetitiveHistory({ fantasySlates: 0, ncaaWeeks: 0, nbaSkinsSeasons: 0, leagueAwards: 1 }), true);
  assert.equal(hasGroupCompetitiveHistory({ fantasySlates: 0, ncaaWeeks: 0, nbaSkinsSeasons: 0 }), false);
});

test("global tools require Super Admin and Group deletion uses one transactional RPC", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of [
    "app/api/admin/players/route.ts",
    "app/api/admin/players-nfl/route.ts",
    "app/api/sync-players/route.ts",
    "app/api/sync-players-nfl/route.ts",
    "app/api/admin/sync-golf-rankings/route.ts",
    "app/api/admin/push-devices/route.ts",
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /requireSuperAdminApi/);
  }

  const groupsRoute = fs.readFileSync(
    path.join(root, "app/api/admin/groups/route.ts"),
    "utf8",
  );
  assert.match(groupsRoute, /\.rpc\(\s*"delete_empty_group"/);
  assert.doesNotMatch(groupsRoute, /const cleanupTables/);

  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20260902_safe_empty_group_deletion.sql"),
    "utf8",
  );
  assert.match(migration, /begin;/i);
  assert.match(migration, /ncaa_pickem_weeks/);
  assert.match(migration, /nba_skins_seasons/);
});

test("mutating resource routes use target ownership and refresh routes retain internal mode", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of [
    "app/api/admin/slates/[slateId]/route.ts",
    "app/api/admin/lineup-correction/route.ts",
    "app/api/admin/manual-stat-correction/route.ts",
    "app/api/admin/recompute-slate-results/route.ts",
    "app/api/admin/backfill-player-stats/route.ts",
    "app/api/admin/golf/import-field/route.ts",
    "app/api/admin/golf/shotcast/route.ts",
    "app/api/admin/slate-nba-games/route.ts",
    "app/api/admin/slates/[slateId]/reseed/route.ts",
  ]) {
    assert.match(
      fs.readFileSync(path.join(root, file), "utf8"),
      /authorizeSlateResource/,
      file,
    );
  }

  for (const file of [
    "app/api/refresh-stats/route.ts",
    "app/api/refresh-stats-nfl/route.ts",
    "app/api/refresh-stats-golf/route.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /authorizeSlateResource/);
    assert.match(source, /allowInternal:\s*true/);
  }

  const ncaa = fs.readFileSync(
    path.join(root, "app/api/refresh-stats-ncaa/route.ts"),
    "utf8",
  );
  assert.match(ncaa, /authorizeNcaaWeekResource/);
  assert.match(ncaa, /allowInternal:\s*true/);
});
