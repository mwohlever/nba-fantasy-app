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

    const { data: players, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, name, position_group, is_active, nba_player_id, team_abbreviation")
      .eq("is_active", true);

    if (playersError || !players) {
      return NextResponse.json(
        { error: "Failed to load players." },
        { status: 500 }
      );
    }

    const safePlayers = players as PlayerRecord[];
    const playersById = new Map(safePlayers.map((player) => [player.id, player]));

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
      });
    }

    const localPlayersByNormalizedName = new Map<string, PlayerRecord>();
    const localPlayersByNbaId = new Map<number, PlayerRecord>();

    for (const playerId of lineupPlayerIds) {
      const player = playersById.get(playerId);
      if (!player) continue;

      localPlayersByNormalizedName.set(normalizeName(player.name), player);

      if (player.nba_player_id) {
        localPlayersByNbaId.set(player.nba_player_id, player);
      }
    }

    const dateCodes = buildDateCodeRange(safeSlate.start_date, safeSlate.end_date);

    const scoreboardUrl =
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";

    const scoreboardResponse = await fetch(scoreboardUrl, {
      method: "GET",
      cache: "no-store",
    });

    if (!scoreboardResponse.ok) {
      const text = await scoreboardResponse.text();
      return NextResponse.json(
        {
          error: `NBA scoreboard request failed with status ${scoreboardResponse.status}.`,
          details: text,
        },
        { status: 502 }
      );
    }

    const scoreboardPayload = (await scoreboardResponse.json()) as NbaScoreboardPayload;
    const allGames = scoreboardPayload.scoreboard?.games ?? [];

    const gamesForSlateDateRange = allGames.filter((game) => {
      const code = game.gameCode ?? "";
      return dateCodes.some((dateCode) => code.includes(dateCode));
    });

    if (gamesForSlateDateRange.length === 0) {
      const playerStatRows = lineupPlayerIds.map((playerId) => ({
        slate_id: slateId,
        player_id: playerId,
        points: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fantasy_points: 0,
        games_completed: 0,
        games_in_progress: 0,
        games_remaining: 1,
        game_status_text: "No NBA.com match yet",
        source_game_id: null,
        source_updated_at: new Date().toISOString(),
      }));

      const { error: playerStatsUpsertError } = await supabaseAdmin
        .from("player_slate_stats")
        .upsert(playerStatRows, {
          onConflict: "slate_id,player_id",
        });

      if (playerStatsUpsertError) {
        return NextResponse.json(
          {
            error: `Failed to upsert player_slate_stats: ${playerStatsUpsertError.message}`,
          },
          { status: 500 }
        );
      }

      const teamResultRows = safeLineups.map((lineup) => {
        const lineupPlayerIdsForTeam = (lineup.lineup_players ?? []).map(
          (lp) => lp.player_id
        );

        const rowsForTeam = playerStatRows.filter((row) =>
          lineupPlayerIdsForTeam.includes(row.player_id)
        );

        return {
          slate_id: slateId,
          team_id: lineup.team_id,
          fantasy_points: 0,
          finish_position: null as number | null,
          games_completed: 0,
          games_in_progress: 0,
          games_remaining: rowsForTeam.length,
          last_refresh_at: new Date().toISOString(),
        };
      });

      const sortedForFinish = [...teamResultRows].sort(
        (a, b) => b.fantasy_points - a.fantasy_points
      );

      const finishByTeamId = new Map<number, number>();
      sortedForFinish.forEach((row, index) => {
        finishByTeamId.set(row.team_id, index + 1);
      });

      const finalizedTeamRows = teamResultRows.map((row) => ({
        ...row,
        finish_position: finishByTeamId.get(row.team_id) ?? null,
      }));

      const { error: teamResultsUpsertError } = await supabaseAdmin
        .from("team_slate_results")
        .upsert(finalizedTeamRows, {
          onConflict: "slate_id,team_id",
        });

      if (teamResultsUpsertError) {
        return NextResponse.json(
          {
            error: `Failed to upsert team_slate_results: ${teamResultsUpsertError.message}`,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "No NBA games found for that slate range on the scoreboard feed.",
        slateId,
        slateStartDate: safeSlate.start_date,
        slateEndDate: safeSlate.end_date,
        gamesFound: 0,
        playerStatsUpserted: playerStatRows.length,
        teamResultsUpserted: finalizedTeamRows.length,
      });
    }

    const playerStatsByLocalPlayerId = new Map<number, AggregatedPlayerStat>();

    for (const game of gamesForSlateDateRange) {
      if (!game.gameId) continue;

      const boxScoreUrl = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${game.gameId}.json`;

      const boxScoreResponse = await fetch(boxScoreUrl, {
        method: "GET",
        cache: "no-store",
      });

      if (!boxScoreResponse.ok) {
        continue;
      }

      const boxScorePayload = (await boxScoreResponse.json()) as NbaBoxScorePayload;
      const boxGame = boxScorePayload.game;

      const allBoxPlayers: NbaBoxScorePlayer[] = [
        ...(boxGame?.homeTeam?.players ?? []),
        ...(boxGame?.awayTeam?.players ?? []),
      ];

      for (const gamePlayer of allBoxPlayers) {
        const localPlayer =
          (gamePlayer.personId
            ? localPlayersByNbaId.get(gamePlayer.personId)
            : undefined) ??
          (() => {
            const rawName =
              gamePlayer.name ||
              `${gamePlayer.firstName ?? ""} ${gamePlayer.familyName ?? ""}`.trim();
            const normalized = normalizeName(rawName);
            return localPlayersByNormalizedName.get(normalized);
          })();

        if (!localPlayer) continue;

        const points = toNumber(gamePlayer.statistics?.points);
        const rebounds = toNumber(gamePlayer.statistics?.reboundsTotal);
        const assists = toNumber(gamePlayer.statistics?.assists);
        const steals = toNumber(gamePlayer.statistics?.steals);
        const blocks = toNumber(gamePlayer.statistics?.blocks);
        const turnovers = toNumber(gamePlayer.statistics?.turnovers);

        const buckets = getGameBuckets(boxGame?.gameStatus);
        const existing = playerStatsByLocalPlayerId.get(localPlayer.id);

        const nextPoints = (existing?.points ?? 0) + points;
        const nextRebounds = (existing?.rebounds ?? 0) + rebounds;
        const nextAssists = (existing?.assists ?? 0) + assists;
        const nextSteals = (existing?.steals ?? 0) + steals;
        const nextBlocks = (existing?.blocks ?? 0) + blocks;
        const nextTurnovers = (existing?.turnovers ?? 0) + turnovers;

        playerStatsByLocalPlayerId.set(localPlayer.id, {
          points: nextPoints,
          rebounds: nextRebounds,
          assists: nextAssists,
          steals: nextSteals,
          blocks: nextBlocks,
          turnovers: nextTurnovers,
          fantasy_points: calculateFantasyPoints({
            points: nextPoints,
            rebounds: nextRebounds,
            assists: nextAssists,
            steals: nextSteals,
            blocks: nextBlocks,
            turnovers: nextTurnovers,
          }),
          games_completed: (existing?.games_completed ?? 0) + buckets.games_completed,
          games_in_progress: (existing?.games_in_progress ?? 0) + buckets.games_in_progress,
          games_remaining: (existing?.games_remaining ?? 0) + buckets.games_remaining,
          game_status_text: boxGame?.gameStatusText ?? existing?.game_status_text ?? null,
          source_game_ids: [
            ...(existing?.source_game_ids ?? []),
            ...(boxGame?.gameId ? [boxGame.gameId] : []),
          ],
        });
      }
    }

    const playerStatRows = lineupPlayerIds.map((playerId) => {
      const matched = playerStatsByLocalPlayerId.get(playerId);

      if (matched) {
        return {
          slate_id: slateId,
          player_id: playerId,
          points: matched.points,
          rebounds: matched.rebounds,
          assists: matched.assists,
          steals: matched.steals,
          blocks: matched.blocks,
          turnovers: matched.turnovers,
          fantasy_points: matched.fantasy_points,
          games_completed: matched.games_completed,
          games_in_progress: matched.games_in_progress,
          games_remaining: matched.games_remaining,
          game_status_text: matched.game_status_text,
          source_game_id: matched.source_game_ids.length
            ? matched.source_game_ids.join(",")
            : null,
          source_updated_at: new Date().toISOString(),
        };
      }

      return {
        slate_id: slateId,
        player_id: playerId,
        points: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fantasy_points: 0,
        games_completed: 0,
        games_in_progress: 0,
        games_remaining: 1,
        game_status_text: "No NBA.com match yet",
        source_game_id: null,
        source_updated_at: new Date().toISOString(),
      };
    });

    const { error: playerStatsUpsertError } = await supabaseAdmin
      .from("player_slate_stats")
      .upsert(playerStatRows, {
        onConflict: "slate_id,player_id",
      });

    if (playerStatsUpsertError) {
      return NextResponse.json(
        {
          error: `Failed to upsert player_slate_stats: ${playerStatsUpsertError.message}`,
        },
        { status: 500 }
      );
    }

    const teamResultRows = safeLineups.map((lineup) => {
      const lineupPlayerIdsForTeam = (lineup.lineup_players ?? []).map(
        (lp) => lp.player_id
      );

      const rowsForTeam = playerStatRows.filter((row) =>
        lineupPlayerIdsForTeam.includes(row.player_id)
      );

      const fantasy_points = rowsForTeam.reduce(
        (sum, row) => sum + toNumber(row.fantasy_points),
        0
      );

      const games_completed = rowsForTeam.reduce(
        (sum, row) => sum + toNumber(row.games_completed),
        0
      );

      const games_in_progress = rowsForTeam.reduce(
        (sum, row) => sum + toNumber(row.games_in_progress),
        0
      );

      const games_remaining = rowsForTeam.reduce(
        (sum, row) => sum + toNumber(row.games_remaining),
        0
      );

      return {
        slate_id: slateId,
        team_id: lineup.team_id,
        fantasy_points,
        finish_position: null as number | null,
        games_completed,
        games_in_progress,
        games_remaining,
        last_refresh_at: new Date().toISOString(),
      };
    });

    const sortedForFinish = [...teamResultRows].sort(
      (a, b) => b.fantasy_points - a.fantasy_points
    );

    const finishByTeamId = new Map<number, number>();
    sortedForFinish.forEach((row, index) => {
      finishByTeamId.set(row.team_id, index + 1);
    });

    const finalizedTeamRows = teamResultRows.map((row) => ({
      ...row,
      finish_position: finishByTeamId.get(row.team_id) ?? null,
    }));

    const { error: teamResultsUpsertError } = await supabaseAdmin
      .from("team_slate_results")
      .upsert(finalizedTeamRows, {
        onConflict: "slate_id,team_id",
      });

    if (teamResultsUpsertError) {
      return NextResponse.json(
        {
          error: `Failed to upsert team_slate_results: ${teamResultsUpsertError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "NBA.com stats refreshed successfully.",
      slateId,
      slateStartDate: safeSlate.start_date,
      slateEndDate: safeSlate.end_date,
      gamesFound: gamesForSlateDateRange.length,
      playerStatsUpserted: playerStatRows.length,
      teamResultsUpserted: finalizedTeamRows.length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while refreshing NBA.com stats." },
      { status: 500 }
    );
  }
}
