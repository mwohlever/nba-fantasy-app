require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const season = process.argv[2] || "2025-26";
const csvPath = path.join(process.cwd(), "data", "nba-season-averages", `${season}.csv`);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function fantasyPoints(row, headers) {
  const num = (name) => Number(row[headers.indexOf(name)] || 0);

  return (
    num("PTS") +
    num("REB") * 1.2 +
    num("AST") * 1.5 +
    num("STL") * 2 +
    num("BLK") * 2 -
    num("TOV")
  );
}

(async () => {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing CSV: ${csvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const headers = rows[0];

  const required = [
    "PLAYER_ID",
    "PLAYER_NAME",
    "PTS",
    "REB",
    "AST",
    "STL",
    "BLK",
    "TOV",
  ];

  for (const col of required) {
    if (!headers.includes(col)) {
      throw new Error(`CSV missing required column: ${col}`);
    }
  }

  const indexOf = (name) => headers.indexOf(name);

  const numberValue = (row, name) => {
    const index = indexOf(name);

    if (index < 0) {
      return null;
    }

    const raw = row[index];

    if (
      raw === undefined ||
      raw === null ||
      String(raw).trim() === ""
    ) {
      return null;
    }

    const value = Number(raw);

    return Number.isFinite(value)
      ? value
      : null;
  };

  const round1 = (value) =>
    value === null
      ? null
      : Math.round(value * 10) / 10;

  const payload = rows
    .slice(1)
    .map((row) => {
      const points =
        numberValue(row, "PTS") ?? 0;

      const rebounds =
        numberValue(row, "REB") ?? 0;

      const assists =
        numberValue(row, "AST") ?? 0;

      const steals =
        numberValue(row, "STL") ?? 0;

      const blocks =
        numberValue(row, "BLK") ?? 0;

      const turnovers =
        numberValue(row, "TOV") ?? 0;

      const fantasyPoints =
        points +
        rebounds * 1.2 +
        assists * 1.5 +
        steals * 2 +
        blocks * 2 -
        turnovers;

      return {
        season,

        nba_player_id:
          Number(
            row[
              indexOf(
                "PLAYER_ID",
              )
            ],
          ),

        player_name:
          row[
            indexOf(
              "PLAYER_NAME",
            )
          ],

        games_played:
          numberValue(
            row,
            "GP",
          ),

        points:
          round1(
            points,
          ),

        rebounds:
          round1(
            rebounds,
          ),

        assists:
          round1(
            assists,
          ),

        steals:
          round1(
            steals,
          ),

        blocks:
          round1(
            blocks,
          ),

        turnovers:
          round1(
            turnovers,
          ),

        fantasy_points:
          round1(
            fantasyPoints,
          ),
      };
    })
    .filter(
      (row) =>
        row.nba_player_id &&
        row.player_name,
    );

  const { error } = await supabase
    .from("player_nba_season_averages")
    .upsert(payload, { onConflict: "season,nba_player_id" });

  if (error) throw error;

  console.log(`✅ Imported ${payload.length} NBA season averages for ${season}.`);
})();
