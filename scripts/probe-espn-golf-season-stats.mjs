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

  if (!match) {
    continue;
  }

  const [
    ,
    key,
    rawValue,
  ] = match;

  if (
    !process.env[key]
  ) {
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
      espn_player_id,
      owgr_rank
    `,
    )
    .eq(
      "is_active",
      true,
    )
    .not(
      "espn_player_id",
      "is",
      null,
    )
    .order(
      "owgr_rank",
      {
        ascending:
          true,
        nullsFirst:
          false,
      },
    )
    .limit(
      50,
    );

if (error) {
  throw error;
}

const golfer =
  golfers?.find(
    (row) =>
      /^\d+$/.test(
        String(
          row.espn_player_id ??
            "",
        ),
      ),
  );

if (!golfer) {
  throw new Error(
    "No active golfer with a real numeric ESPN ID was found.",
  );
}

const playerId =
  String(
    golfer.espn_player_id,
  );

const season =
  "2026";

console.log(
  "========================================"
);

console.log(
  "TEST GOLFER"
);

console.log(
  "========================================"
);

console.log({
  localId:
    golfer.id,
  name:
    golfer.display_name,
  espnPlayerId:
    playerId,
  owgr:
    golfer.owgr_rank,
});

const urls = [
  `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/${season}/athletes/${playerId}/statistics`,
  `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/${season}/types/1/athletes/${playerId}/statistics`,
  `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/athletes/${playerId}/statistics`,
  `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/athletes/${playerId}`,
];

async function inspect(
  url,
) {
  console.log();
  console.log(
    "========================================"
  );

  console.log(
    url
  );

  console.log(
    "========================================"
  );

  try {
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
      response.statusText,
    );

    const raw =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(
          raw,
        );
    } catch {
      console.log(
        raw.slice(
          0,
          1500,
        ),
      );

      return;
    }

    console.log(
      "TOP LEVEL KEYS:",
      Object.keys(
        data,
      ),
    );

    if (
      data?.splits
    ) {
      console.log(
        "SPLITS KEYS:",
        Object.keys(
          data.splits,
        ),
      );
    }

    const categories =
      data?.splits?.categories ??
      data?.categories ??
      [];

    if (
      Array.isArray(
        categories,
      )
    ) {
      console.log(
        "CATEGORY COUNT:",
        categories.length,
      );

      for (
        const category
        of categories
      ) {
        console.log();
        console.log(
          `=== CATEGORY: ${
            category.name ??
            category.displayName ??
            "unknown"
          } ===`,
        );

        const stats =
          category.stats ??
          [];

        console.log(
          "STAT COUNT:",
          stats.length,
        );

        for (
          const stat
          of stats
        ) {
          console.log({
            name:
              stat.name,
            displayName:
              stat.displayName,
            abbreviation:
              stat.abbreviation,
            value:
              stat.value,
            displayValue:
              stat.displayValue,
            perGameValue:
              stat.perGameValue,
            rank:
              stat.rank,
          });
        }
      }
    } else {
      console.log(
        JSON.stringify(
          data,
          null,
          2,
        ).slice(
          0,
          8000,
        ),
      );
    }
  } catch (
    error
  ) {
    console.error(
      "REQUEST ERROR:",
      error,
    );
  }
}

for (
  const url
  of urls
) {
  await inspect(
    url,
  );
}
