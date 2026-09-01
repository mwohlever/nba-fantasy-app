import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Week = { id: number; season: number; week_number: number; status: "open" | "locked" | "final" };
type Pick = { week_id: number; game_id: number; team_id: number; is_correct: boolean | null };

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
    const access = await getNcaaPickEmAccess(user);
    if (!access) return NextResponse.json({ error: "NCAA Pick 'Em is not enabled for this Group." }, { status: 404 });

    const requested = Number(new URL(request.url).searchParams.get("season"));
    const { data, error } = await supabaseAdmin.from("ncaa_pickem_weeks").select("id, season, week_number, status").eq("league_id", access.league.id).order("season", { ascending: false }).order("week_number", { ascending: false });
    if (error) throw new Error(error.message);
    const allWeeks = (data ?? []) as Week[];
    const seasons = [...new Set(allWeeks.map((week) => Number(week.season)))].sort((a, b) => b - a);
    const selectedSeason = Number.isInteger(requested) && requested > 0 ? requested : seasons[0] ?? null;
    const weeks = allWeeks.filter((week) => Number(week.season) === selectedSeason);
    const weekIds = weeks.map((week) => Number(week.id));
    const participantIds = access.participants.map((item) => item.teamId);
    let picks: Pick[] = [];
    const includedByWeek = new Map<number, Set<number>>();

    if (weekIds.length && participantIds.length) {
      const [pickResult, gameResult] = await Promise.all([
        supabaseAdmin.from("ncaa_pickem_picks").select("week_id, game_id, team_id, is_correct").in("week_id", weekIds).in("team_id", participantIds).not("is_correct", "is", null),
        supabaseAdmin.from("ncaa_pickem_games").select("id, week_id").in("week_id", weekIds).eq("included", true),
      ]);
      if (pickResult.error) throw new Error(pickResult.error.message);
      if (gameResult.error) throw new Error(gameResult.error.message);
      picks = (pickResult.data ?? []) as Pick[];
      for (const game of gameResult.data ?? []) {
        const bucket = includedByWeek.get(Number(game.week_id)) ?? new Set<number>();
        bucket.add(Number(game.id));
        includedByWeek.set(Number(game.week_id), bucket);
      }
    }

    const rows = access.participants.map((participant) => {
      const teamPicks = picks.filter((pick) => Number(pick.team_id) === participant.teamId);
      const correct = teamPicks.filter((pick) => pick.is_correct === true).length;
      const incorrect = teamPicks.filter((pick) => pick.is_correct === false).length;
      const graded = correct + incorrect;
      const byWeek = new Map<number, Pick[]>();
      for (const pick of teamPicks) byWeek.set(Number(pick.week_id), [...(byWeek.get(Number(pick.week_id)) ?? []), pick]);
      let perfectWeeks = 0;
      for (const [weekId, weekPicks] of byWeek) {
        const included = includedByWeek.get(weekId) ?? new Set<number>();
        const gradedIds = new Set(weekPicks.map((pick) => Number(pick.game_id)));
        if (included.size > 0 && included.size === gradedIds.size && [...included].every((id) => gradedIds.has(id)) && weekPicks.every((pick) => pick.is_correct === true)) perfectWeeks += 1;
      }
      const ordered = [...teamPicks].sort((a, b) => {
        const aWeek = weeks.find((week) => week.id === Number(a.week_id));
        const bWeek = weeks.find((week) => week.id === Number(b.week_id));
        return Number(aWeek?.week_number ?? 0) - Number(bWeek?.week_number ?? 0) || Number(a.game_id) - Number(b.game_id);
      });
      let bestStreak = 0;
      let running = 0;
      for (const pick of ordered) { running = pick.is_correct === true ? running + 1 : 0; bestStreak = Math.max(bestStreak, running); }
      let currentStreak = 0;
      for (let index = ordered.length - 1; index >= 0 && ordered[index].is_correct === true; index -= 1) currentStreak += 1;
      return { ...participant, correct, incorrect, graded, pickPct: graded ? correct / graded : null, perfectWeeks, currentStreak, bestStreak };
    }).sort((a, b) => b.correct - a.correct || (b.pickPct ?? -1) - (a.pickPct ?? -1) || b.perfectWeeks - a.perfectWeeks || a.name.localeCompare(b.name)).map((row, index) => ({ ...row, rank: index + 1 }));

    return NextResponse.json({ success: true, viewerTeamId: access.viewerTeam?.teamId ?? null, seasons, selectedSeason, standings: rows });
  } catch (error) {
    console.error("Failed to load NCAA Pick 'Em standings", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load NCAA Pick 'Em standings." }, { status: 500 });
  }
}
