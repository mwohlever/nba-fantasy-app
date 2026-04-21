import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("players")
      .select("id, name, position_group, is_active, team_abbreviation, nba_display_name")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load players: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      players: data ?? [],
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading players." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const updates = Array.isArray(body?.updates) ? body.updates : [];

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No player updates were provided." },
        { status: 400 }
      );
    }

    for (const update of updates) {
      const playerId = Number(update?.id);
      const position_group = update?.position_group;
      const is_active = update?.is_active;

      if (!Number.isFinite(playerId)) {
        return NextResponse.json(
          { error: "Invalid player id in updates." },
          { status: 400 }
        );
      }

      if (position_group !== "G" && position_group !== "F/C") {
        return NextResponse.json(
          { error: `Invalid position_group for player ${playerId}.` },
          { status: 400 }
        );
      }

      if (typeof is_active !== "boolean") {
        return NextResponse.json(
          { error: `Invalid is_active for player ${playerId}.` },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("players")
        .update({
          position_group,
          is_active,
        })
        .eq("id", playerId);

      if (error) {
        return NextResponse.json(
          { error: `Failed to update player ${playerId}: ${error.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      updatedCount: updates.length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while updating players." },
      { status: 500 }
    );
  }
}
