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

// keepName = canonical player already in DB
// removeNames = messy imported names to merge into canonical
const MERGES = [
  {
    keepName: "Giannis Antetokounmpo",
    removeNames: ["Giannis Antetokoumpo", "Giannis Antetekoumpo"],
  },
  {
    keepName: "Alperen Sengun",
    removeNames: ["Alperun Sengun", "Alperin Senguin"],
  },
  {
    keepName: "Derrick Jones Jr.",
    removeNames: ["Derrik Jones Jr."],
  },
  {
    keepName: "Brandin Podziemski",
    removeNames: ["That Pod Guy"],
  },
  {
    keepName: "Ty Jerome",
    removeNames: ["Darius Garland/Ty Jerome"],
  },
  {
    keepName: "Jalen Duren",
    removeNames: ["Jalen Duran"],
  },
  {
    keepName: "Kristaps Porzingis",
    removeNames: ["Kristaps Porzingiz"],
  },
  {
    keepName: "Payton Pritchard",
    removeNames: ["Peyton Pritchard"],
  },
];

async function getPlayerByName(name) {
  const { data, error } = await supabase
    .from("players")
    .select("id, name, position_group")
    .eq("name", name)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createCanonicalIfMissing(name, positionGroup = "F/C") {
  let player = await getPlayerByName(name);
  if (player) return player;

  const { data, error } = await supabase
    .from("players")
    .insert({
      name,
      position_group: positionGroup,
      is_active: false,
      is_playing_today: false,
    })
    .select("id, name, position_group")
    .single();

  if (error) throw error;
  console.log(`➕ Created canonical player: ${name} (${data.id})`);
  return data;
}

async function mergePlayer(removePlayer, keepPlayer) {
  console.log(`\nMerging "${removePlayer.name}" (${removePlayer.id}) → "${keepPlayer.name}" (${keepPlayer.id})`);

  // Move lineup picks
  const { error: lpError } = await supabase
    .from("lineup_players")
    .update({ player_id: keepPlayer.id })
    .eq("player_id", removePlayer.id);

  if (lpError) throw lpError;

  // Move stats carefully.
  const { data: duplicateStats, error: dupStatsError } = await supabase
    .from("player_slate_stats")
    .select("*")
    .eq("player_id", removePlayer.id);

  if (dupStatsError) throw dupStatsError;

  for (const stat of duplicateStats ?? []) {
    const { data: existingTargetStat, error: existingError } = await supabase
      .from("player_slate_stats")
      .select("slate_id, player_id")
      .eq("slate_id", stat.slate_id)
      .eq("player_id", keepPlayer.id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingTargetStat) {
      // If same player already has a stat on that slate, avoid duplicate conflict.
      const { error } = await supabase
        .from("player_slate_stats")
        .delete()
        .eq("slate_id", stat.slate_id)
        .eq("player_id", removePlayer.id);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("player_slate_stats")
        .update({ player_id: keepPlayer.id })
        .eq("slate_id", stat.slate_id)
        .eq("player_id", removePlayer.id);

      if (error) throw error;
    }
  }

  const { error: deleteError } = await supabase
    .from("players")
    .delete()
    .eq("id", removePlayer.id);

  if (deleteError) throw deleteError;

  console.log("✅ merged");
}

async function run() {
  for (const group of MERGES) {
    let sampleRemove = null;

    for (const removeName of group.removeNames) {
      sampleRemove = sampleRemove || (await getPlayerByName(removeName));
    }

    const positionGroup = sampleRemove?.position_group ?? "F/C";
    const keepPlayer = await createCanonicalIfMissing(group.keepName, positionGroup);

    for (const removeName of group.removeNames) {
      const removePlayer = await getPlayerByName(removeName);

      if (!removePlayer) {
        console.log(`Skipping missing duplicate: ${removeName}`);
        continue;
      }

      if (removePlayer.id === keepPlayer.id) {
        console.log(`Skipping same player: ${removeName}`);
        continue;
      }

      await mergePlayer(removePlayer, keepPlayer);
    }
  }

  console.log("\n✅ Duplicate cleanup complete");
}

run().catch((error) => {
  console.error("❌ Merge failed:", error);
  process.exit(1);
});
