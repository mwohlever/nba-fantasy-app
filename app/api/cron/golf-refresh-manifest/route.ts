import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GolfSlateRow = {
  id: number;
  display_name: string | null;
  external_event_id: string | null;
  start_date: string;
  end_date: string;
};

function isAuthorized(
  request: Request,
) {
  const secret =
    process.env.GOLF_CRON_SECRET?.trim();

  return Boolean(
    secret &&
      request.headers.get(
        "authorization",
      ) === `Bearer ${secret}`,
  );
}

function dateOnly(
  date: Date,
) {
  return date
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

  const now = new Date();

  const earliest =
    new Date(now);

  earliest.setUTCDate(
    earliest.getUTCDate() - 2,
  );

  const latest =
    new Date(now);

  latest.setUTCDate(
    latest.getUTCDate() + 8,
  );

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("slates")
    .select(
      [
        "id",
        "display_name",
        "external_event_id",
        "start_date",
        "end_date",
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
      dateOnly(latest),
    )
    .gte(
      "end_date",
      dateOnly(earliest),
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

  const slates =
    rawSlateRows
      .filter(
        (
          row,
        ): row is Record<
          string,
          unknown
        > =>
          typeof row === "object" &&
          row !== null,
      )
      .map((row) => {
        const slate: GolfSlateRow = {
          id: Number(row.id),
          display_name:
            row.display_name == null
              ? null
              : String(
                  row.display_name,
                ),
          external_event_id:
            row.external_event_id == null
              ? null
              : String(
                  row.external_event_id,
                ),
          start_date:
            String(
              row.start_date ?? "",
            ),
          end_date:
            String(
              row.end_date ?? "",
            ),
        };

        return {
          slateId:
            Number(slate.id),
          tournament:
            slate.display_name ??
            `Slate ${slate.id}`,
          eventId:
            String(
              slate.external_event_id ??
                "",
            ),
          year:
            String(
              slate.start_date ??
                "",
            ).slice(0, 4),
          startDate:
            slate.start_date,
          endDate:
            slate.end_date,
        };
      })
      .filter(
        (slate) =>
          Number.isInteger(
            slate.slateId,
          ) &&
          slate.slateId > 0 &&
          /^\d+$/.test(
            slate.eventId,
          ) &&
          /^\d{4}$/.test(
            slate.year,
          ),
      );

  return NextResponse.json({
    success: true,
    checkedAt:
      new Date().toISOString(),
    slates,
  });
}
