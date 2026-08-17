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

const supabase = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const { data: week, error: weekError } = await supabase
  .from("ncaa_pickem_weeks")
  .select("id, season, week_number, status")
  .eq("season", 2026)
  .eq("week_number", 1)
  .single();

if (weekError || !week) {
  throw new Error(
    `Week 1 not found: ${weekError?.message ?? "unknown error"}`,
  );
}

const { data: games, error: gamesError } = await supabase
  .from("ncaa_pickem_games")
  .select(
    "id, week_id, away_team_id, away_team_name, away_score, home_team_id, home_team_name, home_score, status, status_detail, winner_team_id, included, updated_at",
  )
  .eq("week_id", week.id)
  .eq("included", true);

if (gamesError) {
  throw new Error(gamesError.message);
}

const game = (games ?? []).find((row) => {
  const names =
    `${row.away_team_name} ${row.home_team_name}`.toLowerCase();

  return names.includes("lsu") && names.includes("clemson");
});

if (!game) {
  throw new Error(
    "Could not find the included Clemson-LSU Week 1 game.",
  );
}

const lsuIsAway =
  String(game.away_team_name).toLowerCase().includes("lsu");

const lsuTeamId = String(
  lsuIsAway
    ? game.away_team_id
    : game.home_team_id,
);

const { data: picks, error: picksError } = await supabase
  .from("ncaa_pickem_picks")
  .select(
    "id, week_id, game_id, team_id, picked_team_id, is_correct, updated_at",
  )
  .eq("week_id", week.id)
  .eq("game_id", game.id);

if (picksError) {
  throw new Error(picksError.message);
}

const snapshot = {
  createdAt: new Date().toISOString(),
  week,
  game,
  picks: picks ?? [],
};

fs.writeFileSync(
  "tmp/ncaa-grading-test-snapshot.json",
  JSON.stringify(snapshot, null, 2),
);

const fakeAwayScore =
  lsuIsAway ? 31 : 24;

const fakeHomeScore =
  lsuIsAway ? 24 : 31;

const { error: gameUpdateError } = await supabase
  .from("ncaa_pickem_games")
  .update({
    away_score: fakeAwayScore,
    home_score: fakeHomeScore,
    status: "post",
    status_detail: "Final",
    winner_team_id: lsuTeamId,
    updated_at: new Date().toISOString(),
  })
  .eq("id", game.id);

if (gameUpdateError) {
  throw new Error(gameUpdateError.message);
}

for (const pick of picks ?? []) {
  const isCorrect =
    String(pick.picked_team_id) === lsuTeamId;

  const { error } = await supabase
    .from("ncaa_pickem_picks")
    .update({
      is_correct: isCorrect,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pick.id);

  if (error) {
    throw new Error(error.message);
  }
}

const { data: graded, error: gradedError } = await supabase
  .from("ncaa_pickem_picks")
  .select(
    "id, team_id, picked_team_id, is_correct",
  )
  .eq("week_id", week.id)
  .eq("game_id", game.id)
  .order("team_id");

if (gradedError) {
  throw new Error(gradedError.message);
}

console.log("");
console.log("===============================================");
console.log("NCAA GRADING TEST ACTIVE");
console.log("===============================================");
console.log(`Game: ${game.away_team_name} at ${game.home_team_name}`);
console.log(`Fake winner: LSU (${lsuTeamId})`);
console.log(`Fake score: ${fakeAwayScore}-${fakeHomeScore}`);
console.log(`Saved picks found: ${(picks ?? []).length}`);
console.log("");
console.table(graded ?? []);
console.log("");
console.log("Snapshot saved:");
console.log("  tmp/ncaa-grading-test-snapshot.json");
console.log("");
console.log("DO NOT run the real NCAA ESPN refresh until after restore.");
console.log("Now inspect:");
console.log("  NCAA Pick 'Em -> Standings");
console.log("  Profile -> NCAA Pick 'Em -> Overview");
console.log("  Profile -> NCAA Pick 'Em -> Trophy Case");
