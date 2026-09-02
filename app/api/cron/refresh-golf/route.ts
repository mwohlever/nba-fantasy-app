import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  POST as refreshGolfStats,
} from "@/app/api/refresh-stats-golf/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GolfSlateRow = {
  id: number;
  start_date: string;
  end_date: string;
  display_name: string | null;
  external_event_id: string | null;
};

function isAuthorized(
  request: Request,
) {
  const configuredSecret =
    process.env.GOLF_CRON_SECRET?.trim();

  if (!configuredSecret) {
    console.error(
      "GOLF_CRON_SECRET is not configured.",
    );

    return false;
  }

  const authorization =
    request.headers.get(
      "authorization",
    );

  return (
    authorization ===
    `Bearer ${configuredSecret}`
  );
}

function dateOnly(
  value: Date,
) {
  return value
    .toISOString()
    .slice(0, 10);
}

export async function GET(
  request: Request,
) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized.",
      },
      {
        status: 401,
      },
    );
  }

  const internalSecret = process.env.GOLF_CRON_SECRET!.trim();

  const today = new Date();

  const earliestDate =
    new Date(today);

  earliestDate.setUTCDate(
    earliestDate.getUTCDate() - 2,
  );

  const latestDate =
    new Date(today);

  latestDate.setUTCDate(
    latestDate.getUTCDate() + 8,
  );

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("slates")
    .select(
      [
        "id",
        "start_date",
        "end_date",
        "display_name",
        "external_event_id",
      ].join(","),
    )
    .eq("sport", "golf")
    .eq("is_locked", false)
    .not(
      "external_event_id",
      "is",
      null,
    )
    .lte(
      "start_date",
      dateOnly(latestDate),
    )
    .gte(
      "end_date",
      dateOnly(earliestDate),
    )
    .order(
      "start_date",
      {
        ascending: true,
      },
    );

  if (error) {
    return NextResponse.json(
      {
        error:
          "Unable to load active Golf slates: " +
          error.message,
      },
      {
        status: 500,
      },
    );
  }

  const rawSlateRows: unknown[] =
    Array.isArray(data)
      ? (data as unknown[])
      : [];

  const slates: GolfSlateRow[] =
    rawSlateRows
      .filter(
        (row) =>
          typeof row === "object" &&
          row !== null,
      )
      .map((row) => {
        const record =
          row as Record<
            string,
            unknown
          >;

        return {
          id: Number(record.id),
          start_date:
            String(
              record.start_date ?? "",
            ),
          end_date:
            String(
              record.end_date ?? "",
            ),
          display_name:
            record.display_name == null
              ? null
              : String(
                  record.display_name,
                ),
          external_event_id:
            record.external_event_id == null
              ? null
              : String(
                  record.external_event_id,
                ),
        };
      })
      .filter(
        (row) =>
          Number.isInteger(row.id) &&
          row.id > 0 &&
          Boolean(row.start_date) &&
          Boolean(row.end_date),
      );

  const results: Array<{
    slateId: number;
    tournament: string;
    ok: boolean;
    status: number;
    state:
      | "refreshed"
      | "waiting_for_field"
      | "failed";
    result: unknown;
  }> = [];

  /*
   * Process sequentially to avoid several large ESPN/Supabase
   * refreshes competing for the same serverless resources.
   */
  for (const slate of slates) {
    const refreshRequest =
      new Request(
        "http://internal/api/refresh-stats-golf",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            authorization:
              `Bearer ${internalSecret}`,
          },
          body: JSON.stringify({
            slateId: slate.id,
          }),
        },
      );

    try {
      const response =
        await refreshGolfStats(
          refreshRequest,
        );

      let result: unknown;

      try {
        result =
          await response.json();
      } catch {
        result = {
          error:
            "Refresh returned an unreadable response.",
        };
      }

      const resultRecord =
        typeof result === "object" &&
        result !== null
          ? result as Record<
              string,
              unknown
            >
          : null;

      const errorMessage =
        typeof resultRecord?.error ===
        "string"
          ? resultRecord.error
          : "";

      const waitingForField =
        response.status === 502 &&
        errorMessage.includes(
          "tournament field is not available yet",
        );

      results.push({
        slateId: slate.id,
        tournament:
          slate.display_name ??
          `Slate ${slate.id}`,
        ok:
          response.ok ||
          waitingForField,
        status:
          waitingForField
            ? 200
            : response.status,
        state:
          waitingForField
            ? "waiting_for_field"
            : response.ok
              ? "refreshed"
              : "failed",
        result:
          waitingForField
            ? {
                success: true,
                status:
                  "waiting_for_field",
                message:
                  "Tournament found, but ESPN has not published the field yet.",
                upstream: result,
              }
            : result,
      });
    } catch (refreshError) {
      results.push({
        slateId: slate.id,
        tournament:
          slate.display_name ??
          `Slate ${slate.id}`,
        ok: false,
        status: 500,
        state: "failed",
        result: {
          error:
            refreshError instanceof Error
              ? refreshError.message
              : "Unexpected Golf refresh error.",
        },
      });
    }
  }

  const failures =
    results.filter(
      (row) => !row.ok,
    );

  const waiting =
    results.filter(
      (row) =>
        row.state ===
        "waiting_for_field",
    );

  return NextResponse.json(
    {
      success:
        failures.length === 0,
      checkedAt:
        new Date().toISOString(),
      slatesFound:
        slates.length,
      processed:
        results.length,
      refreshed:
        results.filter(
          (row) =>
            row.state ===
            "refreshed",
        ).length,
      waiting:
        waiting.length,
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
