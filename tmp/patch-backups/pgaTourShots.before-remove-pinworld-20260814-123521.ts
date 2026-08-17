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

  /*
   * TOURCAST V3 supplies these normalized coordinates
   * specifically for the matching enhancedPickle image.
   */
  enhancedX?: number | null;
  enhancedY?: number | null;
};

type RawShotCoordinateGroup = {
  fromCoords?: Partial<PgaCoordinate> | null;
  toCoords?: Partial<PgaCoordinate> | null;
};

type RawRadarTrajectory = {
  carry?: number | null;
  carrySide?: number | null;
  maxHeight?: number | null;
  curve?: number | null;
  spinAxis?: number | null;
  valid?: boolean | null;
};

type RawRadarData = {
  apexHeight?: number | null;
  apexRange?: number | null;
  apexSide?: number | null;
  clubSpeed?: number | null;
  ballSpeed?: number | null;
  smashFactor?: number | null;
  launchSpin?: number | null;
  spinAxis?: number | null;
  verticalLaunchAngle?: number | null;
  horizontalLaunchAngle?: number | null;
  actualFlightTime?: number | null;
  ballImpactMeasured?: string | null;

  normalizedTrajectory?: RawRadarTrajectory[] | null;
  normalizedTrajectoryV2?: RawRadarTrajectory[] | null;

  /*
   * Keep the polynomial trajectory payload available for the
   * next ShotCast phase without making the UI depend on it yet.
   */
  ballTrajectory?: unknown[] | null;
};

type RawBallPathPoint = {
  x?: number | null;
  y?: number | null;
  z?: number | null;
  secondsSinceStart?: number | null;
};

type RawBallPath = {
  isLipOut?: boolean | null;
  path?: RawBallPathPoint[] | null;
  reconstructionType?: string | null;
  totalDistanceInches?: number | null;
};

type RawStroke = {
  strokeNumber?: number | null;

  /*
   * PGA TOURCAST's native shot position.
   *
   * Their Golf Engine constructs each shot as:
   *   position = new Vector3(shot.x, shot.y, 0)
   *
   * Do not confuse these with overview.bottomToTopCoords
   * or overview.*.tourcastX/tourcastY.
   */
  x?: number | null;
  y?: number | null;
  z?: number | null;

  playByPlay?: string | null;
  distance?: string | null;
  distanceRemaining?: string | null;
  strokeType?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  fromLocationCode?: string | null;
  toLocationCode?: string | null;
  finalStroke?: boolean | null;

  /*
   * TOURCAST V3 enrichments.
   */
  videoId?: string | null;
  radarData?: RawRadarData | null;
  ballPath?: RawBallPath | null;

  overview?: {
    leftToRightCoords?: RawShotCoordinateGroup | null;
    bottomToTopCoords?: RawShotCoordinateGroup | null;
  } | null;

  /*
   * TOURCAST V3 also provides a second coordinate frame
   * specifically for the dedicated Green View image.
   */
  green?: {
    leftToRightCoords?: RawShotCoordinateGroup | null;
    bottomToTopCoords?: RawShotCoordinateGroup | null;
  } | null;
};

type RawWorldPoint = {
  x?: number | null;
  y?: number | null;
  z?: number | null;
};

type RawEnhancedPickle = {
  leftToRight?: string | null;
  bottomToTop?: string | null;
  greenLeftToRight?: string | null;
  greenBottomToTop?: string | null;
};

type RawHole = {
  holeNumber?: number | null;
  par?: number | null;
  yardage?: number | null;
  status?: string | null;
  score?: string | number | null;

  /*
   * TOURCAST uses the player/hole tee and pin positions
   * as world-coordinate endpoints surrounding the shots.
   */
  tee?: RawWorldPoint | null;
  pin?: RawWorldPoint | null;

  enhancedPickle?: RawEnhancedPickle | null;

  strokes?: RawStroke[] | null;
};

type RawShotPayload = {
  holes?: RawHole[] | null;
};

export type GolfShotCoordinateSet = {
  from: PgaCoordinate;
  to: PgaCoordinate;
};

export type GolfWorldPoint = {
  x: number;
  y: number;
  z: number | null;
};

export type GolfShotRadarData = {
  apexHeight: number | null;
  clubSpeed: number | null;
  ballSpeed: number | null;
  smashFactor: number | null;
  launchSpin: number | null;
  spinAxis: number | null;
  verticalLaunchAngle: number | null;
  horizontalLaunchAngle: number | null;
  actualFlightTime: number | null;
  carry: number | null;
  carrySide: number | null;
};

export type GolfBallPathPoint = {
  x: number;
  y: number;
  z: number | null;
  secondsSinceStart: number;
};

export type GolfBallPath = {
  isLipOut: boolean;
  reconstructionType: string | null;
  totalDistanceInches: number | null;
  path: GolfBallPathPoint[];
};

export type GolfHoleReplayShot = {
  strokeNumber: number;

  /*
   * Native PGA TOURCAST world positions.
   *
   * worldFrom is the tee for shot 1 and the previous
   * landing position after that.
   *
   * worldTo is this stroke's raw PGA x/y position.
   */
  worldFrom: GolfWorldPoint | null;
  worldTo: GolfWorldPoint | null;

  playByPlay: string | null;
  distance: string | null;
  distanceRemaining: string | null;
  strokeType: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  fromLocationCode: string | null;
  toLocationCode: string | null;
  finalStroke: boolean;

  /*
   * Rich TOURCAST shot data.
   */
  videoId: string | null;
  radarData: GolfShotRadarData | null;
  ballPath: GolfBallPath | null;

  leftToRight: GolfShotCoordinateSet | null;
  bottomToTop: GolfShotCoordinateSet | null;

  /*
   * Same stroke projected onto PGA's dedicated green image.
   * May be null for shots that are nowhere near the green.
   */
  greenBottomToTop:
    GolfShotCoordinateSet | null;
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

  /*
   * PGA's actual pin in native TOURCAST world coordinates.
   * This exists independently of whether the golfer has
   * completed the hole.
   */
  pinWorld: GolfWorldPoint | null;

  /*
   * PGA TOURCAST V3 supplies a hole image and coordinates
   * that already share the same normalized coordinate frame.
   *
   * No terrain TFW calibration is required for this path.
   */
  shotcast: {
    imageUrl: string;

    /*
     * Purpose-built PGA Green View crop.
     * Coordinates come from stroke.green.bottomToTopCoords.
     */
    greenImageUrl: string | null;

    orientation: "bottomToTop";
    source: "pga-tourcast-v3-enhanced";
    verified: true;
  } | null;

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

  const enhancedX =
    numberOrNull(
      value?.enhancedX,
    );

  const enhancedY =
    numberOrNull(
      value?.enhancedY,
    );

  return {
    /*
     * IMPORTANT:
     *
     * When TOURCAST V3 supplies enhanced coordinates,
     * those coordinates correspond directly to the
     * enhancedPickle image returned for the same hole.
     *
     * Preserve legacy x/y only as fallback.
     */
    x:
      enhancedX !== null
        ? enhancedX
        : numberOrNull(value?.x),

    y:
      enhancedY !== null
        ? enhancedY
        : numberOrNull(value?.y),

    tourcastX: numberOrNull(
      value?.tourcastX,
    ),
    tourcastY: numberOrNull(
      value?.tourcastY,
    ),
    tourcastZ: numberOrNull(
      value?.tourcastZ,
    ),

    enhancedX,
    enhancedY,
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

function finiteNumber(
  value: unknown,
): number | null {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

function radarData(
  value: RawRadarData | null | undefined,
): GolfShotRadarData | null {
  if (!value) {
    return null;
  }

  const normalized =
    value.normalizedTrajectoryV2?.find(
      (row) => row?.valid !== false,
    ) ??
    value.normalizedTrajectory?.find(
      (row) => row?.valid !== false,
    ) ??
    null;

  const result: GolfShotRadarData = {
    apexHeight:
      finiteNumber(value.apexHeight),
    clubSpeed:
      finiteNumber(value.clubSpeed),
    ballSpeed:
      finiteNumber(value.ballSpeed),
    smashFactor:
      finiteNumber(value.smashFactor),
    launchSpin:
      finiteNumber(value.launchSpin),
    spinAxis:
      finiteNumber(value.spinAxis),
    verticalLaunchAngle:
      finiteNumber(
        value.verticalLaunchAngle,
      ),
    horizontalLaunchAngle:
      finiteNumber(
        value.horizontalLaunchAngle,
      ),
    actualFlightTime:
      finiteNumber(
        value.actualFlightTime,
      ),
    carry:
      finiteNumber(
        normalized?.carry,
      ),
    carrySide:
      finiteNumber(
        normalized?.carrySide,
      ),
  };

  /*
   * PGA sometimes sends zeroes for measurements that were not
   * actually captured (for example club speed on an approach).
   * Preserve them here; the UI decides whether a value is useful.
   */
  return result;
}

function ballPath(
  value: RawBallPath | null | undefined,
): GolfBallPath | null {
  if (!value?.path?.length) {
    return null;
  }

  const points =
    value.path
      .map((point) => {
        const x =
          finiteNumber(point.x);
        const y =
          finiteNumber(point.y);
        const secondsSinceStart =
          finiteNumber(
            point.secondsSinceStart,
          );

        if (
          x === null ||
          y === null ||
          secondsSinceStart === null
        ) {
          return null;
        }

        return {
          x,
          y,
          z:
            finiteNumber(point.z),
          secondsSinceStart,
        };
      })
      .filter(
        (
          point,
        ): point is GolfBallPathPoint =>
          point !== null,
      );

  if (points.length < 2) {
    return null;
  }

  return {
    isLipOut:
      Boolean(value.isLipOut),
    reconstructionType:
      value.reconstructionType ??
      null,
    totalDistanceInches:
      finiteNumber(
        value.totalDistanceInches,
      ),
    path: points,
  };
}

function highResolutionTourcastUrl(
  value: string,
) {
  /*
   * PGA currently returns its enhanced TOURCAST portrait
   * image with a Cloudinary width transform of w_500.
   *
   * The underlying source supports a substantially larger
   * render, so request a sharper version for pinch/zoom.
   */
  return value.replace(
    /\bw_500\b/,
    "w_3200",
  );
}

function worldPoint(
  value:
    | RawWorldPoint
    | RawStroke
    | null
    | undefined,
): GolfWorldPoint | null {
  const x = Number(value?.x);
  const y = Number(value?.y);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }

  const z = Number(value?.z);

  return {
    x,
    y,
    z: Number.isFinite(z)
      ? z
      : null,
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
    _cacheBust: string | null,
  ) => {
    /*
     * Use the same compressed shot model consumed by
     * PGA TOURCAST itself.
     *
     * V3 includes:
     * - enhancedPickle hole imagery
     * - enhancedX/enhancedY shot coordinates
     * - tee/pin overview coordinates
     * - radar data when available
     */
    const operationName =
      "ShotDetailsCompressedV3";

    const query =
      "query ShotDetailsCompressedV3(" +
      "$tournamentId: ID!, " +
      "$playerId: ID!, " +
      "$round: Int!, " +
      "$includeRadar: Boolean" +
      ") { " +
      "shotDetailsCompressedV3(" +
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
        includeRadar: true,
      },
    );

    const response =
      data.shotDetailsCompressedV3;

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
  ["pga-tour-round-shots-tourcast-v3"],
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
    cacheBust?: string | null;
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
    input.cacheBust ?? null,
  );

  const hole = (payload.holes ?? []).find(
    (row) =>
      Number(row.holeNumber) ===
      input.holeNumber,
  );

  if (!hole) {
    return null;
  }

  const rawStrokeCandidates =
    [...(hole.strokes ?? [])]
      .filter(
        (shot) =>
          Number(shot.strokeNumber ?? 0) > 0,
      );

  function strokeRichness(
    shot: RawStroke,
  ) {
    let score = 0;

    if (
      shot.videoId?.trim()
    ) {
      score += 1000;
    }

    if (
      shot.radarData
        ?.ballTrajectory
        ?.length
    ) {
      score += 500;
    }

    if (
      shot.ballPath
        ?.path
        ?.length
    ) {
      score +=
        200 +
        shot.ballPath.path.length;
    }

    if (shot.radarData) {
      score += 100;
    }

    if (
      shot.green
        ?.bottomToTopCoords
    ) {
      score += 50;
    }

    if (
      shot.overview
        ?.bottomToTopCoords
    ) {
      score += 25;
    }

    if (
      Number.isFinite(
        Number(shot.x),
      ) &&
      Number.isFinite(
        Number(shot.y),
      )
    ) {
      score += 10;
    }

    return score;
  }

  const bestStrokeByNumber =
    new Map<number, RawStroke>();

  for (
    const shot
    of rawStrokeCandidates
  ) {
    const strokeNumber =
      Number(
        shot.strokeNumber ?? 0,
      );

    const existing =
      bestStrokeByNumber.get(
        strokeNumber,
      );

    if (
      !existing ||
      strokeRichness(shot) >
        strokeRichness(existing)
    ) {
      bestStrokeByNumber.set(
        strokeNumber,
        shot,
      );
    }
  }

  const orderedRawStrokes =
    [...bestStrokeByNumber.values()]
      .sort(
        (a, b) =>
          Number(a.strokeNumber ?? 0) -
          Number(b.strokeNumber ?? 0),
      );

  let previousWorldPoint =
    worldPoint(hole.tee);

  const shots = orderedRawStrokes.map(
    (shot) => {
      const landingWorldPoint =
        worldPoint(shot);

      const mappedShot:
        GolfHoleReplayShot = {
        strokeNumber: Number(
          shot.strokeNumber ?? 0,
        ),

        worldFrom:
          previousWorldPoint,

        worldTo:
          landingWorldPoint,

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

        videoId:
          typeof shot.videoId === "string" &&
          shot.videoId.trim()
            ? shot.videoId.trim()
            : null,

        radarData:
          radarData(
            shot.radarData,
          ),


        ballPath:
          ballPath(
            shot.ballPath,
          ),

        leftToRight: coordinateSet(
          shot.overview?.leftToRightCoords,
        ),
        bottomToTop: coordinateSet(
          shot.overview?.bottomToTopCoords,
        ),

        greenBottomToTop:
          coordinateSet(
            shot.green?.bottomToTopCoords,
          ),
      };

      if (landingWorldPoint) {
        previousWorldPoint =
          landingWorldPoint;
      }

      return mappedShot;
    },
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

    /*
     * PGA's authoritative hole pin. Do not infer this from
     * finalStroke.
     */
    pinWorld:
      worldPoint(
        hole.pin,
      ),

    shotcast:
      typeof hole.enhancedPickle
        ?.bottomToTop === "string" &&
      hole.enhancedPickle
        .bottomToTop.trim()
        ? {
            imageUrl:
              highResolutionTourcastUrl(
                hole.enhancedPickle
                  .bottomToTop.trim(),
              ),

            greenImageUrl:
              typeof hole.enhancedPickle
                ?.greenBottomToTop ===
                "string" &&
              hole.enhancedPickle
                .greenBottomToTop
                .trim()
                ? highResolutionTourcastUrl(
                    hole.enhancedPickle
                      .greenBottomToTop
                      .trim(),
                  )
                : null,

            orientation:
              "bottomToTop",
            source:
              "pga-tourcast-v3-enhanced",
            verified: true,
          }
        : null,

    shots,
  };
}
