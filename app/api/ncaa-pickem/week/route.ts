import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type WeekRow = {
  id: number;
  season: number;
  week_number: number;
  label: string;
  lock_at: string | null;
  status: "open" | "locked" | "final";
  analysis: string | null;
  show_analysis: boolean;
};

function positive(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function locked(week: WeekRow) {
  return week.status !== "open" || Boolean(week.lock_at && Date.now() >= new Date(week.lock_at).getTime());
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });

    const access = await getNcaaPickEmAccess(user);
    if (!access) {
      return NextResponse.json({ error: "NCAA Pick 'Em is not enabled for this Group." }, { status: 404 });
    }
    if (!access.viewerTeam) {
      return NextResponse.json({ error: "No active team is available for this Group." }, { status: 409 });
    }

    const params = new URL(request.url).searchParams;
    const season = positive(params.get("season"));
    const weekNumber = positive(params.get("week"));
    const { data, error } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .select("id, season, week_number, label, lock_at, status, analysis, show_analysis")
      .eq("league_id", access.league.id)
      .order("season", { ascending: false })
      .order("week_number", { ascending: false });
    if (error) throw new Error(error.message);
    const weeks = (data ?? []) as WeekRow[];
    const selected = (season && weekNumber
      ? weeks.find((item) => Number(item.season) === season && Number(item.week_number) === weekNumber)
      : null) ?? weeks[0] ?? null;

    const viewer = {
      teamId: access.viewerTeam.teamId,
      displayName: access.viewerTeam.name,
      avatarUrl: access.viewerTeam.avatarUrl,
    };
    if (!selected) return NextResponse.json({ success: true, viewer, participants: access.participants, weeks, week: null, games: [], picks: [], groupPicks: [], locked: false });

    const isLocked = locked(selected);
    const participantIds = access.participants.map((item) => item.teamId);
    const [gamesResult, picksResult] = await Promise.all([
      supabaseAdmin.from("ncaa_pickem_games").select("*").eq("week_id", selected.id).eq("included", true).order("kickoff_at", { ascending: true }),
      supabaseAdmin.from("ncaa_pickem_picks").select("id, week_id, game_id, team_id, picked_team_id, is_correct").eq("week_id", selected.id).eq("team_id", access.viewerTeam.teamId),
    ]);
    if (gamesResult.error) throw new Error(gamesResult.error.message);
    if (picksResult.error) throw new Error(picksResult.error.message);

    let groupPicks: unknown[] = [];
    if (isLocked && participantIds.length > 0) {
      const result = await supabaseAdmin.from("ncaa_pickem_picks").select("game_id, team_id, picked_team_id, is_correct").eq("week_id", selected.id).in("team_id", participantIds);
      if (result.error) throw new Error(result.error.message);
      groupPicks = result.data ?? [];
    }

    return NextResponse.json({ success: true, viewer, participants: access.participants, weeks, week: selected, games: gamesResult.data ?? [], picks: picksResult.data ?? [], groupPicks, locked: isLocked });
  } catch (error) {
    console.error("Failed to load NCAA Pick 'Em week", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load NCAA Pick 'Em." }, { status: 500 });
  }
}
