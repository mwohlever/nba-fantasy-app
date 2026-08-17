import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8");

for (const line of env.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);

  if (!match) {
    continue;
  }

  const [, key, rawValue] = match;

  const value = rawValue
    .trim()
    .replace(/^['"]|['"]$/g, "");

  if (!process.env[key]) {
    process.env[key] = value;
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data, error } =
  await supabase
    .from("player_nba_season_averages")
    .select(`
      season,
      nba_player_id,
      player_name,
      games_played,
      points,
      rebounds,
      assists,
      steals,
      blocks,
      turnovers,
      fantasy_points
    `)
    .eq("season", "2025-26")
    .order("fantasy_points", {
      ascending: false,
    })
    .limit(15);

if (error) {
  throw error;
}

console.log(
  JSON.stringify(
    data,
    null,
    2,
  ),
);
