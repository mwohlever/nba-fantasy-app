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
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
require.extensions[".ts"] = function (module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};
let entrant;
let writes;
const db = {
  from: (table) => ({
    select: () => {
      const chain = { eq: () => chain, or: () => chain, maybeSingle: async () => ({ data: table === "bracket_entrants" ? entrant : { id: "master" }, error: null }) };
      return chain;
    },
    update: (patch) => {
      const chain = { eq: () => chain, select: () => {
        writes.push(patch);
        return { maybeSingle: async () => ({ data: { id: "master", name: patch.name }, error: null }) };
      } };
      return chain;
    },
  }),
};
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/supabaseAdmin") return { supabaseAdmin: db };
  return originalLoad.call(this, request, parent, isMain);
};
const { renameMasterBracket } = require("../lib/bracket/masterBracket.server.ts");
Module._load = originalLoad;

test("account and managed entrants can rename after lock and clear to fallback", async () => {
  for (const owned of [{ account_user_id: "user", managing_user_id: null }, { account_user_id: null, managing_user_id: "user" }]) {
    entrant = owned; writes = [];
    const named = await renameMasterBracket({ id: "user" }, { competitionId: 1, entrantId: "entrant", bracketNumber: 2, name: "  Chaos  " });
    assert.equal(named.name, "Chaos");
    const cleared = await renameMasterBracket({ id: "user" }, { competitionId: 1, entrantId: "entrant", bracketNumber: 2, name: " " });
    assert.equal(cleared.name, null);
    assert.equal(writes.length, 2);
  }
});

test("unauthorized entrant cannot rename", async () => {
  entrant = null; writes = [];
  await assert.rejects(renameMasterBracket({ id: "user" }, { competitionId: 1, entrantId: "other", bracketNumber: 1, name: "No" }), /cannot manage/);
  assert.equal(writes.length, 0);
});
