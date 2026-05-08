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

type LineupWithPlayers = {
  id: number;
  team_id: number;
  lineup_players: { player_id: number }[] | null;
};

type PlayerRecord = {
  id: number;
  name: string;
  nba_player_id?: number | null;
};

type NbaScoreboardGame = {
  gameId?: string;
  gameCode?: string;
  gameStatus?: number;
  gameStatusText?: string;
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
    period?: number;
    gameClock?: string;
    homeTeam?: { players?: NbaBoxScorePlayer[] };
    awayTeam?: { players?: NbaBoxScorePlayer[] };
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
  game_status: number | null;
  game_status_text: string | null;
  period: number | null;
  game_clock: string | null;
  source_game_ids: string[];
};

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
    stats.points +
    stats.rebounds * 1.2 +
    stats.assists * 1.5 +
    stats.steals * 2 +
    stats.blocks * 2 -
    stats.turnovers
  );
}

function getGameBuckets(gameStatus: number | undefined) {
  if (gameStatus === 3) {
    return { games_completed: 1, games_in_progress: 0, games_remaining: 0 };
  }

  if (gameStatus === 2) {
    return { games_completed: 0, games_in_progress: 1, games_remaining: 0 };
  }

  return { games_completed: 0, games_in_progress: 0, games_remaining: 1 };
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
  const url = "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) return [];

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

  if (!response.ok) return null;

  return (await response.json()) as NbaBoxScorePayload;
}

function blankStat(): AggregatedPlayerStat {
  return {
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
    game_status: null,
    game_status_text: null,
    period: null,
    game_clock: null,
    source_game_ids: [],
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshBody;
    const slateId = body.slateId;

    if (!slateId) {
      return NextResponse.json({ error: "slateId is required." }, { status: 400 });
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, is_locked")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
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
      .select(`
        id,
        team_id,
        lineup_players (
          player_id
        )
      `)
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        { error: `Failed to load lineups: ${lineupsError.message}` },
        { status: 500 }
      );
    }

    const lineups = (lineupsData ?? []) as LineupWithPlayers[];
    const draftedPlayerIds = Array.from(
      new Set(
        lineups.flatMap((lineup) =>
          (lineup.lineup_players ?? []).map((row) => row.player_id)
        )
      )
    );

    if (draftedPlayerIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No drafted players found for this slate.",
      });
    }

    const { data: playersData, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, name, nba_player_id")
      .in("id", draftedPlayerIds);

    if (playersError) {
      return NextResponse.json(
        { error: `Failed to load players: ${playersError.message}` },
        { status: 500 }
      );
    }

    const players = (playersData ?? []) as PlayerRecord[];

    const playerByNbaId = new Map<number, PlayerRecord>();
    for (const player of players) {
      if (player.nba_player_id) {
        playerByNbaId.set(Number(player.nba_player_id), player);
      }
    }

    const aggregatedByPlayerId = new Map<number, AggregatedPlayerStat>();

    // Start every drafted player at zero so old stale rows do not hang around forever.
    for (const player of players) {
      aggregatedByPlayerId.set(player.id, blankStat());
    }

    const dateCodes = buildDateCodeRange(safeSlate.start_date, safeSlate.end_date);
    const allGames: NbaScoreboardGame[] = [];

    const { data: manualGames, error: manualGamesError } = await supabaseAdmin
      .from("slate_nba_games")
      .select("game_id, game_code")
      .eq("slate_id", slateId);

    if (manualGamesError) {
      return NextResponse.json(
        { error: `Failed to load slate NBA games: ${manualGamesError.message}` },
        { status: 500 }
      );
    }

    if ((manualGames ?? []).length > 0) {
      for (const manualGame of manualGames ?? []) {
        allGames.push({
          gameId: String(manualGame.game_id),
          gameCode: manualGame.game_code ?? undefined,
          gameStatus: undefined,
          gameStatusText: undefined,
        });
      }
    } else {
      for (const dateCode of dateCodes) {
        const games = await fetchScoreboardForDate(dateCode);
        allGames.push(...games);
      }
    }

    const uniqueGames = Array.from(
      new Map(
        allGames
          .filter((game) => game.gameId)
          .map((game) => [String(game.gameId), game])
      ).values()
    );

    let allGamesFinal = uniqueGames.length > 0;

    for (const game of uniqueGames) {
      const gameId = String(game.gameId);
      const boxScore = await fetchBoxScore(gameId);

      if (!boxScore?.game) {
        allGamesFinal = false;
        continue;
      }

      const gameStatus = boxScore.game.gameStatus ?? game.gameStatus;

      if (gameStatus !== 3) {
        allGamesFinal = false;
      }
      const gameStatusText =
        boxScore.game.gameStatusText ?? game.gameStatusText ?? null;

      const period =
        typeof boxScore.game.period === "number"
          ? boxScore.game.period
          : null;

      const gameClock =
        typeof boxScore.game.gameClock === "string"
          ? boxScore.game.gameClock
          : null;

      const buckets = getGameBuckets(gameStatus);

      const boxPlayers = [
        ...(boxScore.game.homeTeam?.players ?? []),
        ...(boxScore.game.awayTeam?.players ?? []),
      ];

      for (const boxPlayer of boxPlayers) {
        const personId = boxPlayer.personId;
        if (!personId) continue;

        const player = playerByNbaId.get(Number(personId));
        if (!player) continue;

        const stats = {
          points: toNumber(boxPlayer.statistics?.points),
          rebounds: toNumber(boxPlayer.statistics?.reboundsTotal),
          assists: toNumber(boxPlayer.statistics?.assists),
          steals: toNumber(boxPlayer.statistics?.steals),
          blocks: toNumber(boxPlayer.statistics?.blocks),
          turnovers: toNumber(boxPlayer.statistics?.turnovers),
        };

        const existing = aggregatedByPlayerId.get(player.id) ?? blankStat();

        existing.points += stats.points;
        existing.rebounds += stats.rebounds;
        existing.assists += stats.assists;
        existing.steals += stats.steals;
        existing.blocks += stats.blocks;
        existing.turnovers += stats.turnovers;
        existing.fantasy_points = calculateFantasyPoints(existing);

        existing.games_completed += buckets.games_completed;
        existing.games_in_progress += buckets.games_in_progress;
        existing.games_remaining += buckets.games_remaining;

        existing.game_status = gameStatus ?? null;
        existing.game_status_text = gameStatusText;
        existing.period = period;
        existing.game_clock = gameClock;
        existing.source_game_ids = Array.from(
          new Set([...existing.source_game_ids, gameId])
        );

        aggregatedByPlayerId.set(player.id, existing);
      }
    }

    const playerStatRows = Array.from(aggregatedByPlayerId.entries()).map(
      ([playerId, stat]) => ({
        slate_id: slateId,
        player_id: playerId,
        points: stat.points,
        rebounds: stat.rebounds,
        assists: stat.assists,
        steals: stat.steals,
        blocks: stat.blocks,
        turnovers: stat.turnovers,
        fantasy_points: Math.round(stat.fantasy_points * 10) / 10,
        games_completed: stat.games_completed,
        games_in_progress: stat.games_in_progress,
        games_remaining: stat.games_remaining,
        game_status: stat.game_status,
        game_status_text: stat.game_status_text,
        period: stat.period,
        game_clock: stat.game_clock,
      })
    );

    const { error: statsUpsertError } = await supabaseAdmin
      .from("player_slate_stats")
      .upsert(playerStatRows, {
        onConflict: "slate_id,player_id",
      });

    if (statsUpsertError) {
      return NextResponse.json(
        { error: `Failed to save player stats: ${statsUpsertError.message}` },
        { status: 500 }
      );
    }

    const statsByPlayerId = new Map(
      playerStatRows.map((row) => [row.player_id, row])
    );

    const teamRows = lineups.map((lineup) => {
      const playerRows = lineup.lineup_players ?? [];

      const fantasyPoints = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.fantasy_points ?? 0);
      }, 0);

      const gamesCompleted = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_completed ?? 0);
      }, 0);

      const gamesInProgress = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_in_progress ?? 0);
      }, 0);

      const gamesRemaining = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_remaining ?? 0);
      }, 0);

      return {
        slate_id: slateId,
        team_id: lineup.team_id,
        fantasy_points: Math.round(fantasyPoints * 10) / 10,
        finish_position: null as number | null,
        games_completed: gamesCompleted,
        games_in_progress: gamesInProgress,
        games_remaining: gamesRemaining,
      };
    });

    const sortedTeamRows = [...teamRows].sort(
      (a, b) => Number(b.fantasy_points) - Number(a.fantasy_points)
    );

    sortedTeamRows.forEach((row, index) => {
      row.finish_position = index + 1;
    });

    const { error: teamUpsertError } = await supabaseAdmin
      .from("team_slate_results")
      .upsert(sortedTeamRows, {
        onConflict: "slate_id,team_id",
      });

    if (teamUpsertError) {
      return NextResponse.json(
        { error: `Failed to save team results: ${teamUpsertError.message}` },
        { status: 500 }
      );
    }

    let slateAutoLocked = false;

    if (allGamesFinal) {
      const { error: lockError } = await supabaseAdmin
        .from("slates")
        .update({ is_locked: true })
        .eq("id", slateId);

      if (lockError) {
        return NextResponse.json(
          { error: `Stats saved, but failed to auto-lock slate: ${lockError.message}` },
          { status: 500 }
        );
      }

      slateAutoLocked = true;
    }

    return NextResponse.json({
      success: true,
      slateId,
      dateCodes,
      gamesFound: uniqueGames.length,
      playerStatsUpdated: playerStatRows.length,
      teamResultsUpdated: sortedTeamRows.length,
      slateAutoLocked,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while refreshing stats." },
      { status: 500 }
    );
  }
}
