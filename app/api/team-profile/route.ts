import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function formatSlateLabel(slate: any) {
  const start = slate?.start_date ?? slate?.date ?? "";
  const end = slate?.end_date ?? slate?.date ?? "";
  return start && end && start !== end ? `${start} - ${end}` : start || "Unknown slate";
}

function getSeasonFromSlate(slate: any) {
  const date = slate?.start_date ?? slate?.date ?? "";
  return date ? new Date(`${date}T00:00:00`).getFullYear() : new Date().getFullYear();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));

    if (!teamId || Number.isNaN(teamId)) {
      return NextResponse.json({ error: "Missing or invalid teamId." }, { status: 400 });
    }

    const [
      { data: team },
      { data: teams },
      { data: slates },
      { data: results },
      { data: lineups },
      { data: lineupPlayers },
      { data: players },
      { data: playerStats },
      { data: slateTeamConfigs },
    ] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name").eq("id", teamId).single(),
      supabaseAdmin.from("teams").select("id, name"),
      supabaseAdmin.from("slates").select("id, date, start_date, end_date, is_locked"),
      supabaseAdmin.from("team_slate_results").select("*"),
      supabaseAdmin.from("lineups").select("id, slate_id, team_id"),
      supabaseAdmin.from("lineup_players").select("lineup_id, player_id"),
      supabaseAdmin.from("players").select("id, name, position_group"),
      supabaseAdmin.from("player_slate_stats").select("*"),
      supabaseAdmin.from("slate_team_configs").select("slate_id, team_id, draft_order, is_participating"),
    ]);

    const safeTeam = team ?? { id: teamId, name: "Unknown Team" };
    const safeSlates = slates ?? [];
    const safeResults = results ?? [];
    const safeLineups = lineups ?? [];
    const safeLineupPlayers = lineupPlayers ?? [];
    const safePlayers = players ?? [];
    const safePlayerStats = playerStats ?? [];
    const safeSlateTeamConfigs = slateTeamConfigs ?? [];

    const slateMap = new Map(safeSlates.map((s: any) => [s.id, s]));
    const playerMap = new Map(safePlayers.map((p: any) => [p.id, p]));

    const latestSeason =
      safeSlates.length > 0
        ? Math.max(...safeSlates.map((slate: any) => getSeasonFromSlate(slate)))
        : new Date().getFullYear();

    const allTeamRows = safeResults
      .filter((r: any) => r.team_id === teamId && (r.fantasy_points ?? 0) > 0)
      .map((result: any) => {
        const slate = slateMap.get(result.slate_id);
        const lineup = safeLineups.find(
          (l: any) => l.slate_id === result.slate_id && l.team_id === teamId
        );
        const config = safeSlateTeamConfigs.find(
          (c: any) => c.slate_id === result.slate_id && c.team_id === teamId
        );

        const draftedPlayerIds = lineup
          ? safeLineupPlayers
              .filter((lp: any) => lp.lineup_id === lineup.id)
              .map((lp: any) => lp.player_id)
          : [];

        const draftedPlayerStats = draftedPlayerIds
          .map((playerId: number) => {
            const player = playerMap.get(playerId);
            const stat = safePlayerStats.find(
              (s: any) => s.slate_id === result.slate_id && s.player_id === playerId
            );

            return {
              playerId,
              playerName: player?.name ?? "Unknown Player",
              positionGroup: player?.position_group ?? null,
              fantasyPoints: stat?.fantasy_points ?? null,
            };
          })
          .filter((p: any) => p.fantasyPoints !== null);

        const topPlayer =
          [...draftedPlayerStats].sort(
            (a: any, b: any) => (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0)
          )[0] ?? null;

        return {
          slateId: result.slate_id,
          slateLabel: formatSlateLabel(slate),
          slateStart: slate?.start_date ?? slate?.date ?? "",
          season: getSeasonFromSlate(slate),
          score: Number(result.fantasy_points ?? 0),
          finishPosition: result.finish_position ?? null,
          gamesCompleted: result.games_completed ?? 0,
          gamesInProgress: result.games_in_progress ?? 0,
          gamesRemaining: result.games_remaining ?? 0,
          draftPosition: config?.draft_order ?? null,
          topPlayer,
        };
      })
      .sort((a: any, b: any) => String(b.slateStart).localeCompare(String(a.slateStart)));

    const completedRows = allTeamRows.filter(
      (row: any) =>
        (row.gamesCompleted ?? 0) > 0 &&
        (row.gamesInProgress ?? 0) === 0 &&
        (row.gamesRemaining ?? 0) === 0
    );

    const seasonRows = completedRows.filter((row: any) => row.season === latestSeason);

    function summarize(rows: any[]) {
      const scores = rows.map((row) => Number(row.score ?? 0));
      const finishes = rows
        .map((row) => row.finishPosition)
        .filter((v) => v !== null && v !== undefined);

      const wins = rows.filter((row) => row.finishPosition === 1).length;
      const runnerUps = rows.filter((row) => row.finishPosition === 2).length;

      return {
        slatesPlayed: rows.length,
        wins,
        runnerUps,
        winRate: rows.length > 0 ? round((wins / rows.length) * 100, 1) : null,
        avgFinish:
          finishes.length > 0
            ? round(finishes.reduce((sum: number, value: number) => sum + value, 0) / finishes.length)
            : null,
        avgScore:
          scores.length > 0
            ? round(scores.reduce((sum: number, value: number) => sum + value, 0) / scores.length)
            : null,
      };
    }

    const seasonSummary = summarize(seasonRows);
    const careerSummaryBase = summarize(completedRows);

    const bestSlate =
      [...completedRows].sort((a: any, b: any) => b.score - a.score)[0] ?? null;
    const worstSlate =
      [...completedRows].sort((a: any, b: any) => a.score - b.score)[0] ?? null;

    const playerDraftCounts = new Map<number, number>();
    const playerScores = new Map<number, number[]>();

    safeLineups
      .filter((l: any) => l.team_id === teamId)
      .forEach((lineup: any) => {
        safeLineupPlayers
          .filter((lp: any) => lp.lineup_id === lineup.id)
          .forEach((lp: any) => {
            playerDraftCounts.set(lp.player_id, (playerDraftCounts.get(lp.player_id) ?? 0) + 1);

            const stat = safePlayerStats.find(
              (s: any) => s.slate_id === lineup.slate_id && s.player_id === lp.player_id
            );

            if ((stat?.fantasy_points ?? 0) > 0) {
              const existing = playerScores.get(lp.player_id) ?? [];
              existing.push(Number(stat.fantasy_points));
              playerScores.set(lp.player_id, existing);
            }
          });
      });

    const favoritePlayerEntry =
      [...playerDraftCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    const bestAvgPlayer =
      [...playerScores.entries()]
        .map(([playerId, scores]) => ({
          playerId,
          avg: scores.reduce((sum, value) => sum + value, 0) / scores.length,
          count: scores.length,
        }))
        .sort((a, b) => b.avg - a.avg)[0] ?? null;

    function getWinStreaks(rows: any[]) {
      let longest = 0;
      let current = 0;
      let running = 0;

      [...rows]
        .sort((a, b) => String(a.slateStart).localeCompare(String(b.slateStart)))
        .forEach((row) => {
          if (row.finishPosition === 1) {
            running += 1;
            longest = Math.max(longest, running);
          } else {
            running = 0;
          }
        });

      [...rows]
        .sort((a, b) => String(b.slateStart).localeCompare(String(a.slateStart)))
        .some((row) => {
          if (row.finishPosition === 1) {
            current += 1;
            return false;
          }
          return true;
        });

      return { current, longest };
    }

    const seasonStreaks = getWinStreaks(seasonRows);
    const careerStreaks = getWinStreaks(completedRows);

    return NextResponse.json({
      success: true,
      team: {
        id: safeTeam.id,
        name: safeTeam.name,
      },
      latestSeason,
      seasonSummary: {
        ...seasonSummary,
        currentWinStreak: seasonStreaks.current,
        longestWinStreak: seasonStreaks.longest,
      },
      careerSummary: {
        ...careerSummaryBase,
        bestScore: bestSlate ? round(bestSlate.score) : null,
        worstScore: worstSlate ? round(worstSlate.score) : null,
        longestWinStreak: careerStreaks.longest,
        favoritePlayer: favoritePlayerEntry
          ? {
              playerId: favoritePlayerEntry[0],
              playerName: playerMap.get(favoritePlayerEntry[0])?.name ?? "Unknown Player",
              count: favoritePlayerEntry[1],
            }
          : null,
        bestAvgPlayer: bestAvgPlayer
          ? {
              playerId: bestAvgPlayer.playerId,
              playerName: playerMap.get(bestAvgPlayer.playerId)?.name ?? "Unknown Player",
              avg: round(bestAvgPlayer.avg),
              count: bestAvgPlayer.count,
            }
          : null,
        bestSlate,
        worstSlate,
      },
      recentSlates: allTeamRows.slice(0, 8),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading team profile." },
      { status: 500 }
    );
  }
}
