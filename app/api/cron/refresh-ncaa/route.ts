import {
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  POST as refreshNcaa,
} from "@/app/api/refresh-stats-ncaa/route";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;

type WeekRow = {
  id: number;
  season: number;
  week_number: number;
  lock_at: string | null;
  status:
    | "open"
    | "locked"
    | "final";
};

function isAuthorized(
  request: Request,
) {
  const configuredSecret =
    process.env
      .GOLF_CRON_SECRET
      ?.trim();

  if (!configuredSecret) {
    console.error(
      "GOLF_CRON_SECRET is not configured.",
    );

    return false;
  }

  return (
    request.headers.get(
      "authorization",
    ) ===
    `Bearer ${configuredSecret}`
  );
}

export async function GET(
  request: Request,
) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized.",
      },
      {
        status: 401,
      },
    );
  }

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "ncaa_pickem_weeks",
      )
      .select(
        "id, season, week_number, lock_at, status",
      )
      .neq(
        "status",
        "final",
      )
      .order(
        "season",
        {
          ascending: false,
        },
      )
      .order(
        "week_number",
        {
          ascending: false,
        },
      )
      .limit(3);

  if (error) {
    return NextResponse.json(
      {
        error:
          error.message,
      },
      {
        status: 500,
      },
    );
  }

  const weeks =
    (data ??
      []) as WeekRow[];

  const results:
    Array<{
      weekId: number;
      season: number;
      week: number;
      ok: boolean;
      status: number;
      result: unknown;
    }> = [];

  for (
    const week
    of weeks
  ) {
    const refreshRequest =
      new Request(
        "http://internal/api/refresh-stats-ncaa",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              weekId:
                week.id,
            }),
        },
      );

    try {
      const response =
        await refreshNcaa(
          refreshRequest as any,
        );

      let result:
        unknown = null;

      try {
        result =
          await response.json();
      } catch {
        result = {
          error:
            "Refresh returned an unreadable response.",
        };
      }

      results.push({
        weekId:
          week.id,

        season:
          week.season,

        week:
          week.week_number,

        ok:
          response.ok,

        status:
          response.status,

        result,
      });
    } catch (error) {
      results.push({
        weekId:
          week.id,

        season:
          week.season,

        week:
          week.week_number,

        ok:
          false,

        status:
          500,

        result: {
          error:
            error instanceof Error
              ? error.message
              : "Unexpected NCAA refresh error.",
        },
      });
    }
  }

  const failures =
    results.filter(
      (result) =>
        !result.ok,
    );

  return NextResponse.json(
    {
      success:
        failures.length === 0,

      checkedAt:
        new Date()
          .toISOString(),

      weeksFound:
        weeks.length,

      processed:
        results.length,

      failures:
        failures.length,

      results,
    },
    {
      status:
        failures.length > 0
          ? 207
          : 200,

      headers: {
        "Cache-Control":
          "no-store, max-age=0",
      },
    },
  );
}
