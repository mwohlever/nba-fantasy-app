/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin slate detail GET uses one target-scoped commissioner authorization", () => {
  const route = source("app/api/admin/slates/[slateId]/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));

  assert.match(get, /authorizeSlateResource\(\s*request,\s*slateId,\s*\{ requireCommissioner: true \}/);
  assert.match(get, /authorization\.target\.groupId/);
  assert.doesNotMatch(get, /requireAdminApi|getCurrentUser|getActiveSlateAccessForUser/);
});

test("Slate Manager invalidates prior detail and ShotCast requests on selection changes", () => {
  const page = source("app/admin/slates/page.tsx");

  assert.match(page, /const detailRequestRef = useRef\(0\)/);
  assert.match(page, /const shotCastRequestRef = useRef\(0\)/);
  assert.match(page, /const requestId = \+\+detailRequestRef\.current/);
  assert.match(page, /setSelectedSlate\(null\);[\s\S]*?setTeams\(\[\]\);[\s\S]*?setGolfField\(null\);/);
  assert.match(page, /if \(requestId !== detailRequestRef\.current\) return;/);
  assert.match(page, /detailRequestId !== detailRequestRef\.current[\s\S]*?requestId !== shotCastRequestRef\.current/);
});
