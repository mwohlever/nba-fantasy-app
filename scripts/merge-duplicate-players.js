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

// keepId = canonical/current player
// removeId = duplicate historical/imported player to merge into keepId
const MERGES = [
  { keepId: 135, removeId: 608, name: "Donte DiVincenzo" },
  { keepId: 282, removeId: 609, name: "Derrick Jones Jr." },
  { keepId: 347, removeId: 603, name: "T.J. McConnell" },
  { keepId: 421, removeId: 610, name: "Michael Porter Jr." },
  { keepId: 499, removeId: 600, name: "Jabari Smith Jr." },
  { keepId: 554, removeId: 605, name: "P.J. Washington" },
];

async function run() {
  for (const merge of MERGES) {
    console.log(`\nMerging ${merge.removeId} into ${merge.keepId}: ${merge.name}`);

    // Update lineup_players
    const { error: lpError } = await supabase
      .from("lineup_players")
      .update({ player_id: merge.keepId })
      .eq("player_id", merge.removeId);

    if (lpError) {
      console.error("❌ lineup_players error:", lpError.message);
      continue;
    }

    // Handle player_slate_stats carefully:
    // If target stat already exists for same slate/player, delete duplicate stat.
    const { data: duplicateStats, error: dupStatsError } = await supabase
      .from("player_slate_stats")
      .select("*")
      .eq("player_id", merge.removeId);

    if (dupStatsError) {
      console.error("❌ duplicate stat lookup error:", dupStatsError.message);
      continue;
    }

    for (const stat of duplicateStats ?? []) {
      const { data: existingTargetStat } = await supabase
        .from("player_slate_stats")
        .select("slate_id, player_id")
        .eq("slate_id", stat.slate_id)
        .eq("player_id", merge.keepId)
        .maybeSingle();

      if (existingTargetStat) {
        await supabase
          .from("player_slate_stats")
          .delete()
          .eq("slate_id", stat.slate_id)
          .eq("player_id", merge.removeId);
      } else {
        await supabase
          .from("player_slate_stats")
          .update({ player_id: merge.keepId })
          .eq("slate_id", stat.slate_id)
          .eq("player_id", merge.removeId);
      }
    }

    // Delete duplicate player row
    const { error: deleteError } = await supabase
      .from("players")
      .delete()
      .eq("id", merge.removeId);

    if (deleteError) {
      console.error("❌ delete player error:", deleteError.message);
      continue;
    }

    console.log("✅ merged");
  }

  console.log("\nDone.");
}

run();
