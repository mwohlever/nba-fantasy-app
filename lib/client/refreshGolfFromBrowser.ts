"use client";

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
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
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

  /*
   * First ask our own API which ESPN event/year belongs
   * to this slate.
   */
  const configResponse = await fetch(
    `/api/golf/refresh-config?slateId=${encodeURIComponent(
      slateId,
    )}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
  );

  const configResult =
    await readJsonSafely(configResponse);

  if (!configResponse.ok) {
    throw new Error(
      String(
        configResult.error ??
          "Unable to load the Golf refresh configuration.",
      ),
    );
  }

  const config =
    configResult as GolfRefreshConfig;

  if (
    !config.eventId ||
    !config.year
  ) {
    throw new Error(
      "The Golf slate is missing its ESPN event information.",
    );
  }

  /*
   * Browser fetch avoids ESPN blocking cloud providers.
   */
  const espnUrl =
    "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard" +
    `?dates=${encodeURIComponent(config.year)}` +
    `&event=${encodeURIComponent(config.eventId)}`;

  const espnResponse = await fetch(
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

  const rawScoreboard: any =
    await espnResponse.json();

  /*
   * Vercel rejects very large request bodies.
   * Keep ONLY the tournament we're refreshing and the
   * fields our importer actually uses.
   */
  const scoreboardPayload = {
    season: rawScoreboard.season,
    leagues: rawScoreboard.leagues,
    events: (rawScoreboard.events ?? [])
      .filter(
        (event: any) =>
          String(event?.id) ===
          String(config.eventId),
      )
      .map((event: any) => ({
        id: event.id,
        uid: event.uid,
        date: event.date,
        endDate: event.endDate,
        name: event.name,
        shortName: event.shortName,
        season: event.season,
        status: event.status,
        links: event.links,
        competitions:
          (event.competitions ?? []).map(
            (competition: any) => ({
              id: competition.id,
              uid: competition.uid,
              date: competition.date,
              status:
                competition.status,
              broadcasts:
                competition.broadcasts,
              competitors:
                competition.competitors,
            }),
          ),
      })),
  };

  console.log(
    "Golf payload:",
    Math.round(
      JSON.stringify(
        scoreboardPayload,
      ).length / 1024,
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
        body: JSON.stringify({
          slateId,
          scoreboardPayload,
        }),
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
          "The Golf scoreboard could not be processed.",
      ),
    );
  }

  return ingestionResult as GolfRefreshResult;
}
