import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { getCurrentUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";

type AdminSlateRow = {
  id: number;
  date: string;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
  sport: "nba" | "nfl" | "golf";
  display_name: string | null;
  external_event_id: string | null;
  cut_penalty_per_round: number | null;
  has_cut: boolean;
  nba_team_abbreviations: string[] | null;
};

export async function GET(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const sportParam = searchParams.get("sport");

    const sport =
      sportParam === "nfl"
        ? "nfl"
        : sportParam === "golf"
          ? "golf"
          : "nba";

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      );
    }

    const activeLeague =
      await getActiveLeagueForSport(
        user,
        sport,
      );

    if (!activeLeague) {
      return NextResponse.json(
        {
          error:
            "This League is not enabled for the active Group.",
        },
        { status: 404 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("slates")
      .select(
        [
          "id",
          "date",
          "start_date",
          "end_date",
          "is_locked",
          "sport",
          "display_name",
          "external_event_id",
          "cut_penalty_per_round",
          "has_cut",
          "nba_team_abbreviations",
        ].join(",")
      )
      .eq("sport", sport)
      .eq(
        "league_id",
        activeLeague.league.id,
      )
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load slates: ${error.message}` },
        { status: 500 }
      );
    }

    const safeData = (data ?? []) as unknown as AdminSlateRow[];

    const slates = safeData.map((slate) => ({
      ...slate,
      label:
        slate.display_name?.trim() ||
        (slate.start_date &&
        slate.end_date &&
        slate.start_date !== slate.end_date
          ? `${slate.start_date} - ${slate.end_date}`
          : slate.start_date ?? slate.date),
    }));

    return NextResponse.json({
      success: true,
      slates,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading slates." },
      { status: 500 }
    );
  }
}
