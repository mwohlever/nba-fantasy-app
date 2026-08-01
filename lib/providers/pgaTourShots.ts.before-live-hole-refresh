import "server-only";

import { gunzipSync } from "node:zlib";
import { unstable_cache } from "next/cache";

const PGA_GRAPHQL_URL =
  "https://orchestrator.pgatour.com/graphql";

const PGA_REST_URL =
  "https://data-api.pgatour.com";

/**
 * This is the public web-client key currently used by PGATOUR.com.
 * PGA_TOUR_API_KEY can override it if PGA TOUR rotates the key.
 */
const DEFAULT_PGA_API_KEY =
  "da2-gsrx5bibzbb4njvhl7t37wqyl4";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

type JsonObject = Record<string, unknown>;

type PgaScheduleTournament = {
  tournamentId?: string | null;
  name?: string | null;
};

type PgaPlayer = {
  id?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type PgaCoordinate = {
  x: number | null;
  y: number | null;
  tourcastX: number | null;
  tourcastY: number | null;
  tourcastZ: number | null;
};

type RawShotCoordinateGroup = {
  fromCoords?: Partial<PgaCoordinate> | null;
  toCoords?: Partial<PgaCoordinate> | null;
};

type RawStroke = {
  strokeNumber?: number | null;
  playByPlay?: string | null;
  distance?: string | null;
  distanceRemaining?: string | null;
  strokeType?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  fromLocationCode?: string | null;
  toLocationCode?: string | null;
  finalStroke?: boolean | null;
  overview?: {
    leftToRightCoords?: RawShotCoordinateGroup | null;
    bottomToTopCoords?: RawShotCoordinateGroup | null;
  } | null;
};

type RawHole = {
  holeNumber?: number | null;
  par?: number | null;
  yardage?: number | null;
  status?: string | null;
  score?: string | number | null;
  strokes?: RawStroke[] | null;
};

type RawShotPayload = {
  holes?: RawHole[] | null;
};

export type GolfShotCoordinateSet = {
  from: PgaCoordinate;
  to: PgaCoordinate;
};

export type GolfHoleReplayShot = {
  strokeNumber: number;
  playByPlay: string | null;
  distance: string | null;
  distanceRemaining: string | null;
  strokeType: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  fromLocationCode: string | null;
  toLocationCode: string | null;
  finalStroke: boolean;
  leftToRight: GolfShotCoordinateSet | null;
  bottomToTop: GolfShotCoordinateSet | null;
};

export type GolfHoleReplay = {
  tournamentId: string;
  pgaPlayerId: string;
  playerName: string;
  roundNumber: number;
  holeNumber: number;
  par: number | null;
  yardage: number | null;
  holeStatus: string | null;
  holeScore: string | null;
  shots: GolfHoleReplayShot[];
};

function apiKey() {
  return (
    process.env.PGA_TOUR_API_KEY?.trim() ||
    DEFAULT_PGA_API_KEY
  );
}

function requestHeaders() {
  return {
    Accept:
      "application/graphql-response+json, application/json",
    "Content-Type": "application/json",
    "x-api-key": apiKey(),
    "x-pgat-platform": "web",
    Origin: "https://www.pgatour.com",
    Referer: "https://www.pgatour.com/",
    "User-Agent": "111 Sports",
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds),
  );
}

async function requestJson(
  url: string,
  init: RequestInit,
  context: string,
): Promise<JsonObject> {
  let lastError: unknown = null;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...requestHeaders(),
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
        cache: "no-store",
      });

      const bodyText = await response.text();

      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;

        if (
          retryable &&
          attempt < MAX_ATTEMPTS
        ) {
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }

        throw new Error(
          `${context} failed (${response.status}): ` +
            bodyText.slice(0, 250),
        );
      }

      try {
        return JSON.parse(bodyText) as JsonObject;
      } catch {
        throw new Error(
          `${context} returned invalid JSON: ` +
            bodyText.slice(0, 250),
        );
      }
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_ATTEMPTS) {
        break;
      }

      await sleep(300 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `${context} failed after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error
        ? lastError.message
        : String(lastError)
    }`,
  );
}

async function graphqlRequest(
  operationName: string,
  query: string,
  variables: JsonObject,
) {
  const body = await requestJson(
    PGA_GRAPHQL_URL,
    {
      method: "POST",
      body: JSON.stringify({
        operationName,
        query,
        variables,
      }),
    },
    `PGA TOUR ${operationName}`,
  );

  const errors = Array.isArray(body.errors)
    ? body.errors
    : [];

  if (errors.length > 0) {
    const message = errors
      .map((error) => {
        if (
          error &&
          typeof error === "object" &&
          "message" in error
        ) {
          return String(error.message);
        }

        return String(error);
      })
      .join("; ");

    throw new Error(
      `PGA TOUR GraphQL error: ${message}`,
    );
  }

  return (
    body.data &&
    typeof body.data === "object"
      ? body.data
      : {}
  ) as JsonObject;
}

function decompressPayload<T>(
  payload: unknown,
): T {
  if (
    typeof payload !== "string" ||
    payload.length === 0
  ) {
    throw new Error(
      "PGA TOUR returned an empty compressed payload.",
    );
  }

  const compressed = Buffer.from(
    payload,
    "base64",
  );

  const decompressed = gunzipSync(
    compressed,
  ).toString("utf8");

  return JSON.parse(decompressed) as T;
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function chooseBestNameMatch<T>(
  rows: T[],
  target: string,
  getName: (row: T) => string,
) {
  const normalizedTarget =
    normalizeName(target);

  const exact = rows.find(
    (row) =>
      normalizeName(getName(row)) ===
      normalizedTarget,
  );

  if (exact) return exact;

  const targetTokens = new Set(
    normalizedTarget.split(" "),
  );

  return (
    rows
      .map((row) => {
        const normalized =
          normalizeName(getName(row));

        const tokens =
          normalized.split(" ");

        const overlap = tokens.filter(
          (token) => targetTokens.has(token),
        ).length;

        return {
          row,
          score:
            overlap * 10 -
            Math.abs(
              normalized.length -
                normalizedTarget.length,
            ),
        };
      })
      .sort(
        (a, b) => b.score - a.score,
      )[0]?.row ?? null
  );
}

function coordinate(
  value:
    | Partial<PgaCoordinate>
    | null
    | undefined,
): PgaCoordinate {
  function numberOrNull(input: unknown) {
    const numeric = Number(input);

    return Number.isFinite(numeric)
      ? numeric
      : null;
  }

  return {
    x: numberOrNull(value?.x),
    y: numberOrNull(value?.y),
    tourcastX: numberOrNull(
      value?.tourcastX,
    ),
    tourcastY: numberOrNull(
      value?.tourcastY,
    ),
    tourcastZ: numberOrNull(
      value?.tourcastZ,
    ),
  };
}

function coordinateSet(
  value:
    | RawShotCoordinateGroup
    | null
    | undefined,
): GolfShotCoordinateSet | null {
  if (
    !value?.fromCoords ||
    !value?.toCoords
  ) {
    return null;
  }

  return {
    from: coordinate(value.fromCoords),
    to: coordinate(value.toCoords),
  };
}

const loadSchedule = unstable_cache(
  async (year: number) => {
    const body = await requestJson(
      `${PGA_REST_URL}/schedule/R/${year}`,
      {
        method: "GET",
      },
      `PGA TOUR ${year} schedule`,
    );

    return Array.isArray(body.tournaments)
      ? (body.tournaments as PgaScheduleTournament[])
      : [];
  },
  ["pga-tour-schedule-v1"],
  {
    revalidate: 60 * 60,
  },
);

const loadPlayers = unstable_cache(
  async () => {
    const body = await requestJson(
      `${PGA_REST_URL}/player/list/R`,
      {
        method: "GET",
      },
      "PGA TOUR player directory",
    );

    return Array.isArray(body.players)
      ? (body.players as PgaPlayer[])
      : [];
  },
  ["pga-tour-player-directory-v1"],
  {
    revalidate: 24 * 60 * 60,
  },
);

const loadRoundShots = unstable_cache(
  async (
    tournamentId: string,
    pgaPlayerId: string,
    roundNumber: number,
  ) => {
    const operationName =
      "shotDetailsV4Compressed";

    const query =
      "query shotDetailsV4Compressed(" +
      "$tournamentId: ID!, " +
      "$playerId: ID!, " +
      "$round: Int!, " +
      "$includeRadar: Boolean" +
      ") { " +
      "shotDetailsV4Compressed(" +
      "tournamentId: $tournamentId, " +
      "playerId: $playerId, " +
      "round: $round, " +
      "includeRadar: $includeRadar" +
      ") { id payload } }";

    const data = await graphqlRequest(
      operationName,
      query,
      {
        tournamentId,
        playerId: pgaPlayerId,
        round: roundNumber,
        includeRadar: false,
      },
    );

    const response =
      data.shotDetailsV4Compressed;

    if (
      !response ||
      typeof response !== "object" ||
      !("payload" in response)
    ) {
      return {
        holes: [],
      } satisfies RawShotPayload;
    }

    return decompressPayload<RawShotPayload>(
      response.payload,
    );
  },
  ["pga-tour-round-shots-v1"],
  {
    // Live holes can change, but repeated taps should not
    // hammer the upstream API.
    revalidate: 120,
  },
);

export async function fetchGolfHoleReplay(
  input: {
    year: number;
    tournamentName: string;
    playerName: string;
    roundNumber: number;
    holeNumber: number;
  },
): Promise<GolfHoleReplay | null> {
  const tournaments = await loadSchedule(
    input.year,
  );

  const tournament = chooseBestNameMatch(
    tournaments.filter(
      (row) =>
        typeof row.tournamentId ===
          "string" &&
        typeof row.name === "string",
    ),
    input.tournamentName,
    (row) => row.name ?? "",
  );

  const tournamentId =
    tournament?.tournamentId?.trim();

  if (!tournamentId) {
    throw new Error(
      `Could not match "${input.tournamentName}" ` +
        `to the PGA TOUR ${input.year} schedule.`,
    );
  }

  const players = await loadPlayers();

  const player = chooseBestNameMatch(
    players.filter(
      (row) =>
        typeof row.id === "string" &&
        typeof row.displayName === "string",
    ),
    input.playerName,
    (row) => row.displayName ?? "",
  );

  const pgaPlayerId =
    player?.id?.trim();

  if (!pgaPlayerId) {
    throw new Error(
      `Could not match "${input.playerName}" ` +
        "to the PGA TOUR player directory.",
    );
  }

  const payload = await loadRoundShots(
    tournamentId,
    pgaPlayerId,
    input.roundNumber,
  );

  const hole = (payload.holes ?? []).find(
    (row) =>
      Number(row.holeNumber) ===
      input.holeNumber,
  );

  if (!hole) {
    return null;
  }

  const shots = (hole.strokes ?? [])
    .map((shot) => ({
      strokeNumber: Number(
        shot.strokeNumber ?? 0,
      ),
      playByPlay:
        shot.playByPlay ?? null,
      distance:
        shot.distance ?? null,
      distanceRemaining:
        shot.distanceRemaining ?? null,
      strokeType:
        shot.strokeType ?? null,
      fromLocation:
        shot.fromLocation ?? null,
      toLocation:
        shot.toLocation ?? null,
      fromLocationCode:
        shot.fromLocationCode ?? null,
      toLocationCode:
        shot.toLocationCode ?? null,
      finalStroke:
        Boolean(shot.finalStroke),
      leftToRight: coordinateSet(
        shot.overview?.leftToRightCoords,
      ),
      bottomToTop: coordinateSet(
        shot.overview?.bottomToTopCoords,
      ),
    }))
    .filter(
      (shot) => shot.strokeNumber > 0,
    )
    .sort(
      (a, b) =>
        a.strokeNumber -
        b.strokeNumber,
    );

  return {
    tournamentId,
    pgaPlayerId,
    playerName:
      player?.displayName ??
      input.playerName,
    roundNumber: input.roundNumber,
    holeNumber: input.holeNumber,
    par:
      hole.par === null ||
      hole.par === undefined
        ? null
        : Number(hole.par),
    yardage:
      hole.yardage === null ||
      hole.yardage === undefined
        ? null
        : Number(hole.yardage),
    holeStatus:
      hole.status ?? null,
    holeScore:
      hole.score === null ||
      hole.score === undefined
        ? null
        : String(hole.score),
    shots,
  };
}
