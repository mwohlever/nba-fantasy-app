import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function validTeamId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("ncaa_favorite_teams")
    .select("espn_team_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Unable to load NCAA favorite teams", error);
    return NextResponse.json(
      { error: "Unable to load favorite teams." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    teamIds: (data ?? []).map((row) => String(row.espn_team_id)),
  });
}

export async function POST(request: NextRequest) {
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
    .from("ncaa_favorite_teams")
    .upsert(
      {
        user_id: user.id,
        espn_team_id: teamId,
      },
      {
        onConflict: "user_id,espn_team_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    console.error("Unable to save NCAA favorite team", error);
    return NextResponse.json(
      { error: "Unable to save favorite team." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
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
    .from("ncaa_favorite_teams")
    .delete()
    .eq("user_id", user.id)
    .eq("espn_team_id", teamId);

  if (error) {
    console.error("Unable to remove NCAA favorite team", error);
    return NextResponse.json(
      { error: "Unable to remove favorite team." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
