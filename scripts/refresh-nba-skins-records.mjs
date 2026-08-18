import fs from "node:fs";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  fetchNbaSkinsSeasonRecords,
} from "../lib/providers/nbaSkinsRecords.mjs";


function loadEnv(path) {
  const raw =
    fs.readFileSync(
      path,
      "utf8",
    );

  for (
    const line
    of raw.split(/\r?\n/)
  ) {
    const trimmed =
      line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#")
    ) {
      continue;
    }

    const index =
      trimmed.indexOf("=");

    if (index < 1) {
      continue;
    }

    const key =
      trimmed
        .slice(
          0,
          index,
        )
        .trim();

    let value =
      trimmed
        .slice(
          index + 1,
        )
        .trim();

    if (
      (
        value.startsWith('"') &&
        value.endsWith('"')
      ) ||
      (
        value.startsWith("'") &&
        value.endsWith("'")
      )
    ) {
      value =
        value.slice(
          1,
          -1,
        );
    }

    if (!(key in process.env)) {
      process.env[key] =
        value;
    }
  }
}


function parseArgs() {
  const values =
    new Map();

  for (
    const arg
    of process.argv.slice(2)
  ) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [
      key,
      ...rest
    ] =
      arg
        .slice(2)
        .split("=");

    values.set(
      key,
      rest.join("=") || "true",
    );
  }

  const season =
    Number(
      values.get("season"),
    );

  if (
    !Number.isInteger(season)
  ) {
    throw new Error(
      "Usage: node scripts/refresh-nba-skins-records.mjs --season=2025 [--finalize=true]",
    );
  }

  return {
    season,

    finalize:
      values.get("finalize") ===
      "true",
  };
}


loadEnv(
  ".env.local",
);

const url =
  process.env
    .NEXT_PUBLIC_SUPABASE_URL ??
  process.env
    .SUPABASE_URL;

const serviceKey =
  process.env
    .SUPABASE_SERVICE_ROLE_KEY ??
  process.env
    .SUPABASE_SERVICE_KEY;

if (
  !url ||
  !serviceKey
) {
  throw new Error(
    "Missing Supabase URL/service-role key.",
  );
}

const supabase =
  createClient(
    url,
    serviceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

const {
  season,
  finalize,
} =
  parseArgs();


console.log(
  "===============================================",
);

console.log(
  "NBA SKINS TEAM RECORD REFRESH",
);

console.log(
  "===============================================",
);

console.log(
  `Skins season: ${season}`,
);


const {
  espnSeason,
  records,
} =
  await fetchNbaSkinsSeasonRecords(
    season,
  );

console.log(
  `ESPN season: ${espnSeason}`,
);

console.log(
  `Teams returned: ${records.length}`,
);


const {
  data: seasonRow,
  error: seasonError,
} =
  await supabase
    .from(
      "nba_skins_seasons",
    )
    .select(
      "id, season, status",
    )
    .eq(
      "season",
      season,
    )
    .single();

if (
  seasonError ||
  !seasonRow
) {
  throw new Error(
    `NBA Skins season ${season} not found: ` +
    `${seasonError?.message ?? "unknown error"}`,
  );
}

const seasonId =
  Number(
    seasonRow.id,
  );


if (finalize) {
  const incomplete =
    records.filter(
      (record) =>
        record.gamesPlayed !== 82,
    );

  if (
    incomplete.length > 0
  ) {
    throw new Error(
      "Refusing to finalize because these teams do not have 82 regular-season games: " +
      incomplete
        .map(
          (record) =>
            `${record.abbreviation} ${record.wins}-${record.losses}`,
        )
        .join(", "),
    );
  }
}


const now =
  new Date()
    .toISOString();


const teamRows =
  records.map(
    (record) => ({
      season_id:
        seasonId,

      nba_team_abbreviation:
        record.abbreviation,

      wins:
        record.wins,

      losses:
        record.losses,

      games_played:
        record.gamesPlayed,

      projection_source:
        null,

      source_updated_at:
        now,

      updated_at:
        now,
    }),
  );


const {
  error: recordsError,
} =
  await supabase
    .from(
      "nba_skins_team_records",
    )
    .upsert(
      teamRows,
      {
        onConflict:
          "season_id,nba_team_abbreviation",
      },
    );

if (recordsError) {
  throw new Error(
    `Failed to upsert NBA Skins team records: ${recordsError.message}`,
  );
}


for (
  const record
  of records
) {
  const {
    error:
      nbaTeamError,
  } =
    await supabase
      .from(
        "nba_skins_nba_teams",
      )
      .update({
        display_name:
          record.displayName,

        espn_team_id:
          record.espnTeamId,

        updated_at:
          now,
      })
      .eq(
        "abbreviation",
        record.abbreviation,
      );

  if (nbaTeamError) {
    throw new Error(
      `Failed updating NBA team ${record.abbreviation}: ${nbaTeamError.message}`,
    );
  }
}


const {
  data: picks,
  error: picksError,
} =
  await supabase
    .from(
      "nba_skins_picks",
    )
    .select(
      "id, nba_team_abbreviation, pick_type",
    )
    .eq(
      "season_id",
      seasonId,
    );

if (picksError) {
  throw new Error(
    `Failed loading NBA Skins picks: ${picksError.message}`,
  );
}


const recordByTeam =
  new Map(
    records.map(
      (record) => [
        record.abbreviation,
        record,
      ],
    ),
  );


let picksUpdated = 0;

for (
  const pick
  of picks ?? []
) {
  const record =
    recordByTeam.get(
      String(
        pick.nba_team_abbreviation,
      ),
    );

  if (!record) {
    throw new Error(
      `No ESPN record found for pick ${pick.nba_team_abbreviation}.`,
    );
  }

  const finalPoints =
    pick.pick_type ===
    "losses"
      ? record.losses
      : record.wins;

  const {
    error: updateError,
  } =
    await supabase
      .from(
        "nba_skins_picks",
      )
      .update({
        final_points:
          finalPoints,

        updated_at:
          now,
      })
      .eq(
        "id",
        pick.id,
      );

  if (updateError) {
    throw new Error(
      `Failed updating pick ${pick.id}: ${updateError.message}`,
    );
  }

  picksUpdated += 1;
}


if (finalize) {
  const {
    error:
      finalizeError,
  } =
    await supabase
      .from(
        "nba_skins_seasons",
      )
      .update({
        status:
          "final",

        finalized_at:
          now,

        updated_at:
          now,
      })
      .eq(
        "id",
        seasonId,
      );

  if (finalizeError) {
    throw new Error(
      `Failed finalizing NBA Skins season: ${finalizeError.message}`,
    );
  }
}


console.log("");
console.log(
  `✓ Saved ${records.length} NBA team records.`,
);

console.log(
  `✓ Updated ${picksUpdated} NBA Skins picks.`,
);

console.log(
  finalize
    ? `✓ Season ${season} finalized from completed NBA regular-season records.`
    : `✓ Season ${season} refreshed.`,
);

console.log("");

console.log(
  "Team records:",
);

for (
  const record
  of records
) {
  console.log(
    `${record.abbreviation.padEnd(3)}  ${record.wins}-${record.losses}`,
  );
}
