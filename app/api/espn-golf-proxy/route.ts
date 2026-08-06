export const runtime = "edge";
export const dynamic = "force-dynamic";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";

const ESPN_COURSE_URL =
  "https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard";

function unauthorized() {
  return Response.json(
    {
      error: "Unauthorized.",
    },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function badRequest(message: string) {
  return Response.json(
    {
      error: message,
    },
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: Request) {
  const expectedSecret =
    process.env.GOLF_CRON_SECRET?.trim();

  const authorization =
    request.headers.get("authorization");

  if (
    !expectedSecret ||
    authorization !==
      `Bearer ${expectedSecret}`
  ) {
    return unauthorized();
  }

  const requestUrl =
    new URL(request.url);

  const kind =
    requestUrl.searchParams.get("kind");

  let espnUrl: URL;

  if (kind === "scoreboard") {
    espnUrl = new URL(
      ESPN_SCOREBOARD_URL,
    );

    const dates =
      requestUrl.searchParams
        .get("dates")
        ?.trim();

    if (dates) {
      if (!/^\d{4}(?:\d{4})?$/.test(dates)) {
        return badRequest(
          "Invalid scoreboard dates value.",
        );
      }

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

    if (
      !eventId ||
      !/^\d+$/.test(eventId)
    ) {
      return badRequest(
        "A valid ESPN eventId is required.",
      );
    }

    espnUrl = new URL(
      ESPN_COURSE_URL,
    );

    espnUrl.searchParams.set(
      "event",
      eventId,
    );
  } else {
    return badRequest(
      "kind must be scoreboard or course.",
    );
  }

  const response = await fetch(
    espnUrl,
    {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept:
          "application/json, text/plain, */*",
        Origin: "https://www.espn.com",
        Referer:
          "https://www.espn.com/golf/leaderboard",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      },
    },
  );

  const body =
    await response.text();

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type":
        response.headers.get(
          "content-type",
        ) ??
        "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-111-ESPN-Proxy": "edge",
    },
  });
}
