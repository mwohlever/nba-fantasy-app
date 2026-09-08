import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchNflWeekSelection, isDuplicateNflWeek } from "@/lib/providers/nflWeeks";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
  const active = await getActiveLeagueForSport(user, "nfl");
  if (!active) return NextResponse.json({ error: "NFL is not enabled for this Group." }, { status: 404 });
  try {
    const params = request.nextUrl.searchParams;
    const selection = await fetchNflWeekSelection(params.has("season") ? Number(params.get("season")) : undefined, params.has("week") ? Number(params.get("week")) : undefined);
    const { data, error } = await supabaseAdmin.from("slates").select("id, sport, league_id, display_name, date, start_date, end_date").eq("league_id", active.league.id).eq("sport", "nfl");
    if (error) throw new Error(error.message);
    const existing = (data ?? []).find(slate => isDuplicateNflWeek(slate, active.league.id, selection));
    return NextResponse.json({ ...selection, existingSlateId: existing?.id ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NFL schedule unavailable." }, { status: 400 });
  }
}
