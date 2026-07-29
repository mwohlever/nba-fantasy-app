import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";

const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const { data, error } = await supabaseAdmin
      .from("players_nfl")
      .select("id, name, position, is_active, team_abbreviation")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load NFL players: ${error.message}` },
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
      { error: "Unexpected server error while loading NFL players." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

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
      const position = update?.position;
      const is_active = update?.is_active;

      if (!Number.isFinite(playerId)) {
        return NextResponse.json(
          { error: "Invalid player id in updates." },
          { status: 400 }
        );
      }

      if (!VALID_POSITIONS.has(position)) {
        return NextResponse.json(
          { error: `Invalid position for player ${playerId}.` },
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
        .from("players_nfl")
        .update({
          position,
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
      { error: "Unexpected server error while updating NFL players." },
      { status: 500 }
    );
  }
}
