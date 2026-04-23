import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RefreshBody = {
  slateId?: number;
};

type SlateRecord = {
  id: number;
  date: string;
  start_date: string;
  end_date: string;
  is_locked: boolean;
};

type PlayerRecord = {
  id: number;
  name: string;
  position_group: "G" | "F/C";
  is_active: boolean;
  nba_player_id?: number | null;
  team_abbreviation?: string | null;
};

type LineupWithPlayers = {
  id: number;
  team_id: number;
  lineup_players: { player_id: number }[] | null;
};

type NbaScoreboardGame = {
  gameId?: string;
  gameCode?: string;
  gameStatus?: number;
  gameStatusText?: string;
  homeTeam?: {
    teamId?: number;
    teamName?: string;
    teamTricode?: string;
    score?: number | string;
  };
  awayTeam?: {
    teamId?: number;
    teamName?: string;
    teamTricode?: string;
    score?: number | string;
  };
};

type NbaScoreboardPayload = {
  scoreboard?: {
    games?: NbaScoreboardGame[];
  };
};

type NbaBoxScorePlayer = {
  personId?: number;
  firstName?: string;
  familyName?: string;
  name?: string;
  statistics?: {
    points?: number | string;
    reboundsTotal?: number | string;
    assists?: number | string;
    steals?: number | string;
    blocks?: number | string;
    turnovers?: number | string;
  };
};

type NbaBoxScorePayload = {
  game?: {
    gameId?: string;
    gameStatus?: number;
    gameStatusText?: string;
    homeTeam?: {
      players?: NbaBoxScorePlayer[];
    };
    awayTeam?: {
      players?: NbaBoxScorePlayer[];
    };
  };
};

type AggregatedPlayerStat = {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fantasy_points: number;
  games_completed: number;
  games_in_progress: number;
  games_remaining: number;
  game_status_text: string | null;
  source_game_ids: string[];
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function calculateFantasyPoints(stats: {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
}) {
  return (
    stats.points * 1 +
    stats.rebounds * 1.2 +
    stats.assists * 1.5 +
    stats.steals * 2 +
    stats.blocks * 2 -
    stats.turnovers * 1
  );
}

function getGameBuckets(gameStatus: number | undefined) {
  if (gameStatus === 3) {
    return {
      games_completed: 1,
      games_in_progress: 0,
      games_remaining: 0,
    };
  }

  if (gameStatus === 2) {
    return {
      games_completed: 0,
      games_in_progress: 1,
      games_remaining: 0,
    };
  }

  return {
    games_completed: 0,
    games_in_progress: 0,
    games_remaining: 1,
  };
}

function formatDateToGameCode(dateString: string) {
  return dateString.replace(/-/g, "");
}

function buildDateCodeRange(startDate: string, endDate: string) {
  const result: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    result.push(formatDateToGameCode(`${year}-${month}-${day}`));
    current.setDate(current.getDate() + 1);
  }

  return result;
}

async function fetchScoreboardForDate(dateCode: string) {
  const url =
    "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as NbaScoreboardPayload;
  const games = payload.scoreboard?.games ?? [];

  return games.filter((game) => {
    const gameCode = game.gameCode ?? "";
    return gameCode.includes(dateCode);
  });
}
async function fetchBoxScore(gameId: string) {
  const url = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as NbaBoxScorePayload;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshBody;
    const slateId = body.slateId;

    if (!slateId) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400 }
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, is_locked")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    const safeSlate = slate as SlateRecord;

    if (safeSlate.is_locked) {
      return NextResponse.json(
        { error: "This slate is locked. Historical stats cannot be refreshed." },
        { status: 400 }
      );
    }

    const { data: lineupsData, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select(
        `
        id,
        team_id,
        lineup_players (
          player_id
        )
      `
      )
      .eq("slate_id", slateId);

    if (lineupsError || !lineupsData) {
      return NextResponse.json(
        { error: "Failed to load lineups for this slate." },
        { status: 500 }
      );
    }

    const safeLineups = lineupsData as LineupWithPlayers[];

    const lineupPlayerIds = [
      ...new Set(
        safeLineups.flatMap((lineup) =>
          (lineup.lineup_players ?? []).map((lp) => lp.player_id)
        )
      ),
    ];

    if (lineupPlayerIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No lineup players found for this slate yet.",
        slateId,
        slateStartDate: safeSlate.start_date,
        slateEndDate: safeSlate.end_date,
        playerStatsUpserted: 0,
        teamResultsUpserted: 0,
        gamesFound: 0,
        autoLocked: false,
      });
    }

    const { data: players, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, name, position_group, is_active, nba_player_id, team_abbreviation")
      .in("id", lineupPlayerIds);

    if (playersError || !players) {
      return NextResponse.json(
        { error: "Failed to load lineup players." },
        { status: 500 }
      );
    }

    const safePlayers = (players as PlayerRecord[]).filter(
      (player) => player.is_active && player.nba_player_id
    );

    if (safePlayers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No valid lineup players with NBA ids found for this slate.",
        slateId,
        slateStartDate: safeSlate.start_date,
        slateEndDate: safeSlate.end_date,
        playerStatsUpserted: 0,
        teamResultsUpserted: 0,
        gamesFound: 0,
        autoLocked: false,
      });
    }

    const localPlayersByNormalizedName = new Map<string, PlayerRecord>();
    const localPlayersByNbaId = new Map<number, PlayerRecord>();

    for (const player of safePlayers) {
      localPlayersByNormalizedName.set(normalizeName(player.name), player);

      if (player.nba_player_id) {
        localPlayersByNbaId.set(Number(player.nba_player_id), player);
      }
    }

    const dateCodes = buildDateCodeRange(safeSlate.start_date, safeSlate.end_date);

    const gamesForSlateDateRange: NbaScoreboardGame[] = [];
    for (const dateCode of dateCodes) {
      const gamesForDate = await fetchScoreboardForDate(dateCode);
      gamesForSlateDateRange.push(...gamesForDate);
    }

console.log("DATE RANGE", safeSlate.start_date, safeSlate.end_date);
console.log("DATE CODES", dateCodes);
console.log("GAMES FOUND", gamesForSlateDateRange.length);
console.log("DATE RANGE", safeSlate.start_date, safeSlate.end_date);
console.log("DATE CODES", dateCodes);
console.log("GAMES FOUND", gamesForSlateDateRange.length);

if (gamesForSlateDateRange.length === 0) {
  return NextResponse.json({
    success: true,
    message: "No games found for this slate. Skipping update to avoid overwriting data.",
    slateId,
    slateStartDate: safeSlate.start_date,
    slateEndDate: safeSlate.end_date,
    playerStatsUpserted: 0,
    teamResultsUpserted: 0,
    gamesFound: gamesForSlateDateRange.length,
    autoLocked: false,
    skipped: true, // 👈 add this
  });
}
    const aggregatedByPlayerId = new Map<number, AggregatedPlayerStat>();

    for (const game of gamesForSlateDateRange) {
      const gameId = game.gameId;
      if (!gameId) continue;

      const boxScorePayload = await fetchBoxScore(gameId);
      const boxGame = boxScorePayload?.game;
      if (!boxGame) continue;

      const gameStatus = boxGame.gameStatus ?? game.gameStatus;
      const gameStatusText = boxGame.gameStatusText ?? game.gameStatusText ?? null;
      const bucket = getGameBuckets(gameStatus);

      const allPlayers = [
        ...(boxGame.homeTeam?.players ?? []),
        ...(boxGame.awayTeam?.players ?? []),
      ];

      for (const nbaPlayer of allPlayers) {
        let matchedPlayer: PlayerRecord | undefined;

        if (nbaPlayer.personId && localPlayersByNbaId.has(Number(nbaPlayer.personId))) {
          matchedPlayer = localPlayersByNbaId.get(Number(nbaPlayer.personId));
        } else {
          const fullName =
            nbaPlayer.name ||
            `${nbaPlayer.firstName ?? ""} ${nbaPlayer.familyName ?? ""}`.trim();

          matchedPlayer = localPlayersByNormalizedName.get(normalizeName(fullName));
        }

        if (!matchedPlayer) continue;

        const stats = {
          points: toNumber(nbaPlayer.statistics?.points),
          rebounds: toNumber(nbaPlayer.statistics?.reboundsTotal),
          assists: toNumber(nbaPlayer.statistics?.assists),
          steals: toNumber(nbaPlayer.statistics?.steals),
          blocks: toNumber(nbaPlayer.statistics?.blocks),
          turnovers: toNumber(nbaPlayer.statistics?.turnovers),
        };

        const existing = aggregatedByPlayerId.get(matchedPlayer.id) ?? {
          points: 0,
          rebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
          fantasy_points: 0,
          games_completed: 0,
          games_in_progress: 0,
          games_remaining: 0,
          game_status_text: null,
          source_game_ids: [],
        };

        existing.points += stats.points;
        existing.rebounds += stats.rebounds;
        existing.assists += stats.assists;
        existing.steals += stats.steals;
        existing.blocks += stats.blocks;
        existing.turnovers += stats.turnovers;
        existing.fantasy_points = calculateFantasyPoints({
          points: existing.points,
          rebounds: existing.rebounds,
          assists: existing.assists,
          steals: existing.steals,
          blocks: existing.blocks,
          turnovers: existing.turnovers,
        });

        existing.games_completed += bucket.games_completed;
        existing.games_in_progress += bucket.games_in_progress;
        existing.games_remaining += bucket.games_remaining;
        existing.game_status_text = gameStatusText;

        if (!existing.source_game_ids.includes(gameId)) {
          existing.source_game_ids.push(gameId);
        }

        aggregatedByPlayerId.set(matchedPlayer.id, existing);
      }
    }

    const playerStatsPayload = lineupPlayerIds.map((playerId) => {
      const stat = aggregatedByPlayerId.get(playerId);

      return {
        slate_id: slateId,
        player_id: playerId,
        points: stat?.points ?? 0,
        rebounds: stat?.rebounds ?? 0,
        assists: stat?.assists ?? 0,
        steals: stat?.steals ?? 0,
        blocks: stat?.blocks ?? 0,
        turnovers: stat?.turnovers ?? 0,
        fantasy_points: stat?.fantasy_points ?? 0,
      };
    });

    let playerStatsUpserted = 0;

    if (playerStatsPayload.length > 0) {
      const { error: playerStatsError } = await supabaseAdmin
        .from("player_slate_stats")
        .upsert(playerStatsPayload, {
          onConflict: "slate_id,player_id",
        });

      if (playerStatsError) {
        return NextResponse.json(
          { error: `Failed to upsert player stats: ${playerStatsError.message}` },
          { status: 500 }
        );
      }

      playerStatsUpserted = playerStatsPayload.length;
    }

    const teamResultsPayload = safeLineups.map((lineup) => {
      const teamPlayerIds = (lineup.lineup_players ?? []).map((lp) => lp.player_id);

      let fantasyPoints = 0;
      let gamesCompleted = 0;
      let gamesInProgress = 0;
      let gamesRemaining = 0;

      for (const playerId of teamPlayerIds) {
        const stat = aggregatedByPlayerId.get(playerId);

        fantasyPoints += stat?.fantasy_points ?? 0;
        gamesCompleted += stat?.games_completed ?? 0;
        gamesInProgress += stat?.games_in_progress ?? 0;
        gamesRemaining += stat?.games_remaining ?? 0;
      }

      return {
        slate_id: slateId,
        team_id: lineup.team_id,
        fantasy_points: Number(fantasyPoints.toFixed(1)),
        games_completed: gamesCompleted,
        games_in_progress: gamesInProgress,
        games_remaining: gamesRemaining,
      };
    });

    const sortedParticipating = [...teamResultsPayload]
      .filter(
        (row) =>
          row.fantasy_points > 0 ||
          row.games_completed > 0 ||
          row.games_in_progress > 0 ||
          row.games_remaining > 0
      )
      .sort((a, b) => b.fantasy_points - a.fantasy_points);

    const finishPositionMap = new Map<number, number>();
    sortedParticipating.forEach((row, index) => {
      finishPositionMap.set(row.team_id, index + 1);
    });

    const finalTeamResultsPayload = teamResultsPayload.map((row) => ({
      ...row,
      finish_position: finishPositionMap.get(row.team_id) ?? null,
    }));

    let teamResultsUpserted = 0;

    if (finalTeamResultsPayload.length > 0) {
      const { error: teamResultsError } = await supabaseAdmin
        .from("team_slate_results")
        .upsert(finalTeamResultsPayload, {
          onConflict: "slate_id,team_id",
        });

      if
 (teamResultsError) {
        return NextResponse.json(
          { error: `Failed to upsert team results: ${teamResultsError.message}` },
          { status: 500 }
        );
      }

      teamResultsUpserted = finalTeamResultsPayload.length;
    }

    const participatingTeamResults = finalTeamResultsPayload.filter(
      (row) =>
        row.games_completed > 0 ||
        row.games_in_progress > 0 ||
        row.games_remaining > 0
    );

    const shouldAutoLock =
      participatingTeamResults.length > 0 &&
      participatingTeamResults.every(
        (row) => row.games_in_progress === 0 && row.games_remaining === 0
      );

    if (shouldAutoLock) {
      const { error: lockError } = await supabaseAdmin
        .from("slates")
        .update({ is_locked: true })
        .eq("id", slateId);

      if (lockError) {
        return NextResponse.json(
          { error: `Failed to auto-lock slate: ${lockError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: shouldAutoLock
        ? "Slate stats refreshed successfully and slate auto-locked."
        : "Slate stats refreshed successfully.",
      slateId,
      slateStartDate: safeSlate.start_date,
      slateEndDate: safeSlate.end_date,
      playerStatsUpserted,
      teamResultsUpserted,
      gamesFound: gamesForSlateDateRange.length,
      autoLocked: shouldAutoLock,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while refreshing slate stats." },
      { status: 500 }
    );
  }
}
