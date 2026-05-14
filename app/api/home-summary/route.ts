import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPlayerProjectionMapForSeason } from "@/lib/playerProjections";

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
  first_game_start_time: string | null;
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
  nba_player_id: number | null;
};

type PlayerSlateStat = {
  slate_id: number;
  player_id: number;
  fantasy_points: number | null;
  game_status: number | null;
  game_status_text: string | null;
  period: number | null;
  game_clock: string | null;
};

type NbaSeasonAverage = {
  season: string;
  nba_player_id: number;
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

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function getNbaSeason(appSeason: string) {
  const year = Number(appSeason);
  if (!Number.isFinite(year)) return "2025-26";
  return `${year - 1}-${String(year).slice(-2)}`;
}

function parseNbaIsoClockMinutes(gameClock?: string | null) {
  if (!gameClock) return null;

  const match = gameClock.match(/^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return null;

  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2] ?? 0);

  return minutes + seconds / 60;
}

function parseStatusTextMinutesRemaining(statusText?: string | null) {
  if (!statusText) return null;

  const trimmed = statusText.trim();
  if (/final/i.test(trimmed)) return 0;

  const match = trimmed.match(/^Q(\d+)\s+(?:(\d*)?:)?(\d+(?:\.\d+)?)$/i);
  if (!match) return null;

  const period = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] ?? 0);

  const clockMinutes = minutes + seconds / 60;
  const periodsRemainingAfterCurrent = Math.max(4 - period, 0);

  return periodsRemainingAfterCurrent * 12 + clockMinutes;
}

function getMinutesRemainingForStat(stat?: PlayerSlateStat | null) {
  const gameStatus = stat?.game_status ?? null;

  if (gameStatus === 3) return 0;

  const period = stat?.period ?? null;
  const clockMinutes = parseNbaIsoClockMinutes(stat?.game_clock);

  if (gameStatus === 2 && period && clockMinutes !== null) {
    const periodsRemainingAfterCurrent = Math.max(4 - period, 0);
    return periodsRemainingAfterCurrent * 12 + clockMinutes;
  }

  const statusTextMinutes = parseStatusTextMinutesRemaining(stat?.game_status_text);
  if (statusTextMinutes !== null) return statusTextMinutes;

  return 48;
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
      { data: nbaSeasonAverages, error: nbaSeasonAveragesError },
    ] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
      supabaseAdmin
        .from("slates")
        .select("id, date, start_date, end_date, is_locked, first_game_start_time")
        .order("start_date", { ascending: false })
        .order("end_date", { ascending: false }),
      supabaseAdmin
        .from("team_slate_results")
        .select(
          "slate_id, team_id, fantasy_points, finish_position, games_completed, games_in_progress, games_remaining"
        ),
      supabaseAdmin
        .from("lineups")
        .select("id, slate_id, team_id")
        .range(0, 20000),
      supabaseAdmin
        .from("lineup_players")
        .select("lineup_id, player_id")
        .range(0, 20000),
      supabaseAdmin.from("players").select("id, name, nba_player_id").order("name", { ascending: true }),
      supabaseAdmin
        .from("player_slate_stats")
        .select("slate_id, player_id, fantasy_points, game_status, game_status_text, period, game_clock")
        .order("slate_id", { ascending: false })
        .range(0, 20000),
      supabaseAdmin.from("season_team_summary").select("season, team_id, runner_ups"),
      supabaseAdmin
        .from("player_nba_season_averages")
        .select("season, nba_player_id, fantasy_points")
        .range(0, 5000),
    ]);

    if (
      teamsError ||
      slatesError ||
      teamSlateResultsError ||
      lineupsError ||
      lineupPlayersError ||
      playersError ||
      playerSlateStatsError ||
      seasonTeamSummaryError ||
      nbaSeasonAveragesError
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
            nbaSeasonAveragesError?.message ||
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
    const safeNbaSeasonAverages = (nbaSeasonAverages ?? []) as NbaSeasonAverage[];

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

    const now = new Date();

    const liveSlate =
      normalizedSlates.find((slate) => isLiveSlate(slate.id)) ?? null;

    const upcomingOpenSlates = normalizedSlates
      .filter(
        (slate) =>
          !slate.is_locked &&
          slate.first_game_start_time &&
          new Date(slate.first_game_start_time) > now
      )
      .sort(
        (a, b) =>
          new Date(a.first_game_start_time ?? 0).getTime() -
          new Date(b.first_game_start_time ?? 0).getTime()
      );

    const nextSlate = upcomingOpenSlates[0] ?? null;

    const startedOpenSlate =
      normalizedSlates
        .filter(
          (slate) =>
            !slate.is_locked &&
            slate.first_game_start_time &&
            new Date(slate.first_game_start_time) <= now
        )
        .sort(
          (a, b) =>
            new Date(b.first_game_start_time ?? 0).getTime() -
            new Date(a.first_game_start_time ?? 0).getTime()
        )[0] ?? null;

    const lastCompletedSlate = safeSlates
      .filter((s: any) => s.is_locked)
      .sort(
        (a: any, b: any) =>
          new Date(b.end_date || b.start_date).getTime() -
          new Date(a.end_date || a.start_date).getTime()
      )[0];

    const latestSlate =
      liveSlate ??
      startedOpenSlate ??
      lastCompletedSlate ??
      nextSlate ??
      normalizedSlates[0] ??
      null;

    const latestProjectionSeason = latestSlate
      ? getSeasonFromDate(latestSlate.start_date)
      : new Date().getFullYear();

    const latestNbaSeason = getNbaSeason(String(latestProjectionSeason));

    const projectionByPlayerId = await getPlayerProjectionMapForSeason(String(latestProjectionSeason));

    const nbaAverageByNbaId = new Map<number, number>();
    safeNbaSeasonAverages
      .filter((row) => row.season === latestNbaSeason)
      .forEach((row) => {
        const average = Number(row.fantasy_points ?? 0);
        if (Number.isFinite(average) && average > 0) {
          nbaAverageByNbaId.set(Number(row.nba_player_id), average);
        }
      });

    const normalizedSlateById = new Map<number, (typeof normalizedSlates)[number]>();
    normalizedSlates.forEach((slate) => {
      normalizedSlateById.set(slate.id, slate);
    });

    const projectionSlateIds = new Set(
      normalizedSlates
        .filter((slate) => getSeasonFromDate(slate.start_date) === latestProjectionSeason)
        .map((slate) => slate.id)
    );

    const lineupByIdForProjection = new Map<number, Lineup>();
    safeLineups.forEach((lineup) => {
      lineupByIdForProjection.set(lineup.id, lineup);
    });

    const statBySlateAndPlayer = new Map<string, PlayerSlateStat>();
    safePlayerSlateStats.forEach((stat) => {
      statBySlateAndPlayer.set(`${stat.slate_id}:${stat.player_id}`, stat);
    });

    const finishBySlateAndTeam = new Map<string, number>();
    safeResults.forEach((result) => {
      const finish = Number(result.finish_position);
      if (Number.isFinite(finish) && finish > 0) {
        finishBySlateAndTeam.set(`${result.slate_id}:${result.team_id}`, finish);
      }
    });

    const scoresByPlayer = new Map<number, Array<{ score: number; slateDate: string }>>();
    const finishesByPlayer = new Map<number, number[]>();

    safeLineupPlayers.forEach((lineupPlayer) => {
      const lineup = lineupByIdForProjection.get(lineupPlayer.lineup_id);
      if (!lineup || !projectionSlateIds.has(lineup.slate_id)) return;

      const slate = normalizedSlateById.get(lineup.slate_id);
      const stat = statBySlateAndPlayer.get(`${lineup.slate_id}:${lineupPlayer.player_id}`);
      const score = Number(stat?.fantasy_points ?? 0);

      if (Number.isFinite(score) && score > 0) {
        const existingScores = scoresByPlayer.get(lineupPlayer.player_id) ?? [];
        existingScores.push({
          score,
          slateDate: slate?.start_date ?? "",
        });
        scoresByPlayer.set(lineupPlayer.player_id, existingScores);
      }

      const finish = finishBySlateAndTeam.get(`${lineup.slate_id}:${lineup.team_id}`);
      if (typeof finish === "number") {
        const existingFinishes = finishesByPlayer.get(lineupPlayer.player_id) ?? [];
        existingFinishes.push(finish);
        finishesByPlayer.set(lineupPlayer.player_id, existingFinishes);
      }
    });

    const fallbackProjectionByPlayerId = new Map<number, number>();

    safePlayers.forEach((player) => {
      const scoreRows = (scoresByPlayer.get(player.id) ?? []).sort((a, b) =>
        a.slateDate.localeCompare(b.slateDate)
      );

      const scores = scoreRows.map((row) => row.score);
      const finishes = finishesByPlayer.get(player.id) ?? [];
      const draftedCount = scores.length;

      const seasonAvg =
        scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : null;

      const recentScores = scores.slice(-3);
      const recentAvg =
        recentScores.length > 0
          ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
          : null;

      const avgFinish =
        finishes.length > 0
          ? finishes.reduce((sum, finish) => sum + finish, 0) / finishes.length
          : null;

      const nbaSeasonAverage = player.nba_player_id
        ? nbaAverageByNbaId.get(Number(player.nba_player_id)) ?? null
        : null;

      let projection: number | null = null;

      if (draftedCount >= 2 && seasonAvg !== null && recentAvg !== null) {
        const finishBoost =
          avgFinish !== null
            ? Math.max(-3, Math.min(3, (2.5 - avgFinish) * 1.25))
            : 0;

        const nbaAnchor = nbaSeasonAverage ?? seasonAvg;

        projection = round1(
          nbaAnchor * 0.5 +
            seasonAvg * 0.3 +
            recentAvg * 0.2 +
            finishBoost
        );

        const badgeBaseline = nbaSeasonAverage ?? seasonAvg;

        if (badgeBaseline !== null && recentAvg >= badgeBaseline + 2.5) {
          projection = round1(projection + 1.5);
        }

        if (badgeBaseline !== null && recentAvg <= badgeBaseline - 2.5) {
          projection = round1(projection - 1.5);
        }
      } else if (nbaSeasonAverage !== null) {
        projection = round1(nbaSeasonAverage);
      }

      if (projection !== null) {
        fallbackProjectionByPlayerId.set(player.id, projection);
        if (!projectionByPlayerId.has(player.id)) {
          projectionByPlayerId.set(player.id, projection);
        }
      }
    });

    const latestLineupsByTeamId = new Map<number, Lineup>();
    const latestPlayerIdsByLineupId = new Map<number, number[]>();

    if (latestSlate) {
      const { data: latestLineupsData, error: latestLineupsError } =
        await supabaseAdmin
          .from("lineups")
          .select("id, slate_id, team_id")
          .eq("slate_id", latestSlate.id);

      if (latestLineupsError) {
        return NextResponse.json(
          { error: latestLineupsError.message },
          { status: 500 }
        );
      }

      const latestLineups = (latestLineupsData ?? []) as Lineup[];

      latestLineups.forEach((lineup) => {
        latestLineupsByTeamId.set(lineup.team_id, lineup);
      });

      const latestLineupIds = latestLineups.map((lineup) => lineup.id);

      if (latestLineupIds.length > 0) {
        const { data: latestLineupPlayersData, error: latestLineupPlayersError } =
          await supabaseAdmin
            .from("lineup_players")
            .select("lineup_id, player_id")
            .in("lineup_id", latestLineupIds);

        if (latestLineupPlayersError) {
          return NextResponse.json(
            { error: latestLineupPlayersError.message },
            { status: 500 }
          );
        }

        (latestLineupPlayersData ?? []).forEach((lineupPlayer) => {
          const existing =
            latestPlayerIdsByLineupId.get(Number(lineupPlayer.lineup_id)) ?? [];

          existing.push(Number(lineupPlayer.player_id));

          latestPlayerIdsByLineupId.set(
            Number(lineupPlayer.lineup_id),
            existing
          );
        });
      }
    }

    function getProjectedTeamTotal(teamId: number) {
      if (!latestSlate) return 0;

      const result = safeResults.find(
        (row) => row.slate_id === latestSlate.id && row.team_id === teamId
      );

      if (latestSlate.is_locked) {
        return Number(result?.fantasy_points ?? 0);
      }

      const lineup = latestLineupsByTeamId.get(teamId);
      if (!lineup) return Number(result?.fantasy_points ?? 0);

      const playerIds = latestPlayerIdsByLineupId.get(lineup.id) ?? [];

      let hasRemainingUpside = false;

      const projectedTotal = playerIds.reduce((sum, playerId) => {
        const stat = statBySlateAndPlayer.get(`${latestSlate.id}:${playerId}`);
        const current = Number(stat?.fantasy_points ?? 0);
        const projection = projectionByPlayerId.get(playerId) ?? 0;
        const minutesRemaining = getMinutesRemainingForStat(stat);

        if (minutesRemaining <= 0) {
          return sum + current;
        }

        hasRemainingUpside = true;

        return sum + current + projection * (minutesRemaining / 48);
      }, 0);

      if (!hasRemainingUpside) {
        return Number(result?.fantasy_points ?? 0);
      }

      return projectedTotal;
    }

    const latestSlateRowsBase = latestSlate
      ? safeResults
          .filter((row) => row.slate_id === latestSlate.id)
          .map((row) => ({
            ...row,
            teamName:
              safeTeams.find((team) => team.id === row.team_id)?.name ??
              "Unknown Team",
            projected_points: round1(getProjectedTeamTotal(row.team_id)),
            win_probability: 0,

          }))
          .sort((a, b) => {
            const aFinish = a.finish_position ?? 999;
            const bFinish = b.finish_position ?? 999;
            if (aFinish !== bFinish) return aFinish - bFinish;
            return (b.fantasy_points ?? 0) - (a.fantasy_points ?? 0);
          })
      : [];

    const latestSlateRows = (() => {
      if (!latestSlateRowsBase.length) return latestSlateRowsBase;

      if (latestSlate?.is_locked) {
        const winningTeamId = [...latestSlateRowsBase].sort(
          (a, b) => Number(b.fantasy_points ?? 0) - Number(a.fantasy_points ?? 0)
        )[0]?.team_id;

        return latestSlateRowsBase.map((row) => ({
          ...row,
          projected_points: round1(Number(row.fantasy_points ?? 0)),
          win_probability: row.team_id === winningTeamId ? 100 : 0,
        }));
      }

      const bestCurrentScore = Math.max(
        ...latestSlateRowsBase.map((row) => Number(row.fantasy_points ?? 0))
      );

      const slateEndDate = latestSlate?.end_date
        ? new Date(`${latestSlate.end_date}T23:59:59`)
        : null;
      const slateHasEndedByDate = slateEndDate
        ? Date.now() > slateEndDate.getTime()
        : false;

      const teamsWithUpside = latestSlateRowsBase.filter((row) => {
        const currentScore = Number(row.fantasy_points ?? 0);
        const projectedScore = Number(row.projected_points ?? currentScore);
        const gamesInProgress = Number(row.games_in_progress ?? 0);
        const gamesRemaining = Number(row.games_remaining ?? 0);
        const isDone = gamesInProgress === 0 && gamesRemaining === 0;

        if (slateHasEndedByDate && isDone && currentScore < bestCurrentScore) {
          return false;
        }

        return true;
      });

      if (teamsWithUpside.length === 1) {
        const lockedWinnerId = teamsWithUpside[0].team_id;

        return latestSlateRowsBase.map((row) => ({
          ...row,
          win_probability: row.team_id === lockedWinnerId ? 100 : 0,
        }));
      }

      const k = 20;
      const minProbability = 3;
      const maxProbability = 97;

      const weights = teamsWithUpside.map((row) => ({
        teamId: row.team_id,
        weight: Math.exp(Number(row.projected_points ?? 0) / k),
      }));

      const totalWeight = weights.reduce((sum, row) => sum + row.weight, 0);

      const rawProbabilities = weights.map((row) => ({
        teamId: row.teamId,
        probability: totalWeight > 0 ? (row.weight / totalWeight) * 100 : 0,
      }));

      const clampedProbabilities = rawProbabilities.map((row) => ({
        teamId: row.teamId,
        probability: Math.max(
          minProbability,
          Math.min(maxProbability, row.probability)
        ),
      }));

      const clampedTotal = clampedProbabilities.reduce(
        (sum, row) => sum + row.probability,
        0
      );

      const normalizedProbabilities = clampedProbabilities.map((row) => ({
        teamId: row.teamId,
        probability:
          clampedTotal > 0
            ? (row.probability / clampedTotal) * 100
            : 100 / Math.max(clampedProbabilities.length, 1),
      }));

      // Round to whole numbers for display, then correct rounding drift so total = 100.
      const roundedProbabilities = normalizedProbabilities.map((row) => ({
        teamId: row.teamId,
        probability: Math.round(row.probability),
      }));

      const roundedTotal = roundedProbabilities.reduce(
        (sum, row) => sum + row.probability,
        0
      );

      const drift = 100 - roundedTotal;

      if (roundedProbabilities.length > 0 && drift !== 0) {
        const bestTeam = [...normalizedProbabilities].sort(
          (a, b) => b.probability - a.probability
        )[0];

        const target = roundedProbabilities.find(
          (row) => row.teamId === bestTeam.teamId
        );

        if (target) {
          target.probability += drift;
        }
      }

      const probabilityByTeamId = new Map<number, number>();

      roundedProbabilities.forEach((row) => {
        probabilityByTeamId.set(row.teamId, row.probability);
      });

      return latestSlateRowsBase.map((row) => ({
        ...row,
        win_probability: probabilityByTeamId.get(row.team_id) ?? 0,
      }));
    })();

    const latestSeason = latestSlate
      ? getSeasonFromDate(latestSlate.start_date)
      : new Date().getFullYear();

    const slateSeasonMap = new Map<number, number>();
    normalizedSlates.forEach((slate) => {
      slateSeasonMap.set(slate.id, getSeasonFromDate(slate.start_date));
    });

    const lockedSlateIdsForSeasonSnapshot = new Set(
      normalizedSlates.filter((slate) => slate.is_locked).map((slate) => slate.id)
    );

    const currentSeasonResults = safeResults.filter(
      (row) =>
        slateSeasonMap.get(row.slate_id) === latestSeason &&
        lockedSlateIdsForSeasonSnapshot.has(row.slate_id)
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

    const topPlayerLastSlate =
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

    const lockedSlatesWithPlayerStats = normalizedSlates.filter((slate) => {
      if (!slate.is_locked) return false;

      return safePlayerSlateStats.some(
        (stat) => stat.slate_id === slate.id && (stat.fantasy_points ?? 0) > 0
      );
    });

    const latestLockedSlateWithPlayerStats = lockedSlatesWithPlayerStats[0] ?? null;

    const topPlayerLastCompletedSlate =
      latestLockedSlateWithPlayerStats
        ? safePlayerSlateStats
            .filter(
              (stat) =>
                stat.slate_id === latestLockedSlateWithPlayerStats.id &&
                (stat.fantasy_points ?? 0) > 0
            )
            .sort(
              (a, b) =>
                Number(b.fantasy_points ?? 0) - Number(a.fantasy_points ?? 0)
            )[0] ?? null
        : null;

    const topPlayerLastCompletedSlateName = topPlayerLastCompletedSlate
      ? safePlayers.find((player) => player.id === topPlayerLastCompletedSlate.player_id)?.name ??
        "Unknown Player"
      : null;

    const funFacts = [
      ...(topPlayerLastCompletedSlate
        ? [
            {
              label: "Top NBA Player Last Completed Slate",
              value: `${topPlayerLastCompletedSlateName} • ${roundTo(
                Number(topPlayerLastCompletedSlate.fantasy_points ?? 0),
                1
              )} FP`,
            },
          ]
        : []),
      topLivePerformer && liveSlate
        ? {
            label: "⚡ Top Performer (Live)",
            value: `${
              playerMap.get(topLivePerformer.player_id)?.name ?? "Unknown Player"
            } • ${roundTo(Number(topLivePerformer.fantasy_points ?? 0))}`,
            detail: formatSlateLabel(liveSlate.start_date, liveSlate.end_date),
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
            label: "Season High Score",
            value: `${
              safeTeams.find((team) => team.id === highestScoreRow.team_id)
                ?.name ?? "Unknown"
            } • ${roundTo(Number(highestScoreRow.fantasy_points ?? 0))}`,
            detail: "Single-slate team score",
          }
        : null,

      lowestScoreRow
        ? {
            label: "Season Low Score",
            value: `${
              safeTeams.find((team) => team.id === lowestScoreRow.team_id)
                ?.name ?? "Unknown"
            } • ${roundTo(Number(lowestScoreRow.fantasy_points ?? 0))}`,
            detail: "Lowest non-zero single-slate team score",
          }
        : null,

      allTimeAverageScores
        ? {
            label: "Best Average Score (The Season)",
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
            first_game_start_time: latestSlate.first_game_start_time,
          }
        : null,
      nextSlate: nextSlate
        ? {
            id: nextSlate.id,
            date: nextSlate.date,
            start_date: nextSlate.start_date,
            end_date: nextSlate.end_date,
            label: formatSlateLabel(nextSlate.start_date, nextSlate.end_date),
            is_locked: nextSlate.is_locked,
            first_game_start_time: nextSlate.first_game_start_time,
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
