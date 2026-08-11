import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ESPN_GOLF_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";

const ESPN_GOLF_COURSE_URL =
  "https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard";

function isAuthorized(request: Request) {
  const expectedSecret =
    process.env.GOLF_CRON_SECRET?.trim();

  if (!expectedSecret) {
    console.error(
      "GOLF_CRON_SECRET is not configured for the ESPN Golf proxy.",
    );

    return false;
  }

  const authorization =
    request.headers.get("authorization");

  return (
    authorization ===
    `Bearer ${expectedSecret}`
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  try {
    const requestUrl =
      new URL(request.url);

    const kind =
      requestUrl.searchParams
        .get("kind")
        ?.trim()
        .toLowerCase();

    let espnUrl: URL;

    if (kind === "scoreboard") {
      espnUrl =
        new URL(
          ESPN_GOLF_SCOREBOARD_URL,
        );

      const dates =
        requestUrl.searchParams
          .get("dates")
          ?.trim();

      if (dates) {
        espnUrl.searchParams.set(
          "dates",
          dates,
        );
      }
    } else if (kind === "course") {
      const eventId =
        requestUrl.searchParams
          .get("eventId")
          ?.trim();

      if (!eventId) {
        return NextResponse.json(
          {
            error:
              "eventId is required for Golf course requests.",
          },
          {
            status: 400,
            headers: {
              "Cache-Control":
                "no-store, max-age=0",
            },
          },
        );
      }

      espnUrl =
        new URL(
          ESPN_GOLF_COURSE_URL,
        );

      espnUrl.searchParams.set(
        "event",
        eventId,
      );
    } else {
      return NextResponse.json(
        {
          error:
            'kind must be either "scoreboard" or "course".',
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store, max-age=0",
          },
        },
      );
    }

    const response =
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

    if (!response.ok) {
      const errorBody =
        await response
          .text()
          .catch(() => "");

      return NextResponse.json(
        {
          error:
            `ESPN Golf request failed with ` +
            `${response.status} ${response.statusText}` +
            (
              errorBody
                ? `: ${errorBody.slice(0, 300)}`
                : ""
            ),
        },
        {
          status: 502,
          headers: {
            "Cache-Control":
              "no-store, max-age=0",
          },
        },
      );
    }

    const payload: unknown =
      await response.json();

    return NextResponse.json(
      payload,
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error(
      "Unexpected ESPN Golf Edge proxy error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected ESPN Golf proxy error.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  }
}
