import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

    if (
      index < 1
    ) {
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

    if (
      !(key in process.env)
    ) {
      process.env[key] =
        value;
    }
  }
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

const source =
  JSON.parse(
    fs.readFileSync(
      "data/nba-skins/historical-picks.json",
      "utf8",
    ),
  );

const {
  data: leagueTeams,
  error: leagueTeamsError,
} =
  await supabase
    .from(
      "teams",
    )
    .select(
      "id, name",
    );

if (
  leagueTeamsError
) {
  throw leagueTeamsError;
}

const leagueTeamId =
  new Map(
    (
      leagueTeams ??
      []
    ).map(
      (team) => [
        String(
          team.name,
        ).trim(),
        Number(
          team.id,
        ),
      ],
    ),
  );

for (
  const required
  of [
    "Andy",
    "Josh",
    "Jon",
    "Mark",
  ]
) {
  if (
    !leagueTeamId.has(
      required,
    )
  ) {
    throw new Error(
      `League team not found: ${required}`,
    );
  }
}

console.log(
  "===============================================",
);
console.log(
  "NBA SKINS HISTORICAL IMPORT",
);
console.log(
  "===============================================",
);

for (
  const seasonSource
  of source.seasons
) {
  const {
    data: seasonRow,
    error:
      seasonError,
  } =
    await supabase
      .from(
        "nba_skins_seasons",
      )
      .upsert(
        {
          season:
            seasonSource.season,
          status:
            seasonSource.status,
          finalized_at:
            seasonSource.status ===
            "final"
              ? new Date()
                  .toISOString()
              : null,
          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "season",
        },
      )
      .select(
        "id, season, status",
      )
      .single();

  if (
    seasonError
  ) {
    throw new Error(
      `Season ${seasonSource.season}: ${seasonError.message}`,
    );
  }

  const seasonId =
    Number(
      seasonRow.id,
    );

  if (
    Array.isArray(
      seasonSource.draftOrder,
    )
  ) {
    const orderRows =
      seasonSource
        .draftOrder
        .map(
          (
            name,
            index,
          ) => ({
            season_id:
              seasonId,
            team_id:
              leagueTeamId.get(
                name,
              ),
            draft_position:
              index + 1,
          }),
        );

    const {
      error:
        orderError,
    } =
      await supabase
        .from(
          "nba_skins_draft_order",
        )
        .upsert(
          orderRows,
          {
            onConflict:
              "season_id,team_id",
          },
        );

    if (
      orderError
    ) {
      throw new Error(
        `Draft order ${seasonSource.season}: ${orderError.message}`,
      );
    }
  }

  const picks =
    seasonSource.picks ??
    [];

  const ownerCounts =
    new Map();

  const pickRows =
    picks.map(
      (
        [
          owner,
          abbreviation,
          pickType,
          finalPoints,
        ],
        overallIndex,
      ) => {
        const ownerCount =
          (
            ownerCounts.get(
              owner,
            ) ??
            0
          ) + 1;

        ownerCounts.set(
          owner,
          ownerCount,
        );

        return {
          season_id:
            seasonId,
          team_id:
            leagueTeamId.get(
              owner,
            ),
          nba_team_abbreviation:
            abbreviation,
          pick_type:
            pickType,
          draft_round:
            ownerCount,
          overall_pick:
            overallIndex + 1,
          final_points:
            finalPoints,
          updated_at:
            new Date()
              .toISOString(),
        };
      },
    );

  if (
    pickRows.length >
    0
  ) {
    const {
      error:
        picksError,
    } =
      await supabase
        .from(
          "nba_skins_picks",
        )
        .upsert(
          pickRows,
          {
            onConflict:
              "season_id,nba_team_abbreviation",
          },
        );

    if (
      picksError
    ) {
      throw new Error(
        `Picks ${seasonSource.season}: ${picksError.message}`,
      );
    }
  }

  console.log(
    `✓ ${seasonSource.season}: ${pickRows.length} picks`,
  );
}

console.log("");
console.log(
  "Historical foundation complete.",
);
console.log(
  "2025 selections came from the MW sheet.",
);
console.log(
  "2025 final points remain intentionally unset.",
);
