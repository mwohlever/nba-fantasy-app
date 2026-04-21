import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TeamRow = {
  id: number;
  name: string;
};

type SlateRow = {
  id: number;
  start_date: string;
};

type TeamSlateResultRow = {
  slate_id: number;
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
};

type StandingRow = {
  season: number;
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  high_score: number | null;
  low_score: number | null;
  slates_played: number;
};

function getSeasonFromDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).getFullYear();
}

function roundTo(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export async function GET(request: NextRequest) {
  try {
    const seasonParam = request.nextUrl.searchParams.get("season");

    const [
      { data: teams, error: teamsError },
      { data: slates, error: slatesError },
      { data: teamSlateResults, error: teamSlateResultsError },
    ] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
      supabaseAdmin
        .from("slates")
        .select("id, start_date")
        .order("start_date", { ascending: true }),
      supabaseAdmin
        .from("team_slate_results")
        .select("slate_id, team_id, fantasy_points, finish_position"),
    ]);

    if (teamsError || slatesError || teamSlateResultsError) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            slatesError?.message ||
            teamSlateResultsError?.message ||
            "Failed to load standings data.",
        },
        { status: 500 }
      );
    }

    const safeTeams = (teams ?? []) as TeamRow[];
    const safeSlates = (slates ?? []) as SlateRow[];
    const safeResults = (teamSlateResults ?? []) as TeamSlateResultRow[];

    const slateSeasonMap = new Map<number, number>();
    safeSlates.forEach((slate) => {
      slateSeasonMap.set(slate.id, getSeasonFromDate(slate.start_date));
    });

    const availableSeasons = Array.from(
      new Set(
        safeSlates
          .map((slate) => getSeasonFromDate(slate.start_date))
          .filter((season) => Number.isFinite(season))
      )
    ).sort((a, b) => b - a);

    const selectedSeason =
      seasonParam && Number.isFinite(Number(seasonParam))
        ? Number(seasonParam)
        : availableSeasons[0] ?? null;

    const seasonResults = safeResults.filter(
      (row) => slateSeasonMap.get(row.slate_id) === selectedSeason
    );

    const standings: StandingRow[] = safeTeams.map((team) => {
      const teamRows = seasonResults.filter((row) => row.team_id === team.id);

      const playedRows = teamRows.filter((row) => (row.fantasy_points ?? 0) > 0);
      const scores = playedRows.map((row) => Number(row.fantasy_points ?? 0));
      const finishes = playedRows
        .map((row) => row.finish_position)
        .filter((value): value is number => value !== null && value !== undefined);

      const wins = playedRows.filter((row) => row.finish_position === 1).length;
      const runnerUps = playedRows.filter((row) => row.finish_position === 2).length;
      const slatesPlayed = playedRows.length;

      return {
        season: selectedSeason ?? 0,
        team_id: team.id,
        name: team.name,
        wins,
        runner_ups: runnerUps,
        avg_finish:
          finishes.length > 0
            ? roundTo(finishes.reduce((sum, value) => sum + value, 0) / finishes.length, 2)
            : null,
        avg_score:
          scores.length > 0
            ? roundTo(scores.reduce((sum, value) => sum + value, 0) / scores.length, 2)
            : null,
        high_score: scores.length > 0 ? roundTo(Math.max(...scores), 2) : null,
        low_score: scores.length > 0 ? roundTo(Math.min(...scores), 2) : null,
        slates_played: slatesPlayed,
      };
    });

    return NextResponse.json({
      success: true,
      selectedSeason,
      availableSeasons,
      standings,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading standings." },
      { status: 500 }
    );
  }
}
