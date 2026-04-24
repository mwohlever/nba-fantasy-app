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

type SeasonTeamSummary = {
  season: number;
  team_id: number;
  runner_ups: number | null;
};

type Lineup = {
  id: number;
  slate_id: number;
  team_id: number;
};

type LineupPlayer = {
  lineup_id: number;
  player_id: number;
};

type Player = {
  id: number;
  name: string;
};

type PlayerSlateStat = {
  slate_id: number;
  player_id: number;
  fantasy_points: number | null;
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
      { data: lineups, error: lineupsError },
      { data: lineupPlayers, error: lineupPlayersError },
      { data: players, error: playersError },
      { data: playerSlateStats, error: playerSlateStatsError },
      { data: seasonTeamSummary, error: seasonTeamSummaryError },
    ] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
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
      supabaseAdmin.from("lineups").select("id, slate_id, team_id"),
      supabaseAdmin.from("lineup_players").select("lineup_id, player_id"),
      supabaseAdmin.from("players").select("id, name").order("name", { ascending: true }),
      supabaseAdmin.from("player_slate_stats").select("slate_id, player_id, fantasy_points"),
      supabaseAdmin.from("season_team_summary").select("season, team_id, runner_ups"),
    ]);

    if (
      teamsError ||
      slatesError ||
      teamSlateResultsError ||
      lineupsError ||
      lineupPlayersError ||
      playersError ||
      playerSlateStatsError ||
      seasonTeamSummaryError
    ) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            slatesError?.message ||
            teamSlateResultsError?.message ||
            lineupsError?.message ||
            lineupPlayersError?.message ||
            playersError?.message ||
            playerSlateStatsError?.message ||
            seasonTeamSummaryError?.message ||
            "Failed to load home summary data.",
        },
        { status: 500 }
      );
    }

    const safeTeams = (teams ?? []) as Team[];
    const safeSlates = (slates ?? []) as Slate[];
    const safeResults = (teamSlateResults ?? []) as TeamSlateResult[];
    const safeLineups = (lineups ?? []) as Lineup[];
    const safeLineupPlayers = (lineupPlayers ?? []) as LineupPlayer[];
    const safePlayers = (players ?? []) as Player[];
    const safePlayerSlateStats = (playerSlateStats ?? []) as PlayerSlateStat[];
    const safeSeasonTeamSummary = (seasonTeamSummary ?? []) as SeasonTeamSummary[];

    const normalizedSlates = safeSlates
      .map((slate) => ({
        ...slate,
        start_date: slate.start_date ?? slate.date,
        end_date: slate.end_date ?? slate.date,
      }))
      .sort((a, b) => {
        if (a.start_date !== b.start_date) {
          return b.start_date.localeCompare(a.start_date);
        }
        return b.end_date.localeCompare(a.end_date);
      });

    const resultsBySlateId = new Map<number, TeamSlateResult[]>();
    safeResults.forEach((row) => {
      const existing = resultsBySlateId.get(row.slate_id) ?? [];
      existing.push(row);
      resultsBySlateId.set(row.slate_id, existing);
    });

    const rowsForSlate = (slateId: number) => resultsBySlateId.get(slateId) ?? [];

    const isLiveSlate = (slateId: number) => {
      const rows = rowsForSlate(slateId);
      if (rows.length === 0) return false;

      return rows.some((row) => (row.games_in_progress ?? 0) > 0);
    };

    const isCompletedSlate = (slateId: number) => {
      const rows = rowsForSlate(slateId);
      if (rows.length === 0) return false;

      const hasAnyCompletedGames = rows.some(
        (row) => (row.games_completed ?? 0) > 0
      );

      if (!hasAnyCompletedGames) return false;

      return rows.every(
        (row) =>
          (row.games_in_progress ?? 0) === 0 &&
          (row.games_remaining ?? 0) === 0
      );
    };

    const liveSlate =
      normalizedSlates.find((slate) => isLiveSlate(slate.id)) ?? null;

    const lastCompletedSlate =
      normalizedSlates.find((slate) => isCompletedSlate(slate.id)) ?? null;

    const latestSlate =
      liveSlate ?? lastCompletedSlate ?? normalizedSlates[0] ?? null;

    const latestSlateRows = latestSlate
      ? safeResults
          .filter((row) => row.slate_id === latestSlate.id)
          .map((row) => ({
            ...row,
            teamName:
              safeTeams.find((team) => team.id === row.team_id)?.name ??
              "Unknown Team",
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
              ? roundTo(
                  finishes.reduce((sum, value) => sum + value, 0) / finishes.length
                )
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

    const lockedSlateIds = new Set(
      normalizedSlates.filter((slate) => slate.is_locked).map((slate) => slate.id)
    );

    const lockedSlatesAscending = [...normalizedSlates]
      .filter((slate) => slate.is_locked)
      .sort((a, b) => {
        if (a.start_date !== b.start_date) {
          return a.start_date.localeCompare(b.start_date);
        }
        return a.end_date.localeCompare(b.end_date);
      });

    const lockedResults = safeResults.filter(
      (row) =>
        lockedSlateIds.has(row.slate_id) &&
        row.finish_position !== null &&
        (row.fantasy_points ?? 0) > 0
    );

    const highestScoreRow = [...lockedResults].sort(
      (a, b) => (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0)
    )[0];

    const lowestScoreRow = [...lockedResults].sort(
      (a, b) => (a.fantasy_points ?? 0) - (b.fantasy_points ?? 0)
    )[0];

    const allTimeRunnerUps = safeTeams
      .map((team) => ({
        name: team.name,
        runnerUps: safeSeasonTeamSummary
          .filter((row) => row.team_id === team.id)
          .reduce((sum, row) => sum + Number(row.runner_ups ?? 0), 0),
      }))
      .sort((a, b) => b.runnerUps - a.runnerUps)[0];

    const allTimeAverageScores = safeTeams
      .map((team) => {
        const rows = lockedResults.filter((row) => row.team_id === team.id);
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

    const lockedWinners = lockedSlatesAscending
      .map((slate) => {
        const winner = safeResults.find(
          (row) =>
            row.slate_id === slate.id &&
            row.finish_position === 1 &&
            (row.fantasy_points ?? 0) > 0
        );

        if (!winner) return null;

        return {
          slate_id: slate.id,
          team_id: winner.team_id,
          team_name:
            safeTeams.find((team) => team.id === winner.team_id)?.name ??
            "Unknown Team",
          start_date: slate.start_date,
          end_date: slate.end_date,
        };
      })
      .filter(Boolean) as Array<{
      slate_id: number;
      team_id: number;
      team_name: string;
      start_date: string;
      end_date: string;
    }>;

    let longestWinStreak:
      | {
          team_name: string;
          streak: number;
        }
      | null = null;

    let currentStreakTeamId: number | null = null;
    let currentStreakTeamName = "";
    let currentStreak = 0;

    for (const winner of lockedWinners) {
      if (winner.team_id === currentStreakTeamId) {
        currentStreak += 1;
      } else {
        currentStreakTeamId = winner.team_id;
        currentStreakTeamName = winner.team_name;
        currentStreak = 1;
      }

      if (!longestWinStreak || currentStreak > longestWinStreak.streak) {
        longestWinStreak = {
          team_name: currentStreakTeamName,
          streak: currentStreak,
        };
      }
    }

    const lineupMap = new Map<number, Lineup>();
    safeLineups.forEach((lineup) => {
      lineupMap.set(lineup.id, lineup);
    });

    const playerMap = new Map<number, Player>();
    safePlayers.forEach((player) => {
      playerMap.set(player.id, player);
    });

    const topLivePerformer =
      liveSlate
        ? safePlayerSlateStats
            .filter(
              (row) =>
                row.slate_id === liveSlate.id &&
                (row.fantasy_points ?? 0) > 0
            )
            .sort(
              (a, b) => (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0)
            )[0]
        : null;

    const topLatestCompletedPerformer =
      lastCompletedSlate
        ? safePlayerSlateStats
            .filter(
              (row) =>
                row.slate_id === lastCompletedSlate.id &&
                (row.fantasy_points ?? 0) > 0
            )
            .sort(
              (a, b) => (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0)
            )[0]
        : null;

    const playerDraftCounts = new Map<number, number>();
    safeLineupPlayers.forEach((row) => {
      playerDraftCounts.set(
        row.player_id,
        (playerDraftCounts.get(row.player_id) ?? 0) + 1
      );
    });

    const mostDraftedPlayer = [...playerDraftCounts.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0];

    const playerScores = new Map<number, number[]>();
    safePlayerSlateStats.forEach((row) => {
      if ((row.fantasy_points ?? 0) <= 0) return;

      const existing = playerScores.get(row.player_id) ?? [];
      existing.push(Number(row.fantasy_points ?? 0));
      playerScores.set(row.player_id, existing);
    });

    const highestAveragePlayer = [...playerScores.entries()]
      .map(([playerId, scores]) => ({
        playerId,
        avg: scores.reduce((sum, value) => sum + value, 0) / scores.length,
        count: scores.length,
      }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.avg - a.avg)[0];

    const winsWhenDrafted = new Map<number, number>();

    safeResults
      .filter((row) => row.finish_position === 1)
      .forEach((winningResult) => {
        const winningLineup = safeLineups.find(
          (lineup) =>
            lineup.slate_id === winningResult.slate_id &&
            lineup.team_id === winningResult.team_id
        );

        if (!winningLineup) return;

        safeLineupPlayers
          .filter((row) => row.lineup_id === winningLineup.id)
          .forEach((row) => {
            winsWhenDrafted.set(
              row.player_id,
              (winsWhenDrafted.get(row.player_id) ?? 0) + 1
            );
          });
      });

    const mostWinsWhenDraftedPlayer = [...winsWhenDrafted.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0];

    const funFacts = [
      topLivePerformer && liveSlate
        ? {
            label: "⚡ Top Performer (Live)",
            value: `${
              playerMap.get(topLivePerformer.player_id)?.name ?? "Unknown Player"
            } • ${roundTo(Number(topLivePerformer.fantasy_points ?? 0))}`,
            detail: formatSlateLabel(liveSlate.start_date, liveSlate.end_date),
          }
        : null,

      topLatestCompletedPerformer && lastCompletedSlate
        ? {
            label: "🔥 Top Performer (Latest Final)",
            value: `${
              playerMap.get(topLatestCompletedPerformer.player_id)?.name ??
              "Unknown Player"
            } • ${roundTo(Number(topLatestCompletedPerformer.fantasy_points ?? 0))}`,
            detail: formatSlateLabel(
              lastCompletedSlate.start_date,
              lastCompletedSlate.end_date
            ),
          }
        : null,

      mostDraftedPlayer
        ? {
            label: "Most Drafted Player",
            value: `${
              playerMap.get(mostDraftedPlayer[0])?.name ?? "Unknown Player"
            } • ${mostDraftedPlayer[1]} drafts`,
          }
        : null,

      highestAveragePlayer
        ? {
            label: "Highest Avg Player",
            value: `${
              playerMap.get(highestAveragePlayer.playerId)?.name ??
              "Unknown Player"
            } • ${roundTo(highestAveragePlayer.avg)} FP`,
            detail: `${highestAveragePlayer.count} recorded games`,
          }
        : null,

      mostWinsWhenDraftedPlayer
        ? {
            label: "Most Wins When Drafted",
            value: `${
              playerMap.get(mostWinsWhenDraftedPlayer[0])?.name ??
              "Unknown Player"
            } • ${mostWinsWhenDraftedPlayer[1]} wins`,
          }
        : null,

      highestScoreRow
        ? {
            label: "Highest Score (All Time)",
            value: `${
              safeTeams.find((team) => team.id === highestScoreRow.team_id)
                ?.name ?? "Unknown"
            } • ${roundTo(Number(highestScoreRow.fantasy_points ?? 0))}`,
            detail: "Single-slate team score",
          }
        : null,

      lowestScoreRow
        ? {
            label: "Lowest Score (All Time)",
            value: `${
              safeTeams.find((team) => team.id === lowestScoreRow.team_id)
                ?.name ?? "Unknown"
            } • ${roundTo(Number(lowestScoreRow.fantasy_points ?? 0))}`,
            detail: "Lowest non-zero single-slate team score",
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
            detail: `${allTimeAverageScores.count} locked slates`,
          }
        : null,

      longestWinStreak
        ? {
            label: "Longest Win Streak",
            value: `${longestWinStreak.team_name} • ${longestWinStreak.streak} in a row`,
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
