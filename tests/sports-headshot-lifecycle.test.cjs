const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

async function cacheModule() {
  return import("../scripts/lib/sportsHeadshotCache.js");
}

test("new NBA and NFL players can be persisted before headshot optimization", () => {
  const nbaSync = fs.readFileSync("app/api/sync-players/route.ts", "utf8");
  const nflSync = fs.readFileSync("app/api/sync-players-nfl/route.ts", "utf8");

  for (const source of [nbaSync, nflSync]) {
    assert.match(source, /insertedCount = insertedRows\?\.length \?\? 0/);
    assert.match(source, /after\(async \(\) =>/);
    assert.match(source, /cacheSportsHeadshots\(/);
  }

  assert.match(nbaSync, /\.select\("id, nba_player_id, headshot_url"\)/);
  assert.match(nflSync, /\.select\("id, nfl_player_id, headshot_url"\)/);
});

test("headshot cache skips existing assets and unsupported NFL synthetic defenses", async () => {
  const { cacheSportsHeadshots } = await cacheModule();
  const calls = [];
  const result = await cacheSportsHeadshots({
    client: {},
    sport: "nfl",
    players: [
      { id: 1, nfl_player_id: 123, headshot_url: "https://x/storage/v1/object/public/sports-headshots/nfl/123.webp?v=abc" },
      { id: 2, nfl_player_id: 100000001, headshot_url: null },
      { id: 3, nfl_player_id: 456, headshot_url: null },
    ],
    cacheOne: async ({ player }) => calls.push(player.id),
  });

  assert.deepEqual(result, { cached: 1, skipped: 2, failed: 0 });
  assert.deepEqual(calls, [3]);
});

test("successful optimization writes a versioned headshot URL only after upload", async () => {
  const { cacheSportsHeadshot } = await cacheModule();
  const events = [];
  const client = {
    storage: {
      from: () => ({
        upload: async () => {
          events.push("upload");
          return { error: null };
        },
        getPublicUrl: () => ({ data: { publicUrl: "https://storage.test/nba/7.webp" } }),
      }),
    },
    from: (table) => ({
      update: (value) => ({
        eq: async (column, id) => {
          events.push("update");
          assert.equal(table, "players");
          assert.equal(column, "id");
          assert.equal(id, 17);
          assert.match(value.headshot_url, /^https:\/\/storage\.test\/nba\/7\.webp\?v=[a-f0-9]{12}$/);
          return { error: null };
        },
      }),
    }),
  };

  await cacheSportsHeadshot({
    client,
    sport: "nba",
    player: { id: 17, nba_player_id: 7, headshot_url: null },
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from("source") }),
    optimizeImage: async () => Buffer.from("optimized-webp"),
  });

  assert.deepEqual(events, ["upload", "update"]);
});

test("an image failure is contained and leaves a discovered player uncached for provider fallback", async () => {
  const { cacheSportsHeadshots } = await cacheModule();
  const result = await cacheSportsHeadshots({
    client: {},
    sport: "nba",
    players: [{ id: 9, nba_player_id: 99, headshot_url: null }],
    cacheOne: async () => { throw new Error("provider unavailable"); },
  });

  assert.deepEqual(result, { cached: 0, skipped: 0, failed: 1 });
});

test("player headshot rendering has no page-render cache work and retains provider fallback", () => {
  const headshot = fs.readFileSync("components/ui/PlayerHeadshot.tsx", "utf8");
  assert.doesNotMatch(headshot, /sportsHeadshotCache/);
  assert.match(headshot, /getNbaProviderHeadshotUrl/);
  assert.match(headshot, /getNflProviderHeadshotUrl/);
  assert.match(headshot, /getGolfProviderHeadshotUrl/);
});
