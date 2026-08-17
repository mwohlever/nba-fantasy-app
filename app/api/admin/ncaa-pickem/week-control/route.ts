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
      body?.status === undefined
        ? null
        : String(
            body.status,
          );

    const hasAnalysis =
      body?.analysis !== undefined;

    const hasShowAnalysis =
      body?.showAnalysis !== undefined;

    if (
      !Number.isInteger(
        weekId,
      ) ||
      weekId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Valid weekId is required.",
        },
        { status: 400 },
      );
    }

    if (
      status !== null &&
      !VALID_STATUSES.has(
        status,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid week status.",
        },
        { status: 400 },
      );
    }

    if (
      status === null &&
      !hasAnalysis &&
      !hasShowAnalysis
    ) {
      return NextResponse.json(
        {
          error:
            "No week updates were provided.",
        },
        { status: 400 },
      );
    }

    const updates: {
      status?: string;
      analysis?: string | null;
      show_analysis?: boolean;
      updated_at: string;
    } = {
      updated_at:
        new Date().toISOString(),
    };

    if (status !== null) {
      updates.status =
        status;
    }

    if (hasAnalysis) {
      const analysis =
        String(
          body.analysis ?? "",
        ).trim();

      if (
        analysis.length >
        4000
      ) {
        return NextResponse.json(
          {
            error:
              "MW Analysis must be 4,000 characters or fewer.",
          },
          { status: 400 },
        );
      }

      updates.analysis =
        analysis || null;
    }

    if (hasShowAnalysis) {
      updates.show_analysis =
        body.showAnalysis === true;
    }

    const {
      data,
      error,
    } = await supabaseAdmin
      .from(
        "ncaa_pickem_weeks",
      )
      .update(
        updates,
      )
      .eq(
        "id",
        weekId,
      )
      .select(
        "id, season, week_number, label, lock_at, status, analysis, show_analysis",
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
