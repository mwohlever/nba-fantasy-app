import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function createFavoriteHandlers(table: "ncaa_favorite_teams" | "live_score_favorite_teams", sport?: "nfl") {
function validTeamId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .select("espn_team_id")
    .eq("user_id", user.id)
    .match(sport ? { sport } : {})
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Unable to load favorite teams", error);
    return NextResponse.json(
      { error: "Unable to load favorite teams." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    teamIds: (data ?? []).map((row) => String(row.espn_team_id)),
  });
}

async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const teamId = body?.teamId;

  if (!validTeamId(teamId)) {
    return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from(table)
    .upsert(
      {
        ...(sport ? { sport } : {}),
        user_id: user.id,
        espn_team_id: teamId,
      },
      {
        onConflict: sport ? "user_id,sport,espn_team_id" : "user_id,espn_team_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    console.error("Unable to save favorite team", error);
    return NextResponse.json(
      { error: "Unable to save favorite team." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const teamId = body?.teamId;

  if (!validTeamId(teamId)) {
    return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("user_id", user.id)
    .match(sport ? { sport } : {})
    .eq("espn_team_id", teamId);

  if (error) {
    console.error("Unable to remove favorite team", error);
    return NextResponse.json(
      { error: "Unable to remove favorite team." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

return { GET, POST, DELETE };
}
