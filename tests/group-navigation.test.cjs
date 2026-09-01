/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};

const { getGroupSwitchDestination } = require("../lib/groups/navigation.ts");

const targetHome = "/groups/test-group";

function destination(pathname, search, options = {}) {
  return getGroupSwitchDestination({
    pathname,
    search,
    targetGroupSlug: "test-group",
    enabledSports: options.enabledSports ?? ["nba", "nfl", "golf", "ncaa", "nba-skins"],
    canAdministerGroup: options.canAdministerGroup ?? false,
    isSuperAdmin: options.isSuperAdmin ?? false,
  });
}

test("NCAA Home and standings are preserved only when NCAA is enabled", () => {
  assert.equal(destination("/ncaa-pickem", "", { enabledSports: ["ncaa"] }), "/ncaa-pickem");
  assert.equal(destination("/ncaa-pickem/standings", "", { enabledSports: ["ncaa"] }), "/ncaa-pickem/standings");
  assert.equal(destination("/ncaa-pickem/standings", "", { enabledSports: ["nba"] }), targetHome);
});

test("shared fantasy routes preserve NBA, NFL, and Golf only when enabled", () => {
  for (const pathname of ["/home", "/standings", "/player-history", "/lineups/draft", "/lineups/scores"]) {
    for (const sport of ["nba", "nfl", "golf"]) {
      assert.equal(destination(pathname, `?sport=${sport}`, { enabledSports: [sport] }), `${pathname}?sport=${sport}`);
      assert.equal(destination(pathname, `?sport=${sport}`, { enabledSports: [] }), targetHome);
    }
  }
});

test("commissioner NCAA requires both permission and the enabled game", () => {
  assert.equal(destination("/admin/ncaa-pickem", "", { enabledSports: ["ncaa"], canAdministerGroup: true }), "/admin/ncaa-pickem");
  assert.equal(destination("/admin/ncaa-pickem", "", { enabledSports: ["ncaa"], canAdministerGroup: false }), targetHome);
  assert.equal(destination("/admin/ncaa-pickem", "", { enabledSports: ["nba"], canAdministerGroup: true }), targetHome);
});

test("notification pages require permission and their selected sport", () => {
  assert.equal(destination("/admin/notification-templates", "?sport=nfl", { enabledSports: ["nfl"], canAdministerGroup: true }), "/admin/notification-templates?sport=nfl");
  assert.equal(destination("/admin/notification-history", "?sport=nfl", { enabledSports: ["nba"], canAdministerGroup: true }), targetHome);
  assert.equal(destination("/admin/notification-history", "?sport=nfl", { enabledSports: ["nfl"], canAdministerGroup: false }), targetHome);
});

test("resource-bearing, unknown, and unclassified routes fall back safely", () => {
  assert.equal(destination("/lineups/scores", "?sport=nba&slateId=167"), targetHome);
  assert.equal(destination("/admin/slates/167", "?sport=nba", { canAdministerGroup: true }), targetHome);
  assert.equal(destination("/something-new", ""), targetHome);
});

test("switching from any Group Home opens the target Group Home", () => {
  assert.equal(destination("/groups/111", ""), targetHome);
  assert.equal(destination("/groups/old-group", "?sport=nfl"), targetHome);
});
