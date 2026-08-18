const ESPN_STANDINGS_BASE =
  "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";

const TEAM_CODE_ALIASES = {
  SA: "SAS",
  GS: "GSW",
  NY: "NYK",
  NO: "NOP",
  WSH: "WAS",
  PHO: "PHX",
  BRK: "BKN",
  UTH: "UTA",
  UTAH: "UTA",
};

const NBA_TEAM_CODES = new Set([
  "ATL",
  "BOS",
  "BKN",
  "CHA",
  "CHI",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GSW",
  "HOU",
  "IND",
  "LAC",
  "LAL",
  "MEM",
  "MIA",
  "MIL",
  "MIN",
  "NOP",
  "NYK",
  "OKC",
  "ORL",
  "PHI",
  "PHX",
  "POR",
  "SAC",
  "SAS",
  "TOR",
  "UTA",
  "WAS",
]);

export function normalizeTeamCode(value) {
  const raw =
    String(value ?? "")
      .trim()
      .toUpperCase();

  if (!raw) {
    return null;
  }

  return TEAM_CODE_ALIASES[raw] ?? raw;
}

function statValue(stats, name) {
  const stat =
    Array.isArray(stats)
      ? stats.find(
          (entry) =>
            String(entry?.name ?? "")
              .trim()
              .toLowerCase() === name,
        )
      : null;

  const value =
    Number(stat?.value);

  return Number.isFinite(value)
    ? value
    : null;
}

export function espnSeasonForSkinsSeason(
  skinsSeason,
) {
  const season =
    Number(skinsSeason);

  if (!Number.isInteger(season)) {
    throw new Error(
      `Invalid NBA Skins season: ${skinsSeason}`,
    );
  }

  /*
   * NBA Skins uses the starting calendar year.
   *
   * Example:
   * Skins 2025 = NBA 2025-26 = ESPN season 2026.
   */
  return season + 1;
}

export async function fetchNbaSkinsSeasonRecords(
  skinsSeason,
) {
  const espnSeason =
    espnSeasonForSkinsSeason(
      skinsSeason,
    );

  const url =
    new URL(
      ESPN_STANDINGS_BASE,
    );

  url.searchParams.set(
    "season",
    String(espnSeason),
  );

  url.searchParams.set(
    "seasontype",
    "2",
  );

  const response =
    await fetch(
      url,
      {
        cache: "no-store",

        headers: {
          Accept:
            "application/json",

          "User-Agent":
            "Mozilla/5.0 (compatible; 111-Sports/1.0)",
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `ESPN NBA standings failed for ESPN season ${espnSeason}: ` +
      `${response.status} ${response.statusText}`,
    );
  }

  const payload =
    await response.json();

  const conferences =
    Array.isArray(payload?.children)
      ? payload.children
      : [];

  const recordMap =
    new Map();

  for (
    const conference
    of conferences
  ) {
    const entries =
      Array.isArray(
        conference?.standings?.entries,
      )
        ? conference.standings.entries
        : [];

    for (
      const entry
      of entries
    ) {
      const abbreviation =
        normalizeTeamCode(
          entry?.team?.abbreviation,
        );

      if (!abbreviation) {
        continue;
      }

      if (!NBA_TEAM_CODES.has(abbreviation)) {
        throw new Error(
          `Unexpected ESPN NBA team abbreviation: ${String(
            entry?.team?.abbreviation ?? "unknown",
          )} -> ${abbreviation}`,
        );
      }

      const wins =
        statValue(
          entry?.stats,
          "wins",
        );

      const losses =
        statValue(
          entry?.stats,
          "losses",
        );

      if (
        wins === null ||
        losses === null
      ) {
        throw new Error(
          `ESPN record missing wins/losses for ${abbreviation}.`,
        );
      }

      const gamesPlayed =
        wins + losses;

      recordMap.set(
        abbreviation,
        {
          abbreviation,

          displayName:
            String(
              entry?.team?.displayName ??
              abbreviation,
            ),

          espnTeamId:
            entry?.team?.id != null
              ? String(
                  entry.team.id,
                )
              : null,

          wins,
          losses,
          gamesPlayed,
        },
      );
    }
  }

  const records =
    Array.from(
      recordMap.values(),
    ).sort(
      (a, b) =>
        a.abbreviation.localeCompare(
          b.abbreviation,
        ),
    );

  if (
    records.length !== 30
  ) {
    throw new Error(
      `Expected 30 NBA teams from ESPN season ${espnSeason}; found ${records.length}.`,
    );
  }

  return {
    skinsSeason:
      Number(skinsSeason),

    espnSeason,

    records,
  };
}


const ESPN_BPI_PROJECTIONS_BASE =
  "https://www.espn.com/nba/bpi/_/view/projections/season";


function parseProjectedRecordValue(
  value,
) {
  const raw =
    String(
      value ?? "",
    ).trim();

  const match =
    raw.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/,
    );

  if (!match) {
    return null;
  }

  const wins =
    Number(
      match[1],
    );

  const losses =
    Number(
      match[2],
    );

  if (
    !Number.isFinite(wins) ||
    !Number.isFinite(losses)
  ) {
    return null;
  }

  return {
    wins,
    losses,
  };
}


function getBpiStat(
  stats,
  name,
) {
  if (
    !Array.isArray(stats)
  ) {
    return null;
  }

  const target =
    String(name)
      .trim()
      .toLowerCase();

  const stat =
    stats.find(
      (entry) =>
        String(
          entry?.name ?? "",
        )
          .trim()
          .toLowerCase() ===
        target,
    );

  return stat?.value ??
    null;
}


function findProjectionTable(
  value,
) {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return null;
  }

  if (
    !Array.isArray(value) &&
    value?.table &&
    Array.isArray(
      value.table.stats,
    ) &&
    value?.selected?.league ===
      "nba"
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const child
      of value
    ) {
      const found =
        findProjectionTable(
          child,
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  for (
    const child
    of Object.values(
      value,
    )
  ) {
    const found =
      findProjectionTable(
        child,
      );

    if (found) {
      return found;
    }
  }

  return null;
}


function parseEmbeddedJsonScripts(
  html,
) {
  const parsed = [];

  const scriptRegex =
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while (
    (
      match =
        scriptRegex.exec(
          html,
        )
    ) !== null
  ) {
    const raw =
      String(
        match[1] ?? "",
      ).trim();

    if (
      !raw ||
      raw.length < 20
    ) {
      continue;
    }

    const candidates = [];

    if (
      raw.startsWith("{") ||
      raw.startsWith("[")
    ) {
      candidates.push(
        raw,
      );
    }

    const assignments = [
      raw.match(
        /window\.__espnfitt__\s*=\s*({[\s\S]+})\s*;?\s*$/,
      ),
      raw.match(
        /window\.__NEXT_DATA__\s*=\s*({[\s\S]+})\s*;?\s*$/,
      ),
    ];

    for (
      const assignment
      of assignments
    ) {
      if (
        assignment?.[1]
      ) {
        candidates.push(
          assignment[1],
        );
      }
    }

    for (
      const candidate
      of candidates
    ) {
      try {
        parsed.push(
          JSON.parse(
            candidate,
          ),
        );
      } catch {
        /*
         * ESPN contains many non-JSON scripts.
         * Ignore those and continue looking for
         * the server-rendered page state.
         */
      }
    }
  }

  return parsed;
}


export async function fetchNbaSkinsSeasonProjections(
  skinsSeason,
) {
  const espnSeason =
    espnSeasonForSkinsSeason(
      skinsSeason,
    );

  const url =
    `${ESPN_BPI_PROJECTIONS_BASE}/${espnSeason}`;

  const response =
    await fetch(
      url,
      {
        cache:
          "no-store",

        headers: {
          Accept:
            "text/html,application/xhtml+xml",

          "User-Agent":
            "Mozilla/5.0 (compatible; 111-Sports/1.0)",
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      `ESPN NBA BPI projections failed for ESPN season ${espnSeason}: ` +
      `${response.status} ${response.statusText}`,
    );
  }

  const html =
    await response.text();

  /*
   * ESPN server-renders the BPI page state directly into the
   * HTML response. The projection-row proof showed that the
   * useful selected/table payload is present in that raw HTML,
   * even when it is not exposed as a directly parsed script
   * object.
   *
   * Find the NBA projections "selected" block first so we do
   * not accidentally parse an unrelated ESPN table.
   */
  let selectedStart =
    -1;

  let searchFrom =
    0;

  while (true) {
    const candidateStart =
      html.indexOf(
        '"selected":',
        searchFrom,
      );

    if (
      candidateStart < 0
    ) {
      break;
    }

    const window =
      html.slice(
        candidateStart,
        candidateStart + 2500,
      );

    if (
      window.includes(
        '"league":"nba"',
      ) &&
      window.includes(
        '"projections.projectedw"',
      )
    ) {
      selectedStart =
        candidateStart;

      break;
    }

    searchFrom =
      candidateStart + 11;
  }


  if (
    selectedStart < 0
  ) {
    throw new Error(
      `ESPN NBA BPI selected payload was not found for ESPN season ${espnSeason}.`,
    );
  }


  const selectedWindow =
    html.slice(
      selectedStart,
      selectedStart + 3500,
    );

  const seasonMatch =
    selectedWindow.match(
      /"season":(\d+)/,
    );

  const selectedSeason =
    seasonMatch
      ? Number(
          seasonMatch[1],
        )
      : null;


  if (
    !Number.isInteger(
      selectedSeason,
    ) ||
    selectedSeason !==
      espnSeason
  ) {
    throw new Error(
      `ESPN NBA BPI returned season ${String(
        selectedSeason ??
        "unknown",
      )}; expected ${espnSeason}.`,
    );
  }


  const tableKeyIndex =
    html.indexOf(
      '"table":',
      selectedStart,
    );


  if (
    tableKeyIndex < 0
  ) {
    throw new Error(
      `ESPN NBA BPI table was not found for ESPN season ${espnSeason}.`,
    );
  }


  const tableObjectStart =
    html.indexOf(
      "{",
      tableKeyIndex +
        '"table":'.length,
    );


  if (
    tableObjectStart < 0
  ) {
    throw new Error(
      `ESPN NBA BPI table object was not found for ESPN season ${espnSeason}.`,
    );
  }


  /*
   * Extract one balanced JSON object. This is safer than a
   * regex over the full table because ESPN rows contain nested
   * team/stats objects and arrays.
   */
  let depth =
    0;

  let inString =
    false;

  let escaped =
    false;

  let tableObjectEnd =
    -1;


  for (
    let index =
      tableObjectStart;
    index <
    html.length;
    index += 1
  ) {
    const char =
      html[index];


    if (inString) {
      if (escaped) {
        escaped =
          false;

        continue;
      }

      if (
        char === "\\"
      ) {
        escaped =
          true;

        continue;
      }

      if (
        char === '"'
      ) {
        inString =
          false;
      }

      continue;
    }


    if (
      char === '"'
    ) {
      inString =
        true;

      continue;
    }


    if (
      char === "{"
    ) {
      depth +=
        1;

      continue;
    }


    if (
      char === "}"
    ) {
      depth -=
        1;

      if (
        depth === 0
      ) {
        tableObjectEnd =
          index + 1;

        break;
      }
    }
  }


  if (
    tableObjectEnd < 0
  ) {
    throw new Error(
      `ESPN NBA BPI table JSON was incomplete for ESPN season ${espnSeason}.`,
    );
  }


  let table;

  try {
    table =
      JSON.parse(
        html.slice(
          tableObjectStart,
          tableObjectEnd,
        ),
      );
  } catch (error) {
    throw new Error(
      `ESPN NBA BPI table JSON could not be parsed for ESPN season ${espnSeason}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }


  const rows =
    Array.isArray(
      table?.stats,
    )
      ? table.stats
      : [];


  if (
    rows.length === 0
  ) {
    throw new Error(
      `ESPN NBA BPI table contained no projection rows for ESPN season ${espnSeason}.`,
    );
  }

  const projectionMap =
    new Map();

  for (
    const row
    of rows
  ) {
    const abbreviation =
      normalizeTeamCode(
        row?.team?.abbrev ??
        row?.team?.abbreviation,
      );

    if (!abbreviation) {
      continue;
    }

    if (
      !NBA_TEAM_CODES.has(
        abbreviation,
      )
    ) {
      throw new Error(
        `Unexpected ESPN BPI NBA team abbreviation: ${String(
          row?.team?.abbrev ??
          row?.team?.abbreviation ??
          "unknown",
        )} -> ${abbreviation}`,
      );
    }

    /*
     * ESPN's server-rendered BPI table represents
     * the paired OVR W-L column as:
     *
     *   name:  "projectedw"
     *   value: "64.0-18.0"
     *
     * The header metadata identifies the paired
     * second field as projectedl.
     */
    const projectedPair =
      parseProjectedRecordValue(
        getBpiStat(
          row?.stats,
          "projectedw",
        ),
      );

    let projectedWins =
      projectedPair?.wins ??
      null;

    let projectedLosses =
      projectedPair?.losses ??
      null;

    /*
     * Support a future ESPN shape where the two
     * values are exposed separately.
     */
    if (
      projectedWins === null ||
      projectedLosses === null
    ) {
      const separateWins =
        Number(
          getBpiStat(
            row?.stats,
            "projectedw",
          ),
        );

      const separateLosses =
        Number(
          getBpiStat(
            row?.stats,
            "projectedl",
          ),
        );

      if (
        Number.isFinite(
          separateWins,
        ) &&
        Number.isFinite(
          separateLosses,
        )
      ) {
        projectedWins =
          separateWins;

        projectedLosses =
          separateLosses;
      }
    }

    if (
      projectedWins === null ||
      projectedLosses === null ||
      !Number.isFinite(
        projectedWins,
      ) ||
      !Number.isFinite(
        projectedLosses,
      )
    ) {
      throw new Error(
        `ESPN BPI projection missing projected W/L for ${abbreviation}.`,
      );
    }

    const projectedGames =
      projectedWins +
      projectedLosses;

    if (
      Math.abs(
        projectedGames -
        82,
      ) > 0.05
    ) {
      throw new Error(
        `ESPN BPI projection for ${abbreviation} totals ${projectedGames} games instead of 82.`,
      );
    }

    projectionMap.set(
      abbreviation,
      {
        abbreviation,

        displayName:
          String(
            row?.team?.displayName ??
            abbreviation,
          ),

        espnTeamId:
          row?.team?.id != null
            ? String(
                row.team.id,
              )
            : null,

        projectedWins,

        projectedLosses,
      },
    );
  }

  const projections =
    Array.from(
      projectionMap.values(),
    ).sort(
      (a, b) =>
        a.abbreviation.localeCompare(
          b.abbreviation,
        ),
    );

  if (
    projections.length !==
    30
  ) {
    throw new Error(
      `Expected 30 NBA teams from ESPN BPI season ${espnSeason}; found ${projections.length}.`,
    );
  }

  return {
    skinsSeason:
      Number(
        skinsSeason,
      ),

    espnSeason,

    source:
      "ESPN BPI",

    projections,
  };
}

