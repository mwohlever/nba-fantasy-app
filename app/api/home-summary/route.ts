import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Team = {
  id: number;
  name: string;
};

type Slate = {
  id: number;
  date: string;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
};

type TeamSlateResult = {
  slate_id: number;
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
};

function formatSlateLabel(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} - ${endDate}`;
}

function roundTo(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function getSeasonFromDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).getFullYear();
}

export async function GET() {
  try {
    const [
      { data: teams, error: teamsError },
      { data: slates, error: slatesError },
      { data: teamSlateResults, error: teamSlateResultsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .order("name", { ascending: true }),

      supabaseAdmin
        .from("slates")
        .select("id, date, start_date, end_date, is_locked")
        .order("start_date", { ascending: false })
        .order("end_date", { ascending: false }),

      supabaseAdmin
        .from("team_slate_results")
        .select(
          "slate_id, team_id, fantasy_points, finish_position, games_completed, games_in_progress, games_remaining"
        ),
    ]);

    if (teamsError || slatesError || teamSlateResultsError) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            slatesError?.message ||
            teamSlateResultsError?.message ||
            "Failed to load home summary data.",
        },
        { status: 500 }
      );
    }

    const safeTeams = (teams ?? []) as Team[];
    const safeSlates = (slates ?? []) as Slate[];
    const safeResults = (teamSlateResults ?? []) as TeamSlateResult[];

    const normalizedSlates = safeSlates.map((slate) => ({
      ...slate,
      start_date: slate.start_date ?? slate.date,
      end_date: slate.end_date ?? slate.date,
    }));

    const latestSlate = normalizedSlates[0] ?? null;

    const latestSlateRows = latestSlate
      ? safeResults
          .filter((row) => row.slate_id === latestSlate.id)
          .map((row) => ({
            ...row,
            teamName:
              safeTeams.find((team) => team.id === row.team_id)?.name ?? "Unknown Team",
          }))
          .sort((a, b) => {
            const aFinish = a.finish_position ?? 999;
            const bFinish = b.finish_position ?? 999;
            if (aFinish !== bFinish) return aFinish - bFinish;
            return (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0);
          })
      : [];

    const latestSeason = latestSlate
      ? getSeasonFromDate(latestSlate.start_date)
      : new Date().getFullYear();

    const slateSeasonMap = new Map<number, number>();
    normalizedSlates.forEach((slate) => {
      slateSeasonMap.set(slate.id, getSeasonFromDate(slate.start_date));
    });

    const currentSeasonResults = safeResults.filter(
      (row) => slateSeasonMap.get(row.slate_id) === latestSeason
    );

    const seasonSnapshot = safeTeams
      .map((team) => {
        const rows = currentSeasonResults.filter((row) => row.team_id === team.id);
        const playedRows = rows.filter((row) => (row.fantasy_points ?? 0) > 0);

        const scores = playedRows.map((row) => Number(row.fantasy_points ?? 0));
        const finishes = playedRows
          .map((row) => row.finish_position)
          .filter((value): value is number => value !== null && value !== undefined);

        return {
          team_id: team.id,
          name: team.name,
          wins: playedRows.filter((row) => row.finish_position === 1).length,
          runner_ups: playedRows.filter((row) => row.finish_position === 2).length,
          avg_finish:
            finishes.length > 0
              ? roundTo(finishes.reduce((sum, value) => sum + value, 0) / finishes.length)
              : null,
          avg_score:
            scores.length > 0
              ? roundTo(scores.reduce((sum, value) => sum + value, 0) / scores.length)
              : null,
          slates_played: playedRows.length,
        };
      })
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.runner_ups !== a.runner_ups) return b.runner_ups - a.runner_ups;

        const aFinish = a.avg_finish ?? 999;
        const bFinish = b.avg_finish ?? 999;
        if (aFinish !== bFinish) return aFinish - bFinish;

        return (b.avg_score ?? 0) - (a.avg_score ?? 0);
      });

    const allTimePlayedResults = safeResults.filter(
      (row) => (row.fantasy_points ?? 0) > 0
    );

    const highestScoreRow = [...allTimePlayedResults].sort(
      (a, b) => (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0)
    )[0];

    const lowestScoreRow = [...allTimePlayedResults].sort(
      (a, b) => (a.fantasy_points ?? 0) - (b.fantasy_points ?? 0)
    )[0];

    const allTimeRunnerUps = safeTeams
      .map((team) => ({
        name: team.name,
        runnerUps: allTimePlayedResults.filter(
          (row) => row.team_id === team.id && row.finish_position === 2
        ).length,
      }))
      .sort((a, b) => b.runnerUps - a.runnerUps)[0];

    const allTimeAverageScores = safeTeams
      .map((team) => {
        const rows = allTimePlayedResults.filter((row) => row.team_id === team.id);
        const scores = rows.map((row) => Number(row.fantasy_points ?? 0));
        return {
          name: team.name,
          avg:
            scores.length > 0
              ? roundTo(scores.reduce((sum, value) => sum + value, 0) / scores.length)
              : 0,
          count: scores.length,
        };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.avg - a.avg)[0];

    const funFacts = [
      highestScoreRow
        ? {
            label: "Highest Score (All Time)",
            value: `${safeTeams.find((team) => team.id === highestScoreRow.team_id)?.name ?? "Unknown"} • ${roundTo(
              Number(highestScoreRow.fantasy_points ?? 0)
            )}`,
            detail: "Single-slate peak score",
          }
        : null,
      lowestScoreRow
        ? {
            label: "Lowest Score (All Time)",
            value: `${safeTeams.find((team) => team.id === lowestScoreRow.team_id)?.name ?? "Unknown"} • ${roundTo(
              Number(lowestScoreRow.fantasy_points ?? 0)
            )}`,
            detail: "Lowest non-zero single-slate score",
          }
        : null,
      allTimeRunnerUps
        ? {
            label: "Most Runner-Ups (All Time)",
            value: `${allTimeRunnerUps.name} • ${allTimeRunnerUps.runnerUps}`,
          }
        : null,
      allTimeAverageScores
        ? {
            label: "Best Average Score (All Time)",
            value: `${allTimeAverageScores.name} • ${allTimeAverageScores.avg}`,
            detail: `${allTimeAverageScores.count} slates played`,
          }
        : null,
    ].filter(Boolean);

    return NextResponse.json({
      success: true,
      latestSlate: latestSlate
        ? {
            id: latestSlate.id,
            date: latestSlate.date,
            start_date: latestSlate.start_date,
            end_date: latestSlate.end_date,
            label: formatSlateLabel(latestSlate.start_date, latestSlate.end_date),
            is_locked: latestSlate.is_locked,
          }
        : null,
      latestSlateRows,
      seasonSnapshot,
      funFacts,
      latestSeason,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading home summary." },
      { status: 500 }
    );
  }
}
