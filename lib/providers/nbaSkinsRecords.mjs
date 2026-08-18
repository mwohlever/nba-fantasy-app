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

function normalizeTeamCode(value) {
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
