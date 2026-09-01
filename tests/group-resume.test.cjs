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
  createAppResumeRecord,
  parseAppResumeRecord,
  resolveAppResumeDestination,
} = require("../lib/groups/resume.ts");

const context = {
  groupSlug: "111",
  enabledSports: ["nba", "golf", "ncaa"],
  canAdministerGroup: false,
};

test("reusable sport and Group Home destinations are remembered", () => {
  assert.deepEqual(createAppResumeRecord("/standings?sport=nba", context), {
    version: 1,
    groupSlug: "111",
    destination: "/standings?sport=nba",
  });
  assert.deepEqual(createAppResumeRecord("/groups/111", context), {
    version: 1,
    groupSlug: "111",
    destination: "/groups/111",
  });
});

test("platform, stale sport, unknown, and resource destinations are not remembered", () => {
  assert.equal(createAppResumeRecord("/", context), null);
  assert.equal(createAppResumeRecord("/home?sport=nfl", context), null);
  assert.equal(createAppResumeRecord("/something-new", context), null);
  assert.equal(
    createAppResumeRecord("/lineups/scores?sport=nba&slateId=167", context),
    null,
  );
});

test("resume validates the saved Group and current enabled games", () => {
  const saved = {
    version: 1,
    groupSlug: "111",
    destination: "/ncaa-pickem/standings",
  };
  assert.equal(resolveAppResumeDestination(saved, context), "/ncaa-pickem/standings");
  assert.equal(
    resolveAppResumeDestination(saved, { ...context, enabledSports: ["nba"] }),
    "/groups/111",
  );
  assert.equal(
    resolveAppResumeDestination(saved, { ...context, groupSlug: "test-group" }),
    "/groups/test-group",
  );
});

test("stored values reject malformed and external destinations", () => {
  assert.equal(parseAppResumeRecord("not-json"), null);
  assert.equal(
    parseAppResumeRecord(JSON.stringify({
      version: 1,
      groupSlug: "111",
      destination: "https://example.com",
    })),
    null,
  );
});
