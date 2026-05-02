const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const season = process.argv[2];
if (!season) {
  console.error("Usage: node scripts/import-nba-season-averages.js 2025-26");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const filePath = `data/nba-season-averages/${season}.csv`;
const text = fs.readFileSync(filePath, "utf8");

const rows = text.split("\n").slice(1).filter(Boolean);

function parseRow(row) {
  const parts = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  return {
    nba_player_id: Number(parts[0]),
    player_name: parts[1].replace(/^"|"$/g, ""),
    pts: Number(parts[2]),
    reb: Number(parts[3]),
    ast: Number(parts[4]),
    stl: Number(parts[5]),
    blk: Number(parts[6]),
    tov: Number(parts[7]),
  };
}

(async () => {
  const data = rows.map(parseRow).map(p => ({
    season,
    nba_player_id: p.nba_player_id,
    player_name: p.player_name,
    fantasy_points:
      p.pts +
      (p.reb * 1.2) +
      (p.ast * 1.5) +
      (p.stl * 2) +
      (p.blk * 2) -
      p.tov
  }));

  const { error } = await supabase
    .from("player_nba_season_averages")
    .upsert(data, { onConflict: "season,nba_player_id" });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log("✅ Imported", data.length, "players for", season);
})();
