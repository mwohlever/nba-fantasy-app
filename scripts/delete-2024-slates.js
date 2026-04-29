const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    process.env[key] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: slates } = await supabase
    .from("slates")
    .select("id, start_date")
    .gte("start_date", "2024-01-01")
    .lte("start_date", "2024-12-31");

  console.log("Deleting:", slates);

  for (const slate of slates || []) {
    await supabase.from("player_slate_stats").delete().eq("slate_id", slate.id);
    await supabase.from("team_slate_results").delete().eq("slate_id", slate.id);
    await supabase.from("slate_teams").delete().eq("slate_id", slate.id);

    const { data: lineups } = await supabase
      .from("lineups")
      .select("id")
      .eq("slate_id", slate.id);

    for (const lineup of lineups || []) {
      await supabase.from("lineup_players").delete().eq("lineup_id", lineup.id);
    }

    await supabase.from("lineups").delete().eq("slate_id", slate.id);
    await supabase.from("slates").delete().eq("id", slate.id);
  }

  console.log("✅ Deleted 2024 slates");
}

run();
