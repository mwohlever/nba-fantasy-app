import fs from "fs";
import {
  createClient,
} from "@supabase/supabase-js";

const season =
  Number(
    process.argv[2] ??
      "2026",
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
    `Invalid golf season: ${process.argv[2]}`
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

function round2(value) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric,
    )
  ) {
    return null;
  }

  return (
    Math.round(
      numeric * 100,
    ) / 100
  );
}

function numericDisplayValue(
  value,
) {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const cleaned =
    value
      .replace(
        /[$,%]/g,
        "",
      )
      .replace(
        /,/g,
        "",
      )
      .trim();

  if (!cleaned) {
    return null;
  }

  const numeric =
    Number(
      cleaned,
    );

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : null;
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

      map.set(
        stat.name,
        stat,
      );
    }
  }

  return map;
}

function statValue(
  map,
  name,
) {
  const stat =
    map.get(
      name,
    );

  if (!stat) {
    return null;
  }

  const raw =
    Number(
      stat.value,
    );

  if (
    Number.isFinite(
      raw,
    )
  ) {
    return raw;
  }

  return numericDisplayValue(
    stat.displayValue,
  );
}

function statInt(
  map,
  name,
) {
  const value =
    statValue(
      map,
      name,
    );

  if (
    value === null
  ) {
    return 0;
  }

  return Math.round(
    value,
  );
}

function percentage(
  numerator,
  denominator,
) {
  if (
    !Number.isFinite(
      numerator,
    ) ||
    !Number.isFinite(
      denominator,
    ) ||
    denominator <= 0
  ) {
    return null;
  }

  return round2(
    numerator /
      denominator *
      100,
  );
}

async function fetchSeasonStats(
  espnPlayerId,
) {
  const url =
    `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/${season}/types/1/athletes/${espnPlayerId}/statistics`;

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
  data: golfPlayers,
  error: playerError,
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
    .range(
      0,
      5000,
    );

if (playerError) {
  throw playerError;
}

/*
 * Ignore temporary PGA field IDs such as pga:12345.
 * We only import once ESPN has reconciled the golfer
 * to a real numeric ESPN athlete ID.
 */
const eligiblePlayers =
  (
    golfPlayers ??
    []
  ).filter(
    (player) =>
      /^\d+$/.test(
        String(
          player.espn_player_id ??
            "",
        ),
      ),
  );

const playersToImport =
  Number.isFinite(
    importLimit,
  ) &&
  Number(
    importLimit,
  ) > 0
    ? eligiblePlayers.slice(
        0,
        Number(
          importLimit,
        ),
      )
    : eligiblePlayers;

console.log(
  `Found ${eligiblePlayers.length} active golfers with real ESPN IDs.`
);

if (
  playersToImport.length !==
  eligiblePlayers.length
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
    String(
      player.espn_player_id,
    );

  process.stdout.write(
    `[${index + 1}/${playersToImport.length}] ${player.display_name} ... `
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

    const tournamentsPlayed =
      statInt(
        stats,
        "tournamentsPlayed",
      );

    const roundsPlayed =
      statInt(
        stats,
        "roundsPlayed",
      );

    const holesPlayed =
      statInt(
        stats,
        "holesPlayed",
      );

    const cutsMade =
      statInt(
        stats,
        "cutsMade",
      );

    const wins =
      statInt(
        stats,
        "wins",
      );

    const secondPlace =
      statInt(
        stats,
        "secondPlace",
      );

    const thirdPlace =
      statInt(
        stats,
        "thirdPlace",
      );

    const fourthPlace =
      statInt(
        stats,
        "fourthPlace",
      );

    const fifthPlace =
      statInt(
        stats,
        "fifthPlace",
      );

    const top5 =
      wins +
      secondPlace +
      thirdPlace +
      fourthPlace +
      fifthPlace;

    const top10 =
      statInt(
        stats,
        "topTenFinishes",
      );

    const birdies =
      statInt(
        stats,
        "birdies",
      );

    const eagles =
      statInt(
        stats,
        "eagles",
      );

    const pars =
      statInt(
        stats,
        "pars",
      );

    const bogeys =
      statInt(
        stats,
        "bogeys",
      );

    const doubles =
      statInt(
        stats,
        "doubles",
      );

    const triples =
      statInt(
        stats,
        "tripleBogeysAndWorse",
      );

    const greensHit =
      statInt(
        stats,
        "greensHit",
      );

    const girPoss =
      statInt(
        stats,
        "girPoss",
      );

    const fairwaysHit =
      statInt(
        stats,
        "fairwayHits",
      );

    const possibleFairways =
      statInt(
        stats,
        "possibleFairways",
      );

    /*
     * ESPN sometimes returns a partial PGA season record.
     *
     * Examples:
     * - Rory: tournaments / cuts / finishes exist, but
     *   roundsPlayed and holesPlayed are both zero.
     * - Rahm: some finish/cut fields exist despite ESPN
     *   reporting zero PGA tournaments.
     *
     * Zero detailed stats in those records mean
     * "not available", not actual zero performance.
     */
    const hasDetailedStats =
      roundsPlayed > 0 &&
      holesPlayed > 0;

    const hasValidCutDenominator =
      tournamentsPlayed > 0 &&
      cutsMade >= 0 &&
      cutsMade <= tournamentsPlayed;

    const row = {
      season,

      player_id:
        Number(
          player.id,
        ),

      espn_player_id:
        espnPlayerId,

      player_name:
        player.display_name,

      tournaments_played:
        tournamentsPlayed,

      rounds_played:
        roundsPlayed,

      holes_played:
        holesPlayed,

      cuts_made:
        cutsMade,

      cuts_made_pct:
        hasValidCutDenominator
          ? percentage(
              cutsMade,
              tournamentsPlayed,
            )
          : null,

      has_detailed_stats:
        hasDetailedStats,

      wins,

      top_5_finishes:
        top5,

      top_10_finishes:
        top10,

      second_place:
        secondPlace,

      third_place:
        thirdPlace,

      fourth_place:
        fourthPlace,

      fifth_place:
        fifthPlace,

      scoring_average:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "scoringAverage",
              ),
            )
          : null,

      adjusted_scoring_average:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "adjustedScoringAverage",
              ),
            )
          : null,

      birdies,

      eagles,

      pars,

      bogeys,

      doubles,

      triple_bogeys_or_worse:
        triples,

      birdies_per_round:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "birdiesPerRound",
              ),
            )
          : null,

      birdie_rate:
        hasDetailedStats
          ? percentage(
              birdies,
              holesPlayed,
            )
          : null,

      eagle_rate:
        hasDetailedStats
          ? percentage(
              eagles,
              holesPlayed,
            )
          : null,

      bogey_rate:
        hasDetailedStats
          ? percentage(
              bogeys,
              holesPlayed,
            )
          : null,

      greens_hit:
        greensHit,

      gir_opportunities:
        girPoss,

      greens_in_reg_pct:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "greensInRegPct",
              ) ??
              percentage(
                greensHit,
                girPoss,
              ),
            )
          : null,

      fairways_hit:
        fairwaysHit,

      possible_fairways:
        possibleFairways,

      driving_accuracy_pct:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "driveAccuracyPct",
              ) ??
              percentage(
                fairwaysHit,
                possibleFairways,
              ),
            )
          : null,

      driving_distance:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "yardsPerDrive",
              ),
            )
          : null,

      putts_per_gir:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "puttsGirAvg",
              ),
            )
          : null,

      sand_save_pct:
        hasDetailedStats
          ? round2(
              statValue(
                stats,
                "savePct",
              ),
            )
          : null,

      fedex_cup_points:
        round2(
          statValue(
            stats,
            "cupPoints",
          ),
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
          "player_golf_season_stats",
        )
        .upsert(
          row,
          {
            onConflict:
              "season,player_id",
          },
        );

    if (error) {
      throw error;
    }

    imported += 1;

    console.log(
      `${tournamentsPlayed} events · ` +
      `${cutsMade} cuts · ` +
      (
        hasDetailedStats
          ? `${row.scoring_average ?? "—"} avg · ` +
            `${row.birdies_per_round ?? "—"} birdies/R`
          : "partial ESPN stats"
      )
    );
  } catch (
    error
  ) {
    failed += 1;

    failures.push({
      golfer:
        player.display_name,

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

  await sleep(
    75,
  );
}

console.log();
console.log(
  "========================================"
);

console.log(
  `Golf ${season} season import complete.`
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
