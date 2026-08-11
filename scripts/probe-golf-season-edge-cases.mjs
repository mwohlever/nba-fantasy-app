import fs from "fs";
import {
  createClient,
} from "@supabase/supabase-js";

const env =
  fs.readFileSync(
    ".env.local",
    "utf8",
  );

for (
  const line
  of env.split("\n")
) {
  const match =
    line.match(
      /^([^#=]+)=(.*)$/,
    );

  if (!match) continue;

  const [
    ,
    key,
    rawValue,
  ] = match;

  if (!process.env[key]) {
    process.env[key] =
      rawValue
        .trim()
        .replace(
          /^['"]|['"]$/g,
          "",
        );
  }
}

const supabase =
  createClient(
    process.env
      .NEXT_PUBLIC_SUPABASE_URL,
    process.env
      .SUPABASE_SERVICE_ROLE_KEY,
  );

const names = [
  "Rory McIlroy",
  "Jon Rahm",
];

const {
  data: golfers,
  error,
} =
  await supabase
    .from(
      "golf_players",
    )
    .select(
      `
      id,
      display_name,
      espn_player_id
    `,
    )
    .in(
      "display_name",
      names,
    );

if (error) {
  throw error;
}

const wanted = new Set([
  "tournamentsPlayed",
  "cutsMade",
  "wins",
  "topTenFinishes",
  "roundsPlayed",
  "holesPlayed",
  "birdies",
  "eagles",
  "bogeys",
  "scoringAverage",
  "adjustedScoringAverage",
  "birdiesPerRound",
  "greensInRegPct",
  "driveAccuracyPct",
  "yardsPerDrive",
  "puttsGirAvg",
]);

for (
  const golfer
  of golfers ?? []
) {
  console.log();
  console.log(
    "========================================"
  );

  console.log(
    golfer.display_name,
    golfer.espn_player_id,
  );

  console.log(
    "========================================"
  );

  const url =
    `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/types/1/athletes/${golfer.espn_player_id}/statistics`;

  const response =
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json",
          "User-Agent":
            "Mozilla/5.0",
        },
      },
    );

  console.log(
    "STATUS:",
    response.status,
  );

  if (!response.ok) {
    continue;
  }

  const data =
    await response.json();

  for (
    const category
    of data?.splits
      ?.categories ??
      []
  ) {
    for (
      const stat
      of category.stats ??
        []
    ) {
      if (
        !wanted.has(
          stat.name,
        )
      ) {
        continue;
      }

      console.log({
        name:
          stat.name,

        value:
          stat.value,

        displayValue:
          stat.displayValue,

        rank:
          stat.rank,
      });
    }
  }
}
