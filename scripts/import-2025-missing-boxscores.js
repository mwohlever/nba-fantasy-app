const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DATA_DIR = path.join(process.cwd(), "data", "2025-missing-boxscores");

const files = [
  "2025-05-01.csv",
  "2025-05-02.csv",
  "2025-05-04.csv",
  "2025-05-05.csv",
  "2025-05-06.csv",
  "2025-05-07.csv",
  "2025-05-08.csv",
];

const aliases = {
  "steph curry": "stephen curry",
  "alperun sengun": "alperen sengun",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '"' && quoted && n === '"') {
      value += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && n === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += c;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function fantasyPoints(row) {
  return Number(
    (
      row.points +
      row.rebounds * 1.2 +
      row.assists * 1.5 +
      row.steals * 2 +
      row.blocks * 2 -
      row.turnovers
    ).toFixed(1)
  );
}

function extractTeamLineups(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  const teams = [];
  let currentTeam = null;

  for (const row of rows) {
    const first = String(row[0] || "").trim();
    const second = String(row[1] || "").trim();

    if (first && !["Position", "G", "F/C", "Totals", "Date"].includes(first) && !second) {
      currentTeam = { teamName: first, players: [] };
      teams.push(currentTeam);
      continue;
    }

    if (!currentTeam) continue;
    if (!["G", "F/C"].includes(first)) continue;

    const playerName = second;
    if (!playerName || playerName === "—") continue;

    const stat = {
      playerName,
      points: toNumber(row[2]),
      rebounds: toNumber(row[3]),
      assists: toNumber(row[4]),
      steals: toNumber(row[5]),
      blocks: toNumber(row[6]),
      turnovers: toNumber(row[7]),
    };

    currentTeam.players.push({
      ...stat,
      fantasy_points: fantasyPoints(stat),
    });
  }

  return teams;
}

async function main() {
  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase.from("players").select("id, name"),
    supabase.from("teams").select("id, name"),
  ]);

  const playerMap = new Map();
  for (const player of players || []) {
    playerMap.set(normalizeName(player.name), player);
  }

  for (const [alias, real] of Object.entries(aliases)) {
    const realPlayer = playerMap.get(normalizeName(real));
    if (realPlayer) playerMap.set(normalizeName(alias), realPlayer);
  }

  const teamMap = new Map();
  for (const team of teams || []) {
    teamMap.set(normalizeName(team.name), team);
  }

  const unmatched = [];
  let totalLineups = 0;
  let totalLineupPlayers = 0;
  let totalStats = 0;

  for (const fileName of files) {
    const date = fileName.replace(".csv", "");
    const filePath = path.join(DATA_DIR, fileName);

    const { data: slate } = await supabase
      .from("slates")
      .select("id, start_date")
      .eq("start_date", date)
      .single();

    if (!slate) {
      console.warn(`⚠️ No slate found for ${date}`);
      continue;
    }

    const parsedTeams = extractTeamLineups(filePath);

    for (const teamBlock of parsedTeams) {
      const team = teamMap.get(normalizeName(teamBlock.teamName));
      if (!team) {
        unmatched.push(`${date}: team ${teamBlock.teamName}`);
        continue;
      }

      let lineup = null;

      const { data: existingLineup, error: existingLineupError } = await supabase
        .from("lineups")
        .select("id")
        .eq("slate_id", slate.id)
        .eq("team_id", team.id)
        .maybeSingle();

      if (existingLineupError) throw existingLineupError;

      if (existingLineup) {
        lineup = existingLineup;
      } else {
        const { data: insertedLineup, error: insertLineupError } = await supabase
          .from("lineups")
          .insert({
            slate_id: slate.id,
            team_id: team.id,
          })
          .select("id")
          .single();

        if (insertLineupError) throw insertLineupError;

        lineup = insertedLineup;
      }

      totalLineups++;

      for (const p of teamBlock.players) {
        const player = playerMap.get(normalizeName(p.playerName));

        if (!player) {
          unmatched.push(`${date}: player ${p.playerName}`);
          continue;
        }

        const { data: existingLineupPlayer, error: existingLpError } = await supabase
          .from("lineup_players")
          .select("lineup_id, player_id")
          .eq("lineup_id", lineup.id)
          .eq("player_id", player.id)
          .maybeSingle();

        if (existingLpError) throw existingLpError;

        if (!existingLineupPlayer) {
          const { error: insertLpError } = await supabase
            .from("lineup_players")
            .insert({
              lineup_id: lineup.id,
              player_id: player.id,
            });

          if (insertLpError) throw insertLpError;
        }

        const { error: statError } = await supabase
          .from("player_slate_stats")
          .upsert(
            {
              slate_id: slate.id,
              player_id: player.id,
              points: p.points,
              rebounds: p.rebounds,
              assists: p.assists,
              steals: p.steals,
              blocks: p.blocks,
              turnovers: p.turnovers,
              fantasy_points: p.fantasy_points,
            },
            { onConflict: "slate_id,player_id" }
          );

        if (statError) throw statError;

        totalLineupPlayers++;
        totalStats++;
      }
    }

    console.log(`✅ ${date}: imported ${parsedTeams.length} team lineups`);
  }

  if (unmatched.length > 0) {
    console.error("\n❌ Unmatched:");
    unmatched.forEach((x) => console.error(`- ${x}`));
    process.exit(1);
  }

  console.log(`\n🎉 Done.`);
  console.log(`Lineups upserted: ${totalLineups}`);
  console.log(`Lineup players upserted: ${totalLineupPlayers}`);
  console.log(`Player stats upserted: ${totalStats}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
