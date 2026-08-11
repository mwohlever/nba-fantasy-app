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
      "player_golf_season_stats",
    )
    .select(
      `
      player_name,
      tournaments_played,
      cuts_made,
      cuts_made_pct,
      wins,
      top_5_finishes,
      top_10_finishes,
      scoring_average,
      birdies_per_round,
      birdie_rate,
      bogey_rate,
      greens_in_reg_pct,
      driving_accuracy_pct,
      driving_distance,
      putts_per_gir
    `,
    )
    .eq(
      "season",
      2026,
    )
    .order(
      "scoring_average",
      {
        ascending:
          true,
      },
    );

if (error) {
  throw error;
}

console.table(
  data,
);
