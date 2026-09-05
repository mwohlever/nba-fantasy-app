/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};

const {
  getCreateSlateHref,
  resolveCreateSlateSport,
} = require("../lib/slates/createSlateSport.ts");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Create Slate sport URLs resolve deterministically across reloads", () => {
  for (const sport of ["nba", "nfl", "golf"]) {
    const href = getCreateSlateHref(sport);
    const url = new URL(href, "https://www.111sports.app");
    assert.equal(resolveCreateSlateSport(url.searchParams.get("sport")), sport);
  }
  assert.equal(resolveCreateSlateSport(null), "nba");
  assert.equal(resolveCreateSlateSport("unsupported"), "nba");
});

test("Create Slate page is URL-authoritative and has no visible sport selector", () => {
  const page = source("app/slates/new/page.tsx");
  assert.match(page, /resolveCreateSlateSport\(requestedSport\)/);
  assert.match(page, /router\.replace\(getCreateSlateHref\(sport\)\)/);
  assert.doesNotMatch(page, /setSport/);
  assert.doesNotMatch(page, />\s*Sport\s*</);
  assert.doesNotMatch(page, /\(\["nba", "nfl", "golf"\] as const\)\.map/);
});

test("Commissioner entry and slate submission preserve the resolved sport", () => {
  const admin = source("app/admin/page.tsx");
  const page = source("app/slates/new/page.tsx");
  assert.match(admin, /getCreateSlateHref\(selectedSport\)/);
  assert.match(page, /body:\s*JSON\.stringify\(\{[\s\S]*?sport,/);
  assert.match(page, /`\/api\/slates\?sport=\$\{encodeURIComponent\(targetSport\)\}`/);
});
