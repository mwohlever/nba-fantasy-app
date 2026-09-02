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

const { avatarStoragePathFromPublicUrl, findAvatarByHash, findOwnedAvatar, splitAvatarRetention } = require("../lib/profile/avatarLibrary.ts");

function record(id, userId, hash, day) {
  return { id, user_id: userId, storage_path: `${userId}/${id}.jpg`, content_sha256: hash, mime_type: "image/jpeg", created_at: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z` };
}

test("six unique uploads retain the five newest and evict only the oldest", () => {
  const records = [1, 2, 3, 4, 5, 6].map((day) => record(`avatar-${day}`, "user-1", String(day).repeat(64), day));
  const result = splitAvatarRetention(records);
  assert.deepEqual(result.retained.map((item) => item.id), ["avatar-6", "avatar-5", "avatar-4", "avatar-3", "avatar-2"]);
  assert.deepEqual(result.evicted.map((item) => item.id), ["avatar-1"]);
});

test("retention never evicts the active object while recovering from a cleanup failure", () => {
  const records = [1, 2, 3, 4, 5, 6].map((day) => record(`avatar-${day}`, "user-1", String(day).repeat(64), day));
  const result = splitAvatarRetention(records, 5, "user-1/avatar-1.jpg");
  assert.ok(result.retained.some((item) => item.id === "avatar-1"));
  assert.ok(!result.evicted.some((item) => item.id === "avatar-1"));
  assert.equal(result.retained.length, 5);
});

test("duplicate bytes reuse the existing upload without changing chronology", () => {
  const records = [record("older", "user-1", "a".repeat(64), 1), record("newer", "user-1", "b".repeat(64), 2)];
  assert.equal(findAvatarByHash(records, "a".repeat(64)).id, "older");
  assert.deepEqual(splitAvatarRetention(records).retained.map((item) => item.id), ["newer", "older"]);
});

test("retained-avatar ownership rejects another user's record", () => {
  const records = [record("mine", "user-1", "a".repeat(64), 1), record("theirs", "user-2", "b".repeat(64), 2)];
  assert.equal(findOwnedAvatar(records, "mine", "user-1").id, "mine");
  assert.equal(findOwnedAvatar(records, "theirs", "user-1"), null);
});

test("public URLs resolve only inside the authenticated user's bucket folder", () => {
  const own = "https://example.supabase.co/storage/v1/object/public/profile-images/user-1/avatar.jpg?v=1";
  const other = "https://example.supabase.co/storage/v1/object/public/profile-images/user-2/avatar.jpg?v=1";
  assert.equal(avatarStoragePathFromPublicUrl(own, "user-1"), "user-1/avatar.jpg");
  assert.equal(avatarStoragePathFromPublicUrl(other, "user-1"), null);
  assert.equal(avatarStoragePathFromPublicUrl("not a URL", "user-1"), null);
});

test("clearing the canonical avatar leaves retained history unchanged", () => {
  const records = [record("one", "user-1", "a".repeat(64), 1)];
  assert.deepEqual(splitAvatarRetention(records).retained, records);
});
