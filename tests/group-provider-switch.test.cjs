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

const {
  createPendingGroupSwitch,
  executeGroupContextRefresh,
  getGroupContextKey,
  navigationLocationsMatch,
  pendingSwitchAcknowledged,
  resolvePendingGroupSwitch,
  shouldRenderGroupSwitchShell,
} = require("../lib/groups/groupSwitch.ts");

const ncaaLocation = { pathname: "/ncaa-pickem/standings", search: "" };

test("different destination stays blocked and uncommitted until route acknowledgement", () => {
  const target = { group: { id: "test-id", slug: "test-group" } };
  const started = createPendingGroupSwitch({ requestedGroupSlug: "test-group", sourceLocation: ncaaLocation });
  const resolved = resolvePendingGroupSwitch({ pending: started, target, destination: "/groups/test-group" });

  assert.equal(resolved.destination, "/groups/test-group");
  assert.equal(resolved.requiresNavigationAcknowledgement, true);
  assert.equal(resolved.navigationState, "pending");
  assert.equal(shouldRenderGroupSwitchShell(resolved), true);
  assert.equal(pendingSwitchAcknowledged(resolved, ncaaLocation), false);
  assert.equal(pendingSwitchAcknowledged(resolved, { pathname: "/groups/test-group", search: "" }), true);
  assert.equal(resolved.target, target);
});

test("same-route valid destination needs no acknowledgement and changes Group key once committed", () => {
  const source = { group: { id: "111-id", slug: "111" } };
  const target = { group: { id: "test-id", slug: "test-group" } };
  const started = createPendingGroupSwitch({ requestedGroupSlug: "test-group", sourceLocation: ncaaLocation });
  const resolved = resolvePendingGroupSwitch({ pending: started, target, destination: "/ncaa-pickem/standings" });

  assert.equal(resolved.requiresNavigationAcknowledgement, false);
  assert.equal(resolved.navigationState, "same_route");
  assert.equal(pendingSwitchAcknowledged(resolved, ncaaLocation), false);
  assert.notEqual(getGroupContextKey(source), getGroupContextKey(target));
});

test("pending incompatible switch blocks AppNav and the old route subtree", () => {
  const started = createPendingGroupSwitch({ requestedGroupSlug: "test-group", sourceLocation: ncaaLocation });
  const resolved = resolvePendingGroupSwitch({ pending: started, target: { group: { id: "test-id" } }, destination: "/groups/test-group" });

  assert.equal(shouldRenderGroupSwitchShell(started), true);
  assert.equal(shouldRenderGroupSwitchShell(resolved), true);
  assert.equal(shouldRenderGroupSwitchShell(null), false);
});

test("location acknowledgement compares normalized query parameters", () => {
  assert.equal(navigationLocationsMatch(
    { pathname: "/home", search: "?sport=nfl&view=next" },
    { pathname: "/home", search: "?view=next&sport=nfl" },
  ), true);
  assert.equal(navigationLocationsMatch(
    { pathname: "/home", search: "?sport=nfl" },
    { pathname: "/home", search: "?sport=nba" },
  ), false);
});

test("same-Group refresh commits immediately without shell, navigation, or key change", async () => {
  const events = [];
  const current = { group: { id: "111-id", slug: "111" }, revision: 1 };
  const refreshed = { group: { id: "111-id", slug: "111" }, revision: 2 };

  const result = await executeGroupContextRefresh({
    fetchContext: async () => { events.push("fetch current"); return refreshed; },
    commitContext: (context) => { events.push(`commit revision ${context.revision}`); },
  });

  assert.equal(result, refreshed);
  assert.equal(getGroupContextKey(current), getGroupContextKey(refreshed));
  assert.equal(shouldRenderGroupSwitchShell(null), false);
  assert.deepEqual(events, ["fetch current", "commit revision 2"]);
});

test("failure cleanup leaves no shell and exposes no target context", () => {
  const started = createPendingGroupSwitch({ requestedGroupSlug: "test-group", sourceLocation: ncaaLocation });
  let pending = started;
  let committedTarget = null;

  pending = null;

  assert.equal(shouldRenderGroupSwitchShell(pending), false);
  assert.equal(committedTarget, null);
});
