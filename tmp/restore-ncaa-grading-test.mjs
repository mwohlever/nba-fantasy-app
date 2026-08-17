import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  const raw = fs.readFileSync(path, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index < 1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(".env.local");

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL;

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "Could not find Supabase URL/service-role key in .env.local",
  );
}

const snapshotPath =
  "tmp/ncaa-grading-test-snapshot.json";

if (!fs.existsSync(snapshotPath)) {
  throw new Error(
    `${snapshotPath} does not exist. No database changes made.`,
  );
}

const snapshot =
  JSON.parse(
    fs.readFileSync(
      snapshotPath,
      "utf8",
    ),
  );

if (
  !snapshot.game ||
  !Array.isArray(snapshot.picks)
) {
  throw new Error(
    "Snapshot is missing the expected game/picks data. No database changes made.",
  );
}

const supabase =
  createClient(
    url,
    serviceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

const {
  id: gameId,
  ...gameRestore
} = snapshot.game;

const {
  error: gameError,
} =
  await supabase
    .from("ncaa_pickem_games")
    .update(gameRestore)
    .eq("id", gameId);

if (gameError) {
  throw new Error(
    `Game restore failed: ${gameError.message}`,
  );
}

for (const savedPick of snapshot.picks) {
  const {
    id: pickId,
    ...pickRestore
  } = savedPick;

  const {
    error: pickError,
  } =
    await supabase
      .from("ncaa_pickem_picks")
      .update(pickRestore)
      .eq("id", pickId);

  if (pickError) {
    throw new Error(
      `Pick ${pickId} restore failed: ${pickError.message}`,
    );
  }
}

const {
  data: restoredGame,
  error: verifyGameError,
} =
  await supabase
    .from("ncaa_pickem_games")
    .select(
      "id, away_team_name, away_score, home_team_name, home_score, status, status_detail, winner_team_id, included",
    )
    .eq("id", gameId)
    .single();

if (verifyGameError) {
  throw new Error(
    `Game verification failed: ${verifyGameError.message}`,
  );
}

const {
  data: restoredPicks,
  error: verifyPicksError,
} =
  await supabase
    .from("ncaa_pickem_picks")
    .select(
      "id, team_id, picked_team_id, is_correct",
    )
    .eq(
      "game_id",
      gameId,
    )
    .order(
      "team_id",
    );

if (verifyPicksError) {
  throw new Error(
    `Pick verification failed: ${verifyPicksError.message}`,
  );
}

console.log("");
console.log("===============================================");
console.log("NCAA GRADING TEST RESTORED");
console.log("===============================================");
console.log("");
console.log("Game:");
console.table([restoredGame]);

console.log("");
console.log("Picks:");
console.table(restoredPicks ?? []);

console.log("");
console.log("✓ Fake LSU final removed");
console.log("✓ Pick grading restored to pre-test state");
console.log("✓ Safe to use the real ESPN NCAA refresh again");
