import fs from "fs";
import {
  createClient,
} from "@supabase/supabase-js";

const season =
  Number(
    process.argv[2] ??
      "2025",
  );

const limitArg =
  process.argv.find(
    (value) =>
      value.startsWith(
        "--limit=",
      ),
  );

const importLimit =
  limitArg
    ? Number(
        limitArg.split(
          "=",
        )[1],
      )
    : null;

if (
  !Number.isInteger(
    season,
  ) ||
  season < 2000
) {
  throw new Error(
    `Invalid NFL season: ${process.argv[2]}`
  );
}

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

  const value =
    rawValue
      .trim()
      .replace(
        /^['"]|['"]$/g,
        "",
      );

  if (
    !process.env[key]
  ) {
    process.env[key] =
      value;
  }
}

const supabase =
  createClient(
    process.env
      .NEXT_PUBLIC_SUPABASE_URL,
    process.env
      .SUPABASE_SERVICE_ROLE_KEY,
  );

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms,
      ),
  );
}

function round1(value) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return 0;
  }

  return (
    Math.round(
      numeric * 10,
    ) / 10
  );
}

function round2(value) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return 0;
  }

  return (
    Math.round(
      numeric * 100,
    ) / 100
  );
}

function perGame(
  total,
  gamesPlayed,
) {
  if (
    gamesPlayed <= 0
  ) {
    return 0;
  }

  return round2(
    Number(total ?? 0) /
      gamesPlayed,
  );
}

function calculateFantasyPoints(
  stats,
) {
  return (
    Number(
      stats.passing_yards ??
        0,
    ) /
      25 +
    Number(
      stats.passing_tds ??
        0,
    ) *
      4 -
    Number(
      stats.passing_ints ??
        0,
    ) *
      2 +
    Number(
      stats.rushing_yards ??
        0,
    ) /
      10 +
    Number(
      stats.rushing_tds ??
        0,
    ) *
      6 +
    Number(
      stats.receiving_yards ??
        0,
    ) /
      10 +
    Number(
      stats.receiving_tds ??
        0,
    ) *
      6 +
    Number(
      stats.receptions ??
        0,
    ) -
    Number(
      stats.fumbles_lost ??
        0,
    ) *
      2
  );
}

function buildStatMap(
  payload,
) {
  const map =
    new Map();

  for (
    const category
    of payload?.splits
      ?.categories ??
      []
  ) {
    for (
      const stat
      of category.stats ??
        []
    ) {
      if (
        !stat?.name
      ) {
        continue;
      }

      /*
       * ESPN occasionally repeats similarly named
       * stats across categories. The category-qualified
       * key lets us be precise when necessary.
       */
      map.set(
        `${category.name}:${stat.name}`,
        stat,
      );

      /*
       * Keep the first unqualified occurrence too.
       */
      if (
        !map.has(
          stat.name,
        )
      ) {
        map.set(
          stat.name,
          stat,
        );
      }
    }
  }

  return map;
}

function statValue(
  map,
  names,
) {
  for (
    const name
    of names
  ) {
    const stat =
      map.get(
        name,
      );

    if (!stat) {
      continue;
    }

    const value =
      Number(
        stat.value,
      );

    if (
      Number.isFinite(
        value,
      )
    ) {
      return value;
    }
  }

  return 0;
}

async function fetchSeasonStats(
  espnPlayerId,
) {
  const url =
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/athletes/${espnPlayerId}/statistics`;

  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0",
        },
      },
    );

  if (
    response.status ===
    404
  ) {
    return null;
  }

  if (
    !response.ok
  ) {
    throw new Error(
      `ESPN ${response.status}`
    );
  }

  return (
    await response.json()
  );
}

const {
  data: nflPlayers,
  error: playersError,
} =
  await supabase
    .from(
      "players_nfl",
    )
    .select(
      `
      id,
      name,
      nfl_player_id,
      team_abbreviation,
      position
    `,
    )
    .not(
      "nfl_player_id",
      "is",
      null,
    )
    .in(
      "position",
      [
        "QB",
        "RB",
        "WR",
        "TE",
      ],
    )
    .order(
      "name",
    )
    .range(
      0,
      5000,
    );

if (playersError) {
  throw playersError;
}

const playersToImport =
  Number.isFinite(
    importLimit,
  ) &&
  Number(
    importLimit,
  ) > 0
    ? nflPlayers.slice(
        0,
        Number(
          importLimit,
        ),
      )
    : nflPlayers;

console.log(
  `Found ${nflPlayers.length} QB/RB/WR/TE players with ESPN IDs.`
);

if (
  playersToImport.length !==
  nflPlayers.length
) {
  console.log(
    `Test mode: importing first ${playersToImport.length}.`
  );
}

let imported = 0;
let unavailable = 0;
let failed = 0;

const failures = [];

for (
  let index = 0;
  index <
  playersToImport.length;
  index += 1
) {
  const player =
    playersToImport[index];

  const espnPlayerId =
    Number(
      player.nfl_player_id,
    );

  process.stdout.write(
    `[${index + 1}/${playersToImport.length}] ${player.name} (${player.position}) ... `
  );

  try {
    const payload =
      await fetchSeasonStats(
        espnPlayerId,
      );

    if (!payload) {
      unavailable += 1;

      console.log(
        "no season stats"
      );

      continue;
    }

    const stats =
      buildStatMap(
        payload,
      );

    const gamesPlayed =
      Math.max(
        0,
        Math.round(
          statValue(
            stats,
            [
              "general:gamesPlayed",
              "gamesPlayed",
            ],
          ),
        ),
      );

    /*
     * ESPN's Core feed has stable descriptive names,
     * but these fallbacks make the importer tolerant
     * if one season uses a neighboring equivalent.
     */
    const passingYards =
      statValue(
        stats,
        [
          "passing:passingYards",
          "passingYards",
          "passing:netPassingYards",
          "netPassingYards",
        ],
      );

    const passingTds =
      statValue(
        stats,
        [
          "passing:passingTouchdowns",
          "passingTouchdowns",
        ],
      );

    const passingInts =
      statValue(
        stats,
        [
          "passing:interceptions",
          "interceptions",
        ],
      );

    const rushingYards =
      statValue(
        stats,
        [
          "rushing:rushingYards",
          "rushingYards",
        ],
      );

    const rushingTds =
      statValue(
        stats,
        [
          "rushing:rushingTouchdowns",
          "rushingTouchdowns",
        ],
      );

    const receivingTargets =
      statValue(
        stats,
        [
          "receiving:receivingTargets",
          "receivingTargets",
        ],
      );

    const receptions =
      statValue(
        stats,
        [
          "receiving:receptions",
          "receptions",
        ],
      );

    const receivingYards =
      statValue(
        stats,
        [
          "receiving:receivingYards",
          "receivingYards",
        ],
      );

    const receivingTds =
      statValue(
        stats,
        [
          "receiving:receivingTouchdowns",
          "receivingTouchdowns",
        ],
      );

    const fumblesLost =
      statValue(
        stats,
        [
          "general:fumblesLost",
          "fumblesLost",
        ],
      );

    const fantasyPoints =
      calculateFantasyPoints(
        {
          passing_yards:
            passingYards,

          passing_tds:
            passingTds,

          passing_ints:
            passingInts,

          rushing_yards:
            rushingYards,

          rushing_tds:
            rushingTds,

          receiving_yards:
            receivingYards,

          receiving_tds:
            receivingTds,

          receptions,

          fumbles_lost:
            fumblesLost,
        },
      );

    const row = {
      season,

      nfl_player_id:
        espnPlayerId,

      player_name:
        player.name,

      position:
        player.position ??
        null,

      team_abbreviation:
        player.team_abbreviation ??
        null,

      games_played:
        gamesPlayed,

      passing_yards:
        round1(
          passingYards,
        ),

      passing_tds:
        round1(
          passingTds,
        ),

      passing_ints:
        round1(
          passingInts,
        ),

      rushing_yards:
        round1(
          rushingYards,
        ),

      rushing_tds:
        round1(
          rushingTds,
        ),

      receiving_targets:
        round1(
          receivingTargets,
        ),

      receptions:
        round1(
          receptions,
        ),

      receiving_yards:
        round1(
          receivingYards,
        ),

      receiving_tds:
        round1(
          receivingTds,
        ),

      fumbles_lost:
        round1(
          fumblesLost,
        ),

      fantasy_points:
        round1(
          fantasyPoints,
        ),

      passing_yards_per_game:
        perGame(
          passingYards,
          gamesPlayed,
        ),

      passing_tds_per_game:
        perGame(
          passingTds,
          gamesPlayed,
        ),

      passing_ints_per_game:
        perGame(
          passingInts,
          gamesPlayed,
        ),

      rushing_yards_per_game:
        perGame(
          rushingYards,
          gamesPlayed,
        ),

      rushing_tds_per_game:
        perGame(
          rushingTds,
          gamesPlayed,
        ),

      receiving_targets_per_game:
        perGame(
          receivingTargets,
          gamesPlayed,
        ),

      receptions_per_game:
        perGame(
          receptions,
          gamesPlayed,
        ),

      receiving_yards_per_game:
        perGame(
          receivingYards,
          gamesPlayed,
        ),

      receiving_tds_per_game:
        perGame(
          receivingTds,
          gamesPlayed,
        ),

      fumbles_lost_per_game:
        perGame(
          fumblesLost,
          gamesPlayed,
        ),

      fantasy_points_per_game:
        perGame(
          fantasyPoints,
          gamesPlayed,
        ),

      source:
        "espn",

      updated_at:
        new Date()
          .toISOString(),
    };

    const {
      error,
    } =
      await supabase
        .from(
          "player_nfl_season_stats",
        )
        .upsert(
          row,
          {
            onConflict:
              "season,nfl_player_id",
          },
        );

    if (error) {
      throw error;
    }

    imported += 1;

    console.log(
      `GP ${gamesPlayed} · ${row.fantasy_points_per_game.toFixed(1)} FP/G`
    );
  } catch (
    error
  ) {
    failed += 1;

    failures.push({
      name:
        player.name,

      nflPlayerId:
        espnPlayerId,

      error:
        error instanceof Error
          ? error.message
          : String(
              error,
            ),
    });

    console.log(
      "FAILED"
    );
  }

  /*
   * Be polite to ESPN rather than firing hundreds
   * of requests simultaneously.
   */
  await sleep(
    75,
  );
}

console.log();
console.log(
  "========================================"
);

console.log(
  `NFL ${season} season import complete.`
);

console.log(
  "Imported:",
  imported,
);

console.log(
  "No ESPN stats:",
  unavailable,
);

console.log(
  "Failed:",
  failed,
);

if (
  failures.length >
  0
) {
  console.log();
  console.log(
    "=== FAILURES ==="
  );

  console.table(
    failures,
  );
}
