const PGA_GRAPHQL_URL =
  "https://orchestrator.pgatour.com/graphql";

const DEFAULT_PGA_API_KEY =
  "da2-gsrx5bibzbb4njvhl7t37wqyl4";

const REQUEST_TIMEOUT_MS = 20_000;

type ImportOptions = {
  tournamentId: string;
  round?: number;
};

type AssetReference = {
  imageOrg: string | null;
  imagePath: string | null;
  resolvedUrl: string | null;
} | null;

function numberOrNull(value: unknown) {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function cleanAsset(value: any): AssetReference {
  if (!value || typeof value !== "object") {
    return null;
  }

  const imageOrg =
    typeof value.imageOrg === "string"
      ? value.imageOrg.trim()
      : "";

  const imagePath =
    typeof value.imagePath === "string"
      ? value.imagePath.trim()
      : "";

  if (!imageOrg && !imagePath) {
    return null;
  }

  return {
    imageOrg: imageOrg || null,
    imagePath: imagePath || null,
    resolvedUrl: null,
  };
}

function cleanCoordinate(value: any) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    x: numberOrNull(value.x),
    y: numberOrNull(value.y),
    z: numberOrNull(value.z),
    tourcastX: numberOrNull(value.tourcastX),
    tourcastY: numberOrNull(value.tourcastY),
    tourcastZ: numberOrNull(value.tourcastZ),
  };
}

function cleanPinGreen(value: any) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    leftToRight:
      cleanCoordinate(
        value.leftToRightCoords,
      ),
    bottomToTop:
      cleanCoordinate(
        value.bottomToTopCoords,
      ),
  };
}

function requestHeaders() {
  return {
    Accept:
      "application/graphql-response+json, application/json",
    "Content-Type": "application/json",
    "x-api-key":
      process.env.PGA_TOUR_API_KEY?.trim() ||
      DEFAULT_PGA_API_KEY,
    "x-pgat-platform": "web",
    Origin: "https://www.pgatour.com",
    Referer: "https://www.pgatour.com/",
    "User-Agent": "111 Sports",
  };
}

async function graphqlRequest(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      PGA_GRAPHQL_URL,
      {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({
          operationName,
          query,
          variables,
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const text = await response.text();

    let body: any;

    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `PGA TOUR returned invalid JSON (${response.status}).`,
      );
    }

    if (
      !response.ok ||
      body.errors?.length
    ) {
      const details =
        body.errors
          ?.map(
            (error: any) =>
              error?.message ||
              String(error),
          )
          .join("; ") ||
        text.slice(0, 300);

      throw new Error(
        `${operationName} failed: ${details}`,
      );
    }

    return body.data ?? {};
  } finally {
    clearTimeout(timeout);
  }
}

type TourcastWorldFile = {
  pxX: number;
  rotX: number;
  rotY: number;
  pxY: number;
  coordX: number;
  coordY: number;
  dimX: number;
  dimY: number;
};

function tourcastTerrainUrls(
  tournamentId: string,
  holeNumber: number,
) {
  const holeToken =
    String(holeNumber).padStart(2, "0");

  const root =
    `https://tourcast.pgatour.com/models/` +
    `${tournamentId}/3D_Assets/terrain`;

  return {
    imageUrl:
      `${root}/terrain${holeToken}.jpg`,
    worldFileUrl:
      `${root}/terrain${holeToken}.tfw`,
    glbUrl:
      `${root}/cutGlb/terrain${holeToken}.glb`,
  };
}

function parseTourcastWorldFile(
  raw: string,
): TourcastWorldFile | null {
  const values = raw
    .trim()
    .split(/\s+/)
    .map(Number);

  if (
    values.length < 8 ||
    values
      .slice(0, 8)
      .some((value) => !Number.isFinite(value))
  ) {
    return null;
  }

  const [
    pxX,
    rotX,
    rotY,
    pxY,
    coordX,
    coordY,
    dimX,
    dimY,
  ] = values;

  const determinant =
    pxX * pxY -
    rotY * rotX;

  if (
    Math.abs(determinant) < 1e-12 ||
    dimX <= 0 ||
    dimY <= 0
  ) {
    return null;
  }

  return {
    pxX,
    rotX,
    rotY,
    pxY,
    coordX,
    coordY,
    dimX,
    dimY,
  };
}

async function loadTourcastWorldFile(
  tournamentId: string,
  holeNumber: number,
): Promise<TourcastWorldFile | null> {
  const { worldFileUrl } =
    tourcastTerrainUrls(
      tournamentId,
      holeNumber,
    );

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    8_000,
  );

  try {
    const response = await fetch(
      worldFileUrl,
      {
        method: "GET",
        headers: {
          Accept: "*/*",
          Referer:
            `https://tourcast.pgatour.com/` +
            `tourcast.html?id=${tournamentId}`,
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/150.0.0.0 Mobile Safari/537.36",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "Sec-CH-UA":
            '"Not;A=Brand";v="8", ' +
            '"Chromium";v="150", ' +
            '"Google Chrome";v="150"',
          "Sec-CH-UA-Mobile": "?1",
          "Sec-CH-UA-Platform": '"Android"',
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.warn(
        `[ShotCast] Hole ${holeNumber} TFW returned ` +
        `${response.status}: ${worldFileUrl}`,
      );
      return null;
    }

    const raw =
      await response.text();

    const parsed =
      parseTourcastWorldFile(raw);

    if (!parsed) {
      console.warn(
        `[ShotCast] Hole ${holeNumber} TFW could not be parsed.`,
      );
    } else {
      console.log(
        `[ShotCast] Hole ${holeNumber} TFW loaded.`,
      );
    }

    return parsed;
  } catch (error) {
    console.warn(
      `[ShotCast] Hole ${holeNumber} TFW request failed:`,
      error,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function imageIsAvailable(
  url: string | null,
) {
  if (!url) return false;

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    8_000,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/*",
        Range: "bytes=0-0",
        Referer:
          "https://www.pgatour.com/",
        "User-Agent": "111 Sports",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    return (
      response.ok &&
      (
        response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("image/") ??
        false
      )
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const LEADERBOARD_QUERY = `
  query LeaderboardHoleByHole(
    $tournamentId: ID!,
    $round: Int!
  ) {
    leaderboardHoleByHole(
      tournamentId: $tournamentId,
      round: $round
    ) {
      tournamentId
      tournamentName
      currentRound
      courses {
        id
        courseName
        courseCode
        hostCourse
        scoringLevel
        enabled
      }
      courseHoleHeaders {
        courseId
        holeHeaders {
          holeNumber
          order
          displayValue
          par
        }
      }
    }
  }
`;

const HOLE_DETAILS_QUERY = `
  query HoleDetails(
    $tournamentId: ID!,
    $courseId: ID!,
    $hole: Int!
  ) {
    holeDetails(
      tournamentId: $tournamentId,
      courseId: $courseId,
      hole: $hole
    ) {
      id
      tournamentId
      statsAvailability
      holeNum
      courseId
      holeImage
      holeImageLandscape
      tourcastURI
      tourcastURL
      tourcastURLWeb
      holeInfo {
        holeNum
        par
        yards
        scoringAverageDiff
        aboutThisHole
        rounds
        rank
        holePickle
        holePickleBottomToTop
        holePickleGreenBottomToTop
        greenPickle

        holePickleLeftToRightAsset {
          imageOrg
          imagePath
        }

        holePickleBottomToTopAsset {
          imageOrg
          imagePath
        }

        holePickleGreenLeftToRightAsset {
          imageOrg
          imagePath
        }

        holePickleGreenBottomToTopAsset {
          imageOrg
          imagePath
        }

        pinGreen {
          leftToRightCoords {
            x
            y
            z
            tourcastX
            tourcastY
            tourcastZ
          }

          bottomToTopCoords {
            x
            y
            z
            tourcastX
            tourcastY
            tourcastZ
          }
        }
      }
    }
  }
`;

export async function importShotCastManifest({
  tournamentId,
  round = 1,
}: ImportOptions) {
  const normalizedTournamentId =
    tournamentId.trim().toUpperCase();

  if (
    !/^R\d{7}$/.test(
      normalizedTournamentId,
    )
  ) {
    throw new Error(
      "PGA tournament ID must look like R2026013.",
    );
  }

  if (
    !Number.isInteger(round) ||
    round < 1 ||
    round > 4
  ) {
    throw new Error(
      "Round must be from 1 through 4.",
    );
  }

  const leaderboardData =
    await graphqlRequest(
      "LeaderboardHoleByHole",
      LEADERBOARD_QUERY,
      {
        tournamentId:
          normalizedTournamentId,
        round,
      },
    );

  const leaderboard =
    leaderboardData
      ?.leaderboardHoleByHole;

  if (!leaderboard) {
    throw new Error(
      "PGA TOUR returned no course information.",
    );
  }

  const courses =
    Array.isArray(leaderboard.courses)
      ? leaderboard.courses
      : [];

  const course =
    courses.find(
      (row: any) =>
        row?.hostCourse === true &&
        row?.enabled !== false,
    ) ??
    courses.find(
      (row: any) =>
        row?.enabled !== false,
    ) ??
    courses[0];

  const courseId =
    String(course?.id ?? "").trim();

  if (!courseId) {
    throw new Error(
      "No enabled PGA course was returned.",
    );
  }

  const headerRows =
    (
      Array.isArray(
        leaderboard.courseHoleHeaders,
      )
        ? leaderboard.courseHoleHeaders
        : []
    ).find(
      (row: any) =>
        String(row?.courseId ?? "") ===
        courseId,
    )?.holeHeaders ?? [];

  const headersByHole =
    new Map<number, any>(
      (
        Array.isArray(headerRows)
          ? headerRows
          : []
      )
        .filter((row: any) =>
          Number.isInteger(
            Number(row?.holeNumber),
          ),
        )
        .map((row: any) => [
          Number(row.holeNumber),
          row,
        ]),
    );

  const details = await Promise.all(
    Array.from(
      { length: 18 },
      (_, index) => index + 1,
    ).map(async (holeNumber) => {
      try {
        const holeData =
          await graphqlRequest(
            "HoleDetails",
            HOLE_DETAILS_QUERY,
            {
              tournamentId:
                normalizedTournamentId,
              courseId,
              hole: holeNumber,
            },
          );

        return {
          holeNumber,
          detail:
            holeData?.holeDetails ??
            null,
          error: null,
        };
      } catch (error) {
        return {
          holeNumber,
          detail: null,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        };
      }
    }),
  );

  const holes = await Promise.all(
    details.map(async ({
      holeNumber,
      detail,
      error,
    }) => {
      if (!detail) {
        return {
          holeNumber,
          available: false,
          error:
            error ||
            "No HoleDetails payload returned.",
        };
      }

      const holeInfo =
        detail.holeInfo &&
        typeof detail.holeInfo ===
          "object"
          ? detail.holeInfo
          : {};

      const header =
        headersByHole.get(
          holeNumber,
        );

      const officialImageUrl =
        normalizeUrl(
          detail.holeImageLandscape,
        ) ??
        normalizeUrl(
          detail.holeImage,
        );

      const alignedMapUrl =
        normalizeUrl(
          holeInfo
            .holePickleBottomToTop,
        );

      const alignedGreenUrl =
        normalizeUrl(
          holeInfo
            .holePickleGreenBottomToTop,
        );

      const [
        alignedMapAvailable,
        alignedGreenAvailable,
        tourcastWorldFile,
      ] = await Promise.all([
        imageIsAvailable(
          alignedMapUrl,
        ),
        imageIsAvailable(
          alignedGreenUrl,
        ),
        loadTourcastWorldFile(
          normalizedTournamentId,
          holeNumber,
        ),
      ]);

      const tourcastTerrain =
        tourcastTerrainUrls(
          normalizedTournamentId,
          holeNumber,
        );

      /*
       * Modern PGA TOURCAST:
       *
       * terrainNN.jpg = the overhead terrain image
       * terrainNN.tfw = affine world-file calibration
       *
       * If the TFW exists, the terrain package is authoritative.
       * The older Cloudinary pickle remains as a fallback.
       */
      const hasTourcastTerrain =
        tourcastWorldFile !== null;

      const resolvedAlignedMapUrl =
        hasTourcastTerrain
          ? tourcastTerrain.imageUrl
          : alignedMapAvailable
            ? alignedMapUrl
            : null;

      const calibration =
        tourcastWorldFile
          ? {
              xScale: 1,
              xOffset: 0,
              yScale: 1,
              yOffset: 0,
              verified: true,
              source:
                "pga-tourcast-world-file",
              affine:
                tourcastWorldFile,
            }
          : null;

      return {
        holeNumber,
        available: true,

        detailsId:
          detail.id ?? null,

        statsAvailability:
          detail.statsAvailability ??
          null,

        par: numberOrNull(
          holeInfo.par ??
            header?.par,
        ),

        yards:
          numberOrNull(
            holeInfo.yards,
          ),

        rank:
          numberOrNull(
            holeInfo.rank,
          ),

        scoringAverageDiff:
          numberOrNull(
            holeInfo
              .scoringAverageDiff,
          ),

        aboutThisHole:
          typeof holeInfo
            .aboutThisHole ===
          "string"
            ? holeInfo
                .aboutThisHole
                .trim() || null
            : null,

        officialImageUrl,

        /*
         * The browser may use the official PGA URL directly.
         * No Vercel filesystem write is required.
         */
        localImageUrl:
          officialImageUrl,

        alignedMapUrl:
          resolvedAlignedMapUrl,

        localAlignedMapUrl:
          resolvedAlignedMapUrl,

        alignedMapError:
          !resolvedAlignedMapUrl
            ? "No aligned PGA TOURCAST terrain asset was found."
            : null,

        tourcastTerrain: {
          imageUrl:
            tourcastTerrain.imageUrl,
          worldFileUrl:
            tourcastTerrain.worldFileUrl,
          glbUrl:
            tourcastTerrain.glbUrl,
          available:
            hasTourcastTerrain,
        },

        alignedGreenUrl,

        localAlignedGreenUrl:
          alignedGreenAvailable
            ? alignedGreenUrl
            : null,

        alignedGreenError:
          alignedGreenUrl &&
          !alignedGreenAvailable
            ? "Asset is not currently published."
            : null,

        tourcast: {
          uri:
            normalizeUrl(
              detail.tourcastURI,
            ),
          url:
            normalizeUrl(
              detail.tourcastURL,
            ),
          urlWeb:
            normalizeUrl(
              detail.tourcastURLWeb,
            ),
        },

        assets: {
          leftToRight:
            cleanAsset(
              holeInfo
                .holePickleLeftToRightAsset,
            ),
          bottomToTop:
            cleanAsset(
              holeInfo
                .holePickleBottomToTopAsset,
            ),
          greenLeftToRight:
            cleanAsset(
              holeInfo
                .holePickleGreenLeftToRightAsset,
            ),
          greenBottomToTop:
            cleanAsset(
              holeInfo
                .holePickleGreenBottomToTopAsset,
            ),
        },

        legacyAssets: {
          holePickle:
            normalizeUrl(
              holeInfo.holePickle,
            ),
          holePickleBottomToTop:
            alignedMapUrl,
          holePickleGreenBottomToTop:
            alignedGreenUrl,
          greenPickle:
            normalizeUrl(
              holeInfo.greenPickle,
            ),
        },

        pinGreen:
          cleanPinGreen(
            holeInfo.pinGreen,
          ),

        calibration,
      };
    }),
  );

  const holesAvailable =
    holes.filter(
      (hole) => hole.available,
    ).length;

  const photos =
    holes.filter(
      (hole: any) =>
        hole.available &&
        hole.localImageUrl,
    ).length;

  const alignedMaps =
    holes.filter(
      (hole: any) =>
        hole.available &&
        hole.localAlignedMapUrl,
    ).length;

  const alignedGreens =
    holes.filter(
      (hole: any) =>
        hole.available &&
        hole.localAlignedGreenUrl,
    ).length;

  return {
    schemaVersion: 2,

    generatedAt:
      new Date().toISOString(),

    source:
      "PGA TOUR HoleDetails",

    tournament: {
      id:
        normalizedTournamentId,
      name:
        leaderboard
          .tournamentName ??
        null,
      currentRound:
        numberOrNull(
          leaderboard
            .currentRound,
        ),
      requestedRound: round,
    },

    course: {
      id: courseId,
      name:
        String(
          course?.courseName ??
            "Unknown course",
        ),
      code:
        course?.courseCode ??
        null,
      hostCourse:
        course?.hostCourse === true,
      scoringLevel:
        course?.scoringLevel ??
        null,
      enabled:
        course?.enabled !== false,
    },

    summary: {
      holesRequested: 18,
      holesAvailable,
      localImages: photos,
      alignedMaps,
      alignedGreens,
      holesFailed:
        18 - holesAvailable,
    },

    holes,
  };
}
