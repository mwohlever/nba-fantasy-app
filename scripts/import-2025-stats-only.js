const fs = require("fs");
const XLSX = require("xlsx");
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

const workbookPath = "imports/nba-playoff-fantasy.xlsx";
const TEAM_NAMES = new Set(["Andy", "Josh", "Jon", "Mark"]);

const NAME_ALIASES = {
  "djj": "Derrick Jones Jr.",
  "pj washington": "P.J. Washington",
  "tj mcconnell": "T.J. McConnell",
  "tj mcconnell cpa": "T.J. McConnell",
  "donte divincenzo": "Donte DiVincenzo",
  "michael porter jr": "Michael Porter Jr.",
  "jabari smith jr": "Jabari Smith Jr.",
  "steph curry": "Stephen Curry",
};

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalName(rawName) {
  const normalized = normalizeName(rawName);
  return NAME_ALIASES[normalized] || String(rawName || "").trim();
}

function parseSlateDate(name) {
  const clean = name.trim();
  const year = "2025";
  const md = clean.slice(0, -2);

  const month = md.length === 3 ? md.slice(0, 1) : md.slice(0, 2);
  const day = md.length === 3 ? md.slice(1) : md.slice(2);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizePosition(pos) {
  const clean = String(pos || "").trim().toUpperCase();
  if (clean === "G") return "G";
  return "F/C";
}

function fantasy(points, rebounds, assists, steals, blocks, turnovers) {
  return Number(
    (
      Number(points || 0) +
      Number(rebounds || 0) * 1.2 +
      Number(assists || 0) * 1.5 +
      Number(steals || 0) * 2 +
      Number(blocks || 0) * 2 -
      Number(turnovers || 0)
    ).toFixed(1)
  );
}

async function cleanupSlateStatsOnly(slateId) {
  await supabase.from("player_slate_stats").delete().eq("slate_id", slateId);
  await supabase.from("slate_teams").delete().eq("slate_id", slateId);

  const { data: lineups } = await supabase
    .from("lineups")
    .select("id")
    .eq("slate_id", slateId);

  for (const lineup of lineups || []) {
    await supabase.from("lineup_players").delete().eq("lineup_id", lineup.id);
  }

  await supabase.from("lineups").delete().eq("slate_id", slateId);

  // IMPORTANT:
  // Do NOT delete team_slate_results. 2025 standings already exist.
}

async function getOrCreatePlayer(rawName, positionGroup, playerMap) {
  const cleanName = canonicalName(rawName);
  const key = normalizeName(cleanName);

  if (playerMap.has(key)) return playerMap.get(key);

  const { data: inserted, error } = await supabase
    .from("players")
    .insert({
      name: cleanName,
      position_group: positionGroup,
      is_active: false,
      is_playing_today: false,
    })
    .select("id, name, position_group")
    .single();

  if (error) {
    console.log("❌ Could not create player:", cleanName, error.message);
    return null;
  }

  playerMap.set(key, inserted);
  console.log("➕ Created historical player:", cleanName);
  return inserted;
}

async function run() {
  const wb = XLSX.readFile(workbookPath);
  const tabs2025 = wb.SheetNames
    .filter((name) => /^\d{3,4}25$/.test(name.trim()))
    .sort();

  const { data: teams } = await supabase.from("teams").select("id, name");
  const teamMap = new Map((teams || []).map((team) => [team.name, team]));

  const { data: players } = await supabase
    .from("players")
    .select("id, name, position_group");

  const playerMap = new Map();
  (players || []).forEach((player) => {
    playerMap.set(normalizeName(player.name), player);
  });

  console.log("Importing 2025 stat tabs:", tabs2025);

  for (const sheetName of tabs2025) {
    const date = parseSlateDate(sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    console.log(`\n--- Importing ${sheetName} -> ${date}`);

    let { data: slate, error: existingSlateError } = await supabase
      .from("slates")
      .select("id, date, start_date, end_date")
      .eq("start_date", date)
      .eq("end_date", date)
      .maybeSingle();

    if (existingSlateError) {
      console.log("❌ Slate lookup failed:", date, existingSlateError.message);
      continue;
    }

    if (!slate) {
      const inserted = await supabase
        .from("slates")
        .insert({
          date,
          start_date: date,
          end_date: date,
          is_locked: true,
          sms_enabled: false,
          nba_team_abbreviations: [],
          first_game_start_time: null,
        })
        .select("id, date, start_date, end_date")
        .single();

      if (inserted.error || !inserted.data) {
        console.log("❌ Failed creating missing slate:", date, inserted.error?.message);
        continue;
      }

      slate = inserted.data;
      console.log("Created missing slate:", slate.id);
    } else {
      console.log("Using existing slate:", slate.id);
    }

    await cleanupSlateStatsOnly(slate.id);

    const slateTeamRows = [];
    let draftOrder = 1;

    for (let i = 0; i < rows.length; i++) {
      const teamName = String(rows[i]?.[0] || "").trim();

      if (!TEAM_NAMES.has(teamName)) continue;
      if (String(rows[i + 1]?.[0] || "").trim() !== "Position") continue;

      const team = teamMap.get(teamName);
      if (!team) {
        console.log("⚠️ Missing team:", teamName);
        continue;
      }

      const { data: lineup, error: lineupError } = await supabase
        .from("lineups")
        .insert({ slate_id: slate.id, team_id: team.id })
        .select("id")
        .single();

      if (lineupError || !lineup) {
        console.log("❌ Failed creating lineup:", teamName, lineupError?.message);
        continue;
      }

      slateTeamRows.push({
        slate_id: slate.id,
        team_id: team.id,
        draft_order: draftOrder++,
        is_participating: true,
      });

      let added = 0;

      for (let r = i + 2; r < rows.length; r++) {
        const row = rows[r];
        const playerName = String(row?.[1] || "").trim();

        if (!playerName || playerName === "Totals") break;
        if (playerName === "Player") continue;
        if (added >= 5) break;

        const positionGroup = normalizePosition(row[0]);
        const player = await getOrCreatePlayer(playerName, positionGroup, playerMap);
        if (!player) continue;

        const points = Number(row[2] || 0);
        const rebounds = Number(row[3] || 0);
        const assists = Number(row[4] || 0);
        const steals = Number(row[5] || 0);
        const blocks = Number(row[6] || 0);
        const turnovers = Number(row[7] || 0);
        const fp = fantasy(points, rebounds, assists, steals, blocks, turnovers);

        await supabase.from("lineup_players").insert({
          lineup_id: lineup.id,
          player_id: player.id,
        });

        await supabase.from("player_slate_stats").upsert(
          {
            slate_id: slate.id,
            player_id: player.id,
            points,
            rebounds,
            assists,
            steals,
            blocks,
            turnovers,
            fantasy_points: fp,
          },
          { onConflict: "slate_id,player_id" }
        );

        added++;
      }

      console.log(`${teamName}: ${added} players`);
    }

    if (slateTeamRows.length > 0) {
      await supabase.from("slate_teams").insert(slateTeamRows);
    }

    console.log(`✅ Imported stats for slate ${slate.id}`);
  }

  console.log("\n✅ 2025 stats-only import complete");
}

run();
