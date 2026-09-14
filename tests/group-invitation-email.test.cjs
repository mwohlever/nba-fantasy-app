/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function load(file, mocks = {}, context = {}) {
  const module = { exports: {} };

  vm.runInNewContext(
    ts.transpileModule(source(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      console,
      URL,
      Request,
      process: { env: {} },
      ...context,
      require(id) {
        if (id in mocks) return mocks[id];
        throw new Error(`Unexpected import: ${id}`);
      },
    },
  );

  return module.exports;
}

test("group invitation email reports unconfigured delivery without attempting a provider request", async () => {
  let requested = false;
  const email = load(
    "lib/email/groupInvitation.ts",
    {},
    {
      fetch: async () => {
        requested = true;
        return { ok: true };
      },
    },
  );

  const result = await email.sendGroupInvitationEmail({
    to: "player@example.com",
    groupName: "Test Group",
    inviteUrl: "https://www.111sports.app/invite/token",
    expiresAt: "2026-09-21T00:00:00.000Z",
  });

  assert.equal(result.status, "not_configured");
  assert.equal(requested, false);
});

test("group invitation email sends the generated invitation URL through Resend", async () => {
  let request;
  const email = load(
    "lib/email/groupInvitation.ts",
    {},
    {
      process: {
        env: {
          RESEND_API_KEY: "test-key",
          RESEND_FROM_EMAIL: "111 Sports <invites@example.com>",
        },
      },
      fetch: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200 };
      },
    },
  );

  const result = await email.sendGroupInvitationEmail({
    to: "player@example.com",
    groupName: "Test Group",
    inviteUrl: "https://www.111sports.app/invite/token",
    expiresAt: "2026-09-21T00:00:00.000Z",
  });

  assert.equal(result.status, "sent");
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ["player@example.com"]);
  assert.match(body.text, /https:\/\/www\.111sports\.app\/invite\/token/);
  assert.match(body.html, /https:\/\/www\.111sports\.app\/invite\/token/);
});

test("group invitation email distinguishes a Resend rejection from invite persistence", async () => {
  const email = load(
    "lib/email/groupInvitation.ts",
    {},
    {
      process: {
        env: {
          RESEND_API_KEY: "test-key",
          RESEND_FROM_EMAIL: "111 Sports <invites@example.com>",
        },
      },
      fetch: async () => ({ ok: false, status: 403 }),
    },
  );

  const result = await email.sendGroupInvitationEmail({
    to: "player@example.com",
    groupName: "Test Group",
    inviteUrl: "https://www.111sports.app/invite/token",
    expiresAt: "2026-09-21T00:00:00.000Z",
  });

  assert.equal(result.status, "failed");
});

test("invite creation returns the email delivery result and preserves the copyable URL", () => {
  const route = source("app/api/admin/groups/route.ts");
  const page = source("app/admin/groups/page.tsx");

  assert.match(route, /await sendGroupInvitationEmail\(/);
  assert.match(route, /emailDelivery,/);
  assert.match(route, /inviteUrl,/);
  assert.match(page, /Invitation sent to/);
  assert.match(page, /Invitation created, but the email could not be sent/);
  assert.match(page, /email delivery is not configured/);
});

test("invite signup represents confirmation as pending and supports a cooldown-protected resend", () => {
  const page = source("app/invite/[token]/page.tsx");

  assert.match(page, /\.auth\s*\.resend\(/);
  assert.match(page, /type:\s*"signup"/);
  assert.match(page, /emailRedirectTo:\s*confirmationRedirectUrl\(\)/);
  assert.match(page, /Supabase did not return an account to confirm/);
  assert.match(page, /Resend available in/);
  assert.match(page, /Resend confirmation email/);
});
