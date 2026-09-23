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

let currentUser;
let challenge;
let entrant;
let savedName;
let updates;
let picks;

const db = {
  from(table) {
    if (table === "bracket_entrants") return {
      select() {
        const filters = {};
        const chain = {
          eq(key, value) { filters[key] = value; return chain; },
          or(value) { filters.owner = value; return chain; },
          async maybeSingle() {
            const owned = entrant && filters.id === entrant.id && filters.is_active === true &&
              (entrant.account_user_id === currentUser?.id || entrant.managing_user_id === currentUser?.id);
            return { data: owned ? entrant : null, error: null };
          },
        };
        return chain;
      },
    };
    if (table === "bracket_master_brackets") return {
      update(patch) {
        const filters = {};
        const chain = {
          eq(key, value) { filters[key] = value; return chain; },
          select() { return chain; },
          async maybeSingle() {
            if (filters.competition_id !== 7 || filters.entrant_id !== entrant.id || filters.bracket_number !== 2) {
              return { data: null, error: null };
            }
            assert.deepEqual(Object.keys(patch).sort(), ["name", "updated_at"]);
            savedName = patch.name;
            updates++;
            return { data: { id: "master", name: savedName }, error: null };
          },
        };
        return chain;
      },
    };
    throw new Error(`Rename unexpectedly accessed ${table}`);
  },
};

Module._load = function (request, parent, isMain) {
  if (request === "next/server") return { NextResponse: { json: Response.json } };
  if (request === "@/lib/auth") return { getCurrentUser: async () => currentUser };
  if (request === "@/lib/bracket/challenge.server") return { getBracketChallengeDetail: async () => challenge };
  if (request === "@/lib/supabaseAdmin") return { supabaseAdmin: db };
  return originalLoad.call(this, request, parent, isMain);
};
const { PATCH } = require("../app/api/bracket-challenge/contests/[contestId]/master-bracket/route.ts");
Module._load = originalLoad;

function setup(kind) {
  currentUser = { id: "user" };
  challenge = { competition: { id: 7 }, contest: { maxBracketsPerEntrant: 3 } };
  entrant = { id: "entrant", entrant_kind: kind, is_active: true,
    account_user_id: kind === "account" ? "user" : null,
    managing_user_id: kind === "managed" ? "user" : null };
  savedName = null;
  updates = 0;
  picks = { semifinal: "team-a" };
}

async function rename(name) {
  const request = new Request("http://localhost/api/bracket-challenge/contests/contest/master-bracket", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "rename", entrantId: "entrant", bracketNumber: 2, name }),
  });
  const response = await PATCH(request, { params: Promise.resolve({ contestId: "contest" }) });
  return { status: response.status, body: await response.json() };
}

for (const kind of ["account", "managed"]) {
  test(`${kind} entrant rename uses the deployed PATCH payload without changing picks`, async () => {
    setup(kind);
    const before = structuredClone(picks);
    assert.deepEqual(await rename("  Chaos  "), { status: 200, body: { success: true, id: "master", name: "Chaos" } });
    assert.equal(savedName, "Chaos");
    assert.deepEqual(picks, before);
    assert.deepEqual(await rename("  "), { status: 200, body: { success: true, id: "master", name: null } });
    assert.equal(savedName, null);
    assert.equal(updates, 2);
  });
}

test("a different user cannot rename the entrant's bracket", async () => {
  setup("account");
  entrant.account_user_id = "someone-else";
  const result = await rename("Stolen");
  assert.equal(result.status, 400);
  assert.match(result.body.error, /cannot manage this entrant/i);
  assert.equal(updates, 0);
});

test("Group contest authorization runs before the rename update", async () => {
  setup("account");
  challenge = null;
  const result = await rename("Outside group");
  assert.equal(result.status, 404);
  assert.equal(updates, 0);
});
