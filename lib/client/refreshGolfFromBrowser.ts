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
      ? value as Record<
          string,
          unknown
        >
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
   * to this slate. The UI therefore only needs the slate ID.
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

  /*
   * ESPN permits cross-origin browser requests but blocks
   * Vercel and GitHub datacenter traffic. Fetch the official
   * scoreboard directly from the user's device.
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

  const scoreboardPayload: unknown =
    await espnResponse.json();

  const ingestionResponse =
    await fetch(
      "/api/refresh-stats-golf",
      {
        method: "POST",
        credentials: "same-origin",
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
