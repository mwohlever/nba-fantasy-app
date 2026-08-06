"use client";

type UnknownRecord =
  Record<string, any>;

type GolfRefreshConfig = {
  success: boolean;
  slateId: number;
  eventId: string;
  year: string;
};

export type GolfRefreshResult = {
  success?: boolean;
  error?: string;
  gamesFound?: number;
  playerStatsUpserted?: number;
  teamResultsUpserted?: number;
  refreshedAt?: string;
  [key: string]: unknown;
};

async function readJsonSafely(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown =
      await response.json();

    return typeof value === "object" &&
      value !== null
      ? value as Record<
          string,
          unknown
        >
      : {};
  } catch {
    return {};
  }
}

function safeArray(
  value: unknown,
): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (
          row,
        ): row is UnknownRecord =>
          typeof row === "object" &&
          row !== null,
      )
    : [];
}

function trimStatus(
  status: unknown,
) {
  const record =
    typeof status === "object" &&
    status !== null
      ? status as UnknownRecord
      : {};

  const type =
    typeof record.type === "object" &&
    record.type !== null
      ? record.type as UnknownRecord
      : {};

  return {
    period:
      typeof record.period ===
      "number"
        ? record.period
        : undefined,
    type: {
      name:
        typeof type.name ===
        "string"
          ? type.name
          : undefined,
      state:
        typeof type.state ===
        "string"
          ? type.state
          : undefined,
      completed:
        typeof type.completed ===
        "boolean"
          ? type.completed
          : undefined,
      description:
        typeof type.description ===
        "string"
          ? type.description
          : undefined,
      detail:
        typeof type.detail ===
        "string"
          ? type.detail
          : undefined,
      shortDetail:
        typeof type.shortDetail ===
        "string"
          ? type.shortDetail
          : undefined,
    },
  };
}

function selectPlayerLink(
  linksValue: unknown,
) {
  const links =
    safeArray(linksValue);

  const preferred =
    links.find(
      (link) =>
        Array.isArray(link.rel) &&
        link.rel.includes(
          "playercard",
        ),
    ) ??
    links.find(
      (link) =>
        Array.isArray(link.rel) &&
        link.rel.includes(
          "overview",
        ),
    ) ??
    links[0] ??
    null;

  if (
    !preferred ||
    typeof preferred.href !==
      "string"
  ) {
    return [];
  }

  return [
    {
      href: preferred.href,
      rel: Array.isArray(
        preferred.rel,
      )
        ? preferred.rel.filter(
            (
              value,
            ): value is string =>
              typeof value ===
              "string",
          )
        : [],
    },
  ];
}

function findTeeTimeStatistic(
  statisticsValue: unknown,
) {
  const statistics =
    typeof statisticsValue ===
      "object" &&
    statisticsValue !== null
      ? statisticsValue as UnknownRecord
      : {};

  const categories =
    safeArray(
      statistics.categories,
    );

  for (
    const category of categories
  ) {
    const stats =
      safeArray(category.stats);

    const namedTeeTime =
      stats.find((stat) => {
        const name = [
          stat.name,
          stat.label,
          stat.abbreviation,
        ]
          .filter(
            (value) =>
              typeof value ===
              "string",
          )
          .join(" ")
          .toLowerCase();

        return (
          name.includes("tee") &&
          typeof stat.displayValue ===
            "string" &&
          stat.displayValue.trim()
        );
      });

    if (namedTeeTime) {
      return {
        categories: [
          {
            name:
              typeof category.name ===
              "string"
                ? category.name
                : undefined,
            displayName:
              typeof category.displayName ===
              "string"
                ? category.displayName
                : undefined,
            stats: [
              {
                name:
                  namedTeeTime.name,
                label:
                  namedTeeTime.label,
                abbreviation:
                  namedTeeTime.abbreviation,
                value:
                  namedTeeTime.value,
                displayValue:
                  namedTeeTime.displayValue,
              },
            ],
          },
        ],
      };
    }
  }

  /*
   * Preserve ESPN's unnamed final-stat fallback used
   * by the server-side tee-time parser.
   */
  for (
    const category of categories
  ) {
    const stats =
      safeArray(category.stats);

    const finalStat =
      stats.at(-1);

    if (
      finalStat &&
      finalStat.value ===
        undefined &&
      typeof finalStat.displayValue ===
        "string" &&
      finalStat.displayValue.trim()
    ) {
      return {
        categories: [
          {
            name:
              typeof category.name ===
              "string"
                ? category.name
                : undefined,
            displayName:
              typeof category.displayName ===
              "string"
                ? category.displayName
                : undefined,
            stats: [
              {
                displayValue:
                  finalStat.displayValue,
              },
            ],
          },
        ],
      };
    }
  }

  return undefined;
}

function trimHole(
  hole: UnknownRecord,
) {
  const scoreType =
    typeof hole.scoreType ===
      "object" &&
    hole.scoreType !== null
      ? hole.scoreType as UnknownRecord
      : {};

  return {
    value:
      typeof hole.value ===
      "number"
        ? hole.value
        : undefined,
    displayValue:
      typeof hole.displayValue ===
      "string"
        ? hole.displayValue
        : undefined,
    period:
      typeof hole.period ===
      "number"
        ? hole.period
        : undefined,
    scoreType: {
      displayValue:
        typeof scoreType.displayValue ===
        "string"
          ? scoreType.displayValue
          : undefined,
    },
  };
}

function trimRound(
  round: UnknownRecord,
) {
  return {
    value:
      typeof round.value ===
      "number"
        ? round.value
        : undefined,
    displayValue:
      typeof round.displayValue ===
      "string"
        ? round.displayValue
        : undefined,
    period:
      typeof round.period ===
      "number"
        ? round.period
        : undefined,
    linescores:
      safeArray(
        round.linescores,
      ).map(trimHole),
    statistics:
      findTeeTimeStatistic(
        round.statistics,
      ),
  };
}

function trimCompetitor(
  competitor: UnknownRecord,
) {
  const athlete =
    typeof competitor.athlete ===
      "object" &&
    competitor.athlete !== null
      ? competitor.athlete as UnknownRecord
      : {};

  const flag =
    typeof athlete.flag ===
      "object" &&
    athlete.flag !== null
      ? athlete.flag as UnknownRecord
      : {};

  return {
    id:
      competitor.id,
    order:
      typeof competitor.order ===
      "number"
        ? competitor.order
        : undefined,
    score:
      typeof competitor.score ===
      "string"
        ? competitor.score
        : undefined,
    athlete: {
      displayName:
        typeof athlete.displayName ===
        "string"
          ? athlete.displayName
          : undefined,
      fullName:
        typeof athlete.fullName ===
        "string"
          ? athlete.fullName
          : undefined,
      shortName:
        typeof athlete.shortName ===
        "string"
          ? athlete.shortName
          : undefined,
      flag: {
        href:
          typeof flag.href ===
          "string"
            ? flag.href
            : undefined,
        alt:
          typeof flag.alt ===
          "string"
            ? flag.alt
            : undefined,
      },
      links:
        selectPlayerLink(
          athlete.links,
        ),
    },
    linescores:
      safeArray(
        competitor.linescores,
      ).map(trimRound),
  };
}

function createCompactScoreboard(
  rawScoreboard: unknown,
  eventId: string,
) {
  const root =
    typeof rawScoreboard ===
      "object" &&
    rawScoreboard !== null
      ? rawScoreboard as UnknownRecord
      : {};

  const event =
    safeArray(root.events)
      .find(
        (row) =>
          String(row.id ?? "") ===
          String(eventId),
      );

  if (!event) {
    throw new Error(
      "ESPN returned the scoreboard, but the selected tournament was not found.",
    );
  }

  return {
    events: [
      {
        id: event.id,
        date:
          event.date,
        endDate:
          event.endDate,
        name:
          event.name,
        shortName:
          event.shortName,
        status:
          trimStatus(
            event.status,
          ),
        competitions:
          safeArray(
            event.competitions,
          ).slice(0, 1).map(
            (competition) => ({
              status:
                trimStatus(
                  competition.status,
                ),
              competitors:
                safeArray(
                  competition.competitors,
                ).map(
                  trimCompetitor,
                ),
            }),
          ),
      },
    ],
  };
}

export async function refreshGolfFromBrowser(
  slateId: number,
): Promise<GolfRefreshResult> {
  if (
    !Number.isInteger(slateId) ||
    slateId <= 0
  ) {
    throw new Error(
      "A valid Golf slate ID is required.",
    );
  }

  const configResponse =
    await fetch(
      `/api/golf/refresh-config?slateId=${encodeURIComponent(
        slateId,
      )}`,
      {
        cache: "no-store",
        credentials:
          "same-origin",
      },
    );

  const configResult =
    await readJsonSafely(
      configResponse,
    );

  if (!configResponse.ok) {
    throw new Error(
      String(
        configResult.error ??
          "Unable to load the Golf refresh configuration.",
      ),
    );
  }

  const config =
    configResult as unknown as GolfRefreshConfig;

  if (
    !config.eventId ||
    !config.year
  ) {
    throw new Error(
      "The Golf slate is missing its ESPN event information.",
    );
  }

  const espnUrl =
    "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard" +
    `?dates=${encodeURIComponent(
      config.year,
    )}` +
    `&event=${encodeURIComponent(
      config.eventId,
    )}`;

  const espnResponse =
    await fetch(
      espnUrl,
      {
        cache: "no-store",
        headers: {
          Accept:
            "application/json, text/plain, */*",
        },
      },
    );

  if (!espnResponse.ok) {
    throw new Error(
      `ESPN Golf request failed with ${espnResponse.status} ${espnResponse.statusText}.`,
    );
  }

  const rawScoreboard: unknown =
    await espnResponse.json();

  const scoreboardPayload =
    createCompactScoreboard(
      rawScoreboard,
      config.eventId,
    );

  const requestBody =
    JSON.stringify({
      slateId,
      scoreboardPayload,
    });

  console.log(
    "Compact Golf payload:",
    Math.round(
      new Blob([
        requestBody,
      ]).size / 1024,
    ),
    "KB",
  );

  const ingestionResponse =
    await fetch(
      "/api/refresh-stats-golf",
      {
        method: "POST",
        credentials:
          "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: requestBody,
      },
    );

  const ingestionResult =
    await readJsonSafely(
      ingestionResponse,
    );

  if (!ingestionResponse.ok) {
    throw new Error(
      String(
        ingestionResult.error ??
          `Golf refresh failed with HTTP ${ingestionResponse.status}.`,
      ),
    );
  }

  return ingestionResult as GolfRefreshResult;
}
