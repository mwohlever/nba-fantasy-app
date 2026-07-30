import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";

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
          "nba_team_abbreviations",
        ].join(",")
      )
      .eq("sport", sport)
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
