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

function yearFromDate(date) {
  return String(date || "").slice(0, 4);
}

async function run() {
  const { data: slates } = await supabase
    .from("slates")
    .select("id, start_date, date")
    .order("start_date", { ascending: true });

  const { data: lineups } = await supabase
    .from("lineups")
    .select("id, slate_id");

  const { data: lineupPlayers } = await supabase
    .from("lineup_players")
    .select("lineup_id, player_id");

  const { data: stats } = await supabase
    .from("player_slate_stats")
    .select("slate_id, player_id");

  const lineupSlateMap = new Map((lineups ?? []).map((l) => [l.id, l.slate_id]));

  const byYear = {};

  for (const slate of slates ?? []) {
    const year = yearFromDate(slate.start_date ?? slate.date);
    byYear[year] ??= {
      slates: new Set(),
      lineups: 0,
      lineupPlayers: 0,
      playerStats: 0,
    };
    byYear[year].slates.add(slate.id);
  }

  for (const lineup of lineups ?? []) {
    const slate = (slates ?? []).find((s) => s.id === lineup.slate_id);
    const year = yearFromDate(slate?.start_date ?? slate?.date);
    if (!year) continue;
    byYear[year] ??= { slates: new Set(), lineups: 0, lineupPlayers: 0, playerStats: 0 };
    byYear[year].lineups += 1;
  }

  for (const lp of lineupPlayers ?? []) {
    const slateId = lineupSlateMap.get(lp.lineup_id);
    const slate = (slates ?? []).find((s) => s.id === slateId);
    const year = yearFromDate(slate?.start_date ?? slate?.date);
    if (!year) continue;
    byYear[year].lineupPlayers += 1;
  }

  for (const stat of stats ?? []) {
    const slate = (slates ?? []).find((s) => s.id === stat.slate_id);
    const year = yearFromDate(slate?.start_date ?? slate?.date);
    if (!year) continue;
    byYear[year].playerStats += 1;
  }

  Object.entries(byYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([year, data]) => {
      console.log(year, {
        slates: data.slates.size,
        lineups: data.lineups,
        lineupPlayers: data.lineupPlayers,
        playerStats: data.playerStats,
      });
    });
}

run();
