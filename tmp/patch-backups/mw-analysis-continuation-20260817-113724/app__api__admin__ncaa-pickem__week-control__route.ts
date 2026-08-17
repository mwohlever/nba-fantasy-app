import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  requireAdmin,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

const VALID_STATUSES =
  new Set([
    "open",
    "locked",
    "final",
  ]);

export async function POST(
  request: NextRequest,
) {
  try {
    const admin =
      await requireAdmin();

    if (!admin) {
      return NextResponse.json(
        {
          error:
            "Admin access required.",
        },
        { status: 403 },
      );
    }

    const body =
      await request.json();

    const weekId =
      Number(body?.weekId);

    const status =
      String(
        body?.status ?? "",
      );

    if (
      !Number.isInteger(
        weekId,
      ) ||
      weekId <= 0 ||
      !VALID_STATUSES.has(
        status,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Valid weekId and status are required.",
        },
        { status: 400 },
      );
    }

    const {
      data,
      error,
    } = await supabaseAdmin
      .from(
        "ncaa_pickem_weeks",
      )
      .update({
        status,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        weekId,
      )
      .select(
        "id, season, week_number, label, lock_at, status",
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error:
            error?.message ??
            "Failed to update week.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      week: data,
    });
  } catch (error) {
    console.error(
      "Failed to control NCAA Pick 'Em week",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to update NCAA Pick 'Em week.",
      },
      { status: 500 },
    );
  }
}
