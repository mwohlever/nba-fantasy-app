import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function formatSlateLabel(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} - ${endDate}`;
}

export async function GET() {
  try {
    const [
      { data: slates, error: slatesError },
      { data: teams, error: teamsError },
      { data: players, error: playersError },
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select("id, date, start_date, end_date, is_locked")
        .order("start_date", { ascending: false })
        .order("end_date", { ascending: false }),
      supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
      supabaseAdmin
        .from("players")
        .select("id, name, position_group, is_active, team_abbreviation")
        .order("name", { ascending: true }),
    ]);

    if (slatesError) return NextResponse.json({ error: slatesError.message }, { status: 500 });
    if (teamsError) return NextResponse.json({ error: teamsError.message }, { status: 500 });
    if (playersError) return NextResponse.json({ error: playersError.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      slates: (slates ?? []).map((slate) => {
        const startDate = slate.start_date ?? slate.date;
        const endDate = slate.end_date ?? slate.date;

        return {
          ...slate,
          label: formatSlateLabel(startDate, endDate),
        };
      }),
      teams: teams ?? [],
      players: players ?? [],
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading correction data." },
      { status: 500 }
    );
  }
}
