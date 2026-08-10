import fs from "fs";
import {
  createClient,
} from "@supabase/supabase-js";

const env =
  fs.readFileSync(
    ".env.local",
    "utf8",
  );

for (
  const line
  of env.split("\n")
) {
  const match =
    line.match(
      /^([^#=]+)=(.*)$/,
    );

  if (!match) {
    continue;
  }

  const [
    ,
    key,
    rawValue,
  ] = match;

  if (
    !process.env[key]
  ) {
    process.env[key] =
      rawValue
        .trim()
        .replace(
          /^['"]|['"]$/g,
          "",
        );
  }
}

const supabase =
  createClient(
    process.env
      .NEXT_PUBLIC_SUPABASE_URL,
    process.env
      .SUPABASE_SERVICE_ROLE_KEY,
  );

const {
  data,
  error,
} =
  await supabase
    .from(
      "player_nfl_season_stats",
    )
    .select(
      `
      player_name,
      position,
      games_played,
      fantasy_points_per_game,
      passing_yards_per_game,
      passing_tds_per_game,
      passing_ints_per_game,
      rushing_yards_per_game,
      rushing_tds_per_game,
      receiving_targets_per_game,
      receptions_per_game,
      receiving_yards_per_game,
      receiving_tds_per_game,
      fumbles_lost_per_game
    `,
    )
    .eq(
      "season",
      2025,
    )
    .order(
      "player_name",
    );

if (error) {
  throw error;
}

console.table(
  data,
);
