import { NextResponse } from "next/server";
import { formatSlateDateLabel } from "@/lib/formatSlateLabel";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ProfileScope } from "@/lib/profile/profileScope";

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function getSeasonFromSlate(slate: any) {
  const date = slate?.start_date ?? slate?.date ?? "";
  return date ? new Date(`${date}T00:00:00`).getFullYear() : new Date().getFullYear();
}

const MILESTONE_THRESHOLDS: Record<string, { score175: number; score200: number; score225: number; score250: number; photoFinishMargin: number; statementWinMargin: number }> = {
  nba: {
    score175: 175,
    score200: 200,
    score225: 225,
    score250: 250,
    photoFinishMargin: 2,
    statementWinMargin: 30,
  },
  // Placeholder NFL thresholds — NFL fantasy scoring runs on a different
  // scale than NBA's. Revisit these once real NFL slate data exists to
  // calibrate against.
  nfl: {
    score175: 120,
    score200: 140,
    score225: 160,
    score250: 180,
    photoFinishMargin: 2,
    statementWinMargin: 25,
  },
};

export async function getFantasyTeamProfile(
  req: Request,
  forcedSport: "nba" | "nfl",
  scope: ProfileScope,
) {
  try {
    const { searchParams } = new URL(req.url);
    const teamId = Number(searchParams.get("teamId"));
    const seasonParam = searchParams.get("season");
    const isAllTime = !seasonParam || seasonParam === "all";
    const sport = forcedSport;

    if (!teamId || Number.isNaN(teamId)) {
      return NextResponse.json({ error: "Missing or invalid teamId." }, { status: 400 });
    }

    const playersTable =
      sport === "nfl"
        ? "players_nfl"
        : "players";

    const statsTable =
      sport === "nfl"
        ? "player_nfl_slate_stats"
        : "player_slate_stats";

    const positionColumn =
      sport === "nfl"
        ? "position"
        : "position_group";

    const thresholds =
      MILESTONE_THRESHOLDS[
        sport
      ];

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
      { data: teamUser },
      { data: leagueAwards },
    ] = await Promise.all([
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .eq("id", teamId)
        .eq("group_id", scope.groupId)
        .single(),
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .eq("group_id", scope.groupId),
      supabaseAdmin
        .from("slates")
        .select(
          "id, date, start_date, end_date, is_locked, league_id"
        )
        .eq(
          "league_id",
          scope.leagueId,
        ),
      supabaseAdmin.from("team_slate_results").select("*"),
      supabaseAdmin
        .from("lineups")
        .select("id, slate_id, team_id")
        .order("slate_id", { ascending: false })
        .range(0, 20000),
      supabaseAdmin
        .from("lineup_players")
        .select("lineup_id, player_id")
        .order("lineup_id", { ascending: false })
        .range(0, 20000),
      supabaseAdmin
        .from(playersTable)
        .select(`id, name, position_group:${positionColumn}`),
      supabaseAdmin
        .from(statsTable)
        .select("*")
        .order("slate_id", { ascending: false })
        .range(0, 20000),
      supabaseAdmin.from("slate_team_configs").select("slate_id, team_id, draft_order, is_participating"),
      supabaseAdmin
        .from("app_users")
        .select("avatar_url")
        .eq("team_id", teamId)
        .maybeSingle(),
      supabaseAdmin
        .from("league_awards")
        .select(
          "id, season, team_id, title, emoji, description, rarity, display_order, featured"
        )
        .eq("team_id", teamId)
        .eq(
          "league_id",
          scope.leagueId,
        )
        .eq("sport", sport)
        .order("season", { ascending: false })
        .order("featured", { ascending: false })
        .order("display_order", { ascending: true })
        .order("id", { ascending: true }),
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
    const slateIds = new Set(safeSlates.map((s: any) => s.id));
    const playerMap = new Map(safePlayers.map((p: any) => [p.id, p]));
    const statBySlatePlayerKey = new Map(
      safePlayerStats
        .filter((stat: any) => slateIds.has(stat.slate_id))
        .map((stat: any) => [
          `${Number(stat.slate_id)}-${Number(stat.player_id)}`,
          stat,
        ])
    );

    const latestSeason =
      safeSlates.length > 0
        ? Math.max(...safeSlates.map((slate: any) => getSeasonFromSlate(slate)))
        : new Date().getFullYear();

    const allTeamRows = safeResults
      .filter((r: any) => r.team_id === teamId && slateIds.has(r.slate_id) && (r.fantasy_points ?? 0) > 0)
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

        const isCompleted =
          (result.games_completed ?? 0) > 0 &&
          (result.games_in_progress ?? 0) === 0 &&
          (result.games_remaining ?? 0) === 0;

        const draftedPlayerStats = draftedPlayerIds
          .map((playerId: number) => {
            const player = playerMap.get(playerId);
            const stat = statBySlatePlayerKey.get(`${Number(result.slate_id)}-${Number(playerId)}`);

            return {
              playerId,
              playerName: player?.name ?? "Unknown Player",
              positionGroup: player?.position_group ?? null,
              fantasyPoints: stat?.fantasy_points ?? null,
            };
          })
          .filter((p: any) => p.fantasyPoints !== null);

        const draftedIds = draftedPlayerIds.map((id: any) => Number(id));

        const topPlayer =
          safePlayerStats
            .filter(
              (stat: any) =>
                Number(stat.slate_id) === Number(result.slate_id) &&
                draftedIds.includes(Number(stat.player_id)) &&
                (stat.fantasy_points ?? 0) > 0
            )
            .map((stat: any) => {
              const player = playerMap.get(Number(stat.player_id));

              return {
                playerId: Number(stat.player_id),
                playerName: player?.name ?? "Unknown Player",
                positionGroup: player?.position_group ?? null,
                fantasyPoints: stat.fantasy_points ?? null,
              };
            })
            .sort((a: any, b: any) => (b.fantasyPoints ?? 0) - (a.fantasyPoints ?? 0))[0] ??
          null;

        return {
          slateId: result.slate_id,
          slateLabel: formatSlateDateLabel(slate),
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

    const selectedSeason =
      !isAllTime && Number.isFinite(Number(seasonParam))
        ? Number(seasonParam)
        : latestSeason;

    const selectedRows = isAllTime
      ? completedRows
      : completedRows.filter((row: any) => row.season === selectedSeason);

    const seasonRows = selectedRows;

    function summarize(rows: any[]) {
      const scores = rows.map((row) => Number(row.score ?? 0));
      const finishes = rows
        .map((row) => row.finishPosition)
        .filter((v) => v !== null && v !== undefined);

      const wins = rows.filter((row) => row.finishPosition === 1).length;
      const runnerUps = rows.filter((row) => row.finishPosition === 2).length;
      const podiumFinishes = rows.filter(
        (row) =>
          row.finishPosition !== null &&
          row.finishPosition !== undefined &&
          Number(row.finishPosition) <= 3
      ).length;

      return {
        slatesPlayed: rows.length,
        wins,
        runnerUps,
        podiumFinishes,
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
      .filter((l: any) => l.team_id === teamId && slateIds.has(l.slate_id))
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

    const bestPickEver =
      allTeamRows
        .flatMap((row: any) => {
          const lineup = safeLineups.find(
            (l: any) => l.slate_id === row.slateId && l.team_id === teamId
          );

          if (!lineup) return [];

          return safeLineupPlayers
            .filter((lp: any) => lp.lineup_id === lineup.id)
            .map((lp: any) => {
              const player = playerMap.get(lp.player_id);
              const stat = safePlayerStats.find(
                (s: any) => s.slate_id === row.slateId && s.player_id === lp.player_id
              );

              return {
                playerId: lp.player_id,
                playerName: player?.name ?? "Unknown Player",
                fantasyPoints: stat?.fantasy_points ?? null,
                slateLabel: row.slateLabel,
                finishPosition: row.finishPosition,
              };
            });
        })
        .filter((pick: any) => pick.fantasyPoints !== null)
        .sort((a: any, b: any) => Number(b.fantasyPoints ?? 0) - Number(a.fantasyPoints ?? 0))[0] ?? null;

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

    const chronologicalRows = [...completedRows].sort((a: any, b: any) =>
      String(a.slateStart).localeCompare(String(b.slateStart))
    );

    function countConsecutiveWindows(
      rows: any[],
      requiredLength: number,
      predicate: (row: any) => boolean
    ) {
      let count = 0;

      for (let index = 0; index <= rows.length - requiredLength; index += 1) {
        const window = rows.slice(index, index + requiredLength);

        if (window.every(predicate)) {
          count += 1;
        }
      }

      return count;
    }

    function getLongestStreak(
      rows: any[],
      predicate: (row: any) => boolean
    ) {
      let longest = 0;
      let current = 0;

      rows.forEach((row) => {
        if (predicate(row)) {
          current += 1;
          longest = Math.max(longest, current);
        } else {
          current = 0;
        }
      });

      return longest;
    }

    const score175 = completedRows.filter(
      (row: any) => Number(row.score) >= thresholds.score175
    ).length;

    const score200 = completedRows.filter(
      (row: any) => Number(row.score) >= thresholds.score200
    ).length;

    const score225 = completedRows.filter(
      (row: any) => Number(row.score) >= thresholds.score225
    ).length;

    const score250 = completedRows.filter(
      (row: any) => Number(row.score) >= thresholds.score250
    ).length;

    const backToBackWins = countConsecutiveWindows(
      chronologicalRows,
      2,
      (row) => row.finishPosition === 1
    );

    const threePeats = countConsecutiveWindows(
      chronologicalRows,
      3,
      (row) => row.finishPosition === 1
    );

    const longestPodiumStreak = getLongestStreak(
      chronologicalRows,
      (row) =>
        row.finishPosition !== null &&
        Number(row.finishPosition) <= 2
    );

    const winningMargins = completedRows
      .filter((row: any) => row.finishPosition === 1)
      .map((row: any) => {
        const slateResults = safeResults
          .filter(
            (result: any) =>
              Number(result.slate_id) === Number(row.slateId) &&
              slateIds.has(result.slate_id) &&
              Number(result.fantasy_points ?? 0) > 0
          )
          .sort(
            (a: any, b: any) =>
              Number(b.fantasy_points ?? 0) -
              Number(a.fantasy_points ?? 0)
          );

        const winningResult = slateResults.find(
          (result: any) => Number(result.team_id) === Number(teamId)
        );

        const runnerUpResult = slateResults.find(
          (result: any) => Number(result.team_id) !== Number(teamId)
        );

        if (!winningResult || !runnerUpResult) return null;

        return round(
          Number(winningResult.fantasy_points ?? 0) -
            Number(runnerUpResult.fantasy_points ?? 0)
        );
      })
      .filter(
        (margin: number | null): margin is number =>
          margin !== null && margin >= 0
      );

    const photoFinishMargins = winningMargins.filter(
      (margin) => margin < thresholds.photoFinishMargin
    );

    const statementWinMargins = winningMargins.filter(
      (margin) => margin >= thresholds.statementWinMargin
    );

    const milestones = {
      score175,
      score200,
      score225,
      score250,
      backToBackWins,
      threePeats,
      longestPodiumStreak,
      photoFinishWins: photoFinishMargins.length,
      statementWins: statementWinMargins.length,
      closestWinningMargin:
        winningMargins.length > 0
          ? round(Math.min(...winningMargins))
          : null,
      largestWinningMargin:
        winningMargins.length > 0
          ? round(Math.max(...winningMargins))
          : null,
    };

    return NextResponse.json({
      success: true,
      sport,

      scope: {
        groupId:
          scope.groupId,

        leagueId:
          scope.leagueId,
      },

      team: {
        id: safeTeam.id,
        name: safeTeam.name,
        avatarUrl: teamUser?.avatar_url ?? null,
      },
      latestSeason,
      selectedSeason: isAllTime ? "all" : selectedSeason,
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
        bestPickEver: bestPickEver
          ? {
              playerId: bestPickEver.playerId,
              playerName: bestPickEver.playerName,
              fantasyPoints: round(Number(bestPickEver.fantasyPoints)),
              slateLabel: bestPickEver.slateLabel,
              finishPosition: bestPickEver.finishPosition,
            }
          : null,
        bestSlate,
        worstSlate,
      },
      milestones,
      milestoneThresholds: thresholds,
      leagueAwards: leagueAwards ?? [],
      recentSlates: selectedRows.slice(0, 8),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading team profile." },
      { status: 500 }
    );
  }
}
