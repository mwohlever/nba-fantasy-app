import {
  fetchPgaTourCourseIdentity,
} from "@/lib/providers/pgaTourField";

const PGA_GRAPHQL_URL =
  "https://orchestrator.pgatour.com/graphql";

const DEFAULT_PGA_API_KEY =
  "da2-gsrx5bibzbb4njvhl7t37wqyl4";

const REQUEST_TIMEOUT_MS = 20_000;

type CourseHeader = { holeNumber?: number; par?: number | null };
type CourseData = {
  leaderboardHoleByHole?: {
    courses?: Array<{ id?: string; courseName?: string | null; hostCourse?: boolean; enabled?: boolean }>;
    courseHoleHeaders?: Array<{ courseId?: string; holeHeaders?: CourseHeader[] }>;
  } | null;
  holeDetails?: { holeInfo?: { par?: number | null; yards?: number | null } | null } | null;
};

function numberOrNull(value: unknown) {
  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
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

    let body: { data?: CourseData; errors?: Array<{ message?: string }> };

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
            (error) =>
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
  query HoleDetails($tournamentId: ID!, $courseId: ID!, $hole: Int!) {
    holeDetails(tournamentId: $tournamentId, courseId: $courseId, hole: $hole) {
      holeInfo { par yards }
    }
  }
`;

export type PgaTourCourseMetadata = {
  tournamentId: string;
  courseId: string;
  courseName: string | null;
  isHost: boolean;
  holes: Array<{
    holeNumber: number;
    par: number;
    yards: number | null;
  }>;
};

/*
 * Lightweight pre-tournament course import.
 *
 * This deliberately does NOT fetch terrain images, TFW files,
 * green assets, or replay resources. It only asks PGA
 * TOUR for the host course and its official 18-hole scorecard.
 *
 * That makes it appropriate to run when the tournament slate
 * or field is created, before anybody tees off.
 */
export async function fetchPgaTourCourseMetadata(
  input: {
    tournamentId: string;
    round?: number;
  },
): Promise<PgaTourCourseMetadata> {
  const normalizedTournamentId =
    input.tournamentId
      .trim()
      .toUpperCase();

  const round =
    Number(input.round ?? 1);

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
    Array.isArray(
      leaderboard.courses,
    )
      ? leaderboard.courses
      : [];

  let course =
    courses.find(
      (row) =>
        row?.hostCourse === true &&
        row?.enabled !== false,
    ) ??
    courses.find(
      (row) =>
        row?.enabled !== false,
    ) ??
    courses[0];

  let courseId =
    String(
      course?.id ?? "",
    ).trim();

  /*
   * Pre-event LeaderboardHoleByHole can legitimately return
   * no courses even though PGA has already published the
   * tournament and its official host course.
   *
   * Use the existing PGA tournament-overview source to resolve
   * pre-event course identity consistently with field imports.
   */
  if (!courseId) {
    const preLiveCourse =
      await fetchPgaTourCourseIdentity(
        normalizedTournamentId,
      );

    course =
      preLiveCourse;

    courseId =
      preLiveCourse.id;

    console.log(
      "[PGA course metadata] Course resolved from tournament overview",
      {
        tournamentId:
          normalizedTournamentId,
        courseId,
        courseName:
          preLiveCourse.courseName,
      },
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
      (row) =>
        String(
          row?.courseId ?? "",
        ) === courseId,
    )?.holeHeaders ?? [];

  const headersByHole =
    new Map<number, CourseHeader>(
      (
        Array.isArray(headerRows)
          ? headerRows
          : []
      )
        .filter(
          (row) =>
            Number.isInteger(
              Number(
                row?.holeNumber,
              ),
            ),
        )
        .map(
          (row) => [
            Number(
              row.holeNumber,
            ),
            row,
          ],
        ),
    );

  /*
   * Hole headers already provide par. HoleDetails adds official
   * yardage and is available independently of a golfer's score.
   */
  const holes =
    await Promise.all(
      Array.from(
        {
          length: 18,
        },
        (_, index) =>
          index + 1,
      ).map(
        async (
          holeNumber,
        ) => {
          const header =
            headersByHole.get(
              holeNumber,
            );

          let detail: CourseData["holeDetails"] =
            null;

          try {
            const holeData =
              await graphqlRequest(
                "HoleDetails",
                HOLE_DETAILS_QUERY,
                {
                  tournamentId:
                    normalizedTournamentId,
                  courseId,
                  hole:
                    holeNumber,
                },
              );

            detail =
              holeData
                ?.holeDetails ??
              null;
          } catch (error) {
            /*
             * Par can still come from the leaderboard hole
             * headers if a single HoleDetails call is flaky.
             */
            console.warn(
              `[Golf course metadata] Hole ${holeNumber} ` +
                `details unavailable:`,
              error,
            );
          }

          const holeInfo =
            detail?.holeInfo &&
            typeof detail
              .holeInfo ===
              "object"
              ? detail.holeInfo
              : {};

          const par =
            numberOrNull(
              holeInfo.par ??
                header?.par,
            );

          const yards =
            numberOrNull(
              holeInfo.yards,
            );

          return {
            holeNumber,
            par,
            yards,
          };
        },
      ),
    );

  const validHoles =
    holes
      .filter(
        (
          hole,
        ): hole is {
          holeNumber: number;
          par: number;
          yards: number | null;
        } =>
          Number.isInteger(
            hole.holeNumber,
          ) &&
          hole.holeNumber >= 1 &&
          hole.holeNumber <= 18 &&
          hole.par !== null &&
          Number.isInteger(
            hole.par,
          ) &&
          hole.par >= 2 &&
          hole.par <= 7,
      )
      .map(
        (hole) => ({
          holeNumber:
            hole.holeNumber,
          par:
            hole.par,
          yards:
            hole.yards !== null &&
            Number.isFinite(
              hole.yards,
            ) &&
            hole.yards > 0
              ? hole.yards
              : null,
        }),
      )
      .sort(
        (a, b) =>
          a.holeNumber -
          b.holeNumber,
      );

  if (
    validHoles.length !== 18
  ) {
    throw new Error(
      `PGA TOUR returned ${validHoles.length}/18 valid course pars.`,
    );
  }

  return {
    tournamentId:
      normalizedTournamentId,
    courseId,
    courseName:
      typeof course
        ?.courseName ===
        "string"
        ? course
            .courseName
            .trim() ||
          null
        : null,
    isHost:
      course
        ?.hostCourse ===
      true,
    holes:
      validHoles,
  };
}
