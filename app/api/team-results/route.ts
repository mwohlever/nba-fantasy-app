export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("team_slate_results")
      .select(
        `
        team_id,
        fantasy_points,
        finish_position,
        games_completed,
        games_in_progress,
        games_remaining
      `
      )
      .eq("slate_id", slateId)
      .order("finish_position", { ascending: true, nullsFirst: false });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load team results: ${error.message}` },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        teamResults: data ?? [],
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading team results." },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}


