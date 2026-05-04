require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const slateId = Number(process.argv[2]);
const rawGames = process.argv.slice(3);

if (!slateId || rawGames.length === 0) {
  console.log("Usage:");
  console.log('node scripts/set-slate-nba-games.js <slateId> "2026-05-04|0042500211|20260504/PHINYK|76ers at Knicks"');
  process.exit(1);
}

(async () => {
  const rows = rawGames.map((entry) => {
    const [game_date, game_id, game_code, note] = entry.split("|");

    return {
      slate_id: slateId,
      game_date,
      game_id,
      game_code,
      note: note || null,
    };
  });

  const { data, error } = await supabase
    .from("slate_nba_games")
    .upsert(rows, { onConflict: "slate_id,game_id" })
    .select();

  if (error) throw error;

  console.log("✅ Saved slate NBA games:");
  console.log(data);
})();
