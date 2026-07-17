import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PlayerRow = {
  id: number;
  name: string;
  position_group: string | null;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
  projected_fantasy_points: number | null;
  projection_confidence: string | null;
  projection_source: string | null;
  projected_at: string | null;
};

type LineupRow = {
  id: number;
  slate_id: number;
  team_id: number;
};

type TeamRow = {
  id: number;
  name: string;
};

type SlateRow = {
  id: number;
  date: string | null;
  start_date: string | null;
  end_date: string | null;
};

type TeamResultRow = {
  slate_id: number;
  team_id: number;
  finish_position: number | null;
};

type PlayerStatRow = {
  slate_id: number;
  player_id: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fantasy_points: number | null;
};

type DraftedRow = {
  lineup: LineupRow;
  lineupPlayer: LineupPlayerRow;
};

type RecentHistoryRow = {
  slateId: number;
  slateLabel: string;
  slateStartDate: string;
  season: number | null;
  teamName: string;
  finishPosition: number | null;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fantasyPoints: number | null;
  projectedFantasyPoints: number | null;
  projectionDifference: number | null;
  projectionConfidence: string | null;
  projectionSource: string | null;
  projectedAt: string | null;
};

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown) {
  return numberOrNull(value) ?? 0;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const playerId = Number(searchParams.get("playerId"));
    const seasonParam = searchParams.get("season") ?? "all";
    const isAllTime = seasonParam === "all";

    if (!Number.isFinite(playerId) || playerId <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid playerId." },
        { status: 400 },
      );
    }

    const selectedSeason = isAllTime ? null : Number(seasonParam);

    if (
      !isAllTime &&
      (!Number.isFinite(selectedSeason) || selectedSeason === null)
    ) {
      return NextResponse.json({ error: "Invalid season." }, { status: 400 });
    }

    /*
     * The generated Supabase Database type has not yet been refreshed with
     * the new projection snapshot columns. Using a local untyped client here
     * prevents those stale generated types from turning valid select fields
     * into GenericStringError.
     */
    const db = supabaseAdmin as any;

    const [
      playerResponse,
      lineupPlayersResponse,
      lineupsResponse,
      teamsResponse,
      slatesResponse,
      resultsResponse,
      statsResponse,
    ] = await Promise.all([
      db
        .from("players")
        .select("id, name, position_group")
        .eq("id", playerId)
        .maybeSingle(),

      db
        .from("lineup_players")
        .select(
          "lineup_id, player_id, projected_fantasy_points, projection_confidence, projection_source, projected_at",
        )
        .eq("player_id", playerId),

      db.from("lineups").select("id, slate_id, team_id"),

      db.from("teams").select("id, name"),

      db.from("slates").select("id, date, start_date, end_date"),

      db
        .from("team_slate_results")
        .select("slate_id, team_id, finish_position"),

      db
        .from("player_slate_stats")
        .select(
          "slate_id, player_id, points, rebounds, assists, steals, blocks, turnovers, fantasy_points",
        )
        .eq("player_id", playerId),
    ]);

    const queryError =
      playerResponse.error ??
      lineupPlayersResponse.error ??
      lineupsResponse.error ??
      teamsResponse.error ??
      slatesResponse.error ??
      resultsResponse.error ??
      statsResponse.error;

    if (queryError) {
      console.error("Failed to load player league profile:", queryError);

      return NextResponse.json(
        {
          error: queryError.message ?? "Failed to load player league profile.",
        },
        { status: 500 },
      );
    }

    const player = (playerResponse.data as PlayerRow | null) ?? null;

    const lineupPlayers = (lineupPlayersResponse.data ??
      []) as LineupPlayerRow[];

    const lineups = (lineupsResponse.data ?? []) as LineupRow[];

    const teams = (teamsResponse.data ?? []) as TeamRow[];

    const slates = (slatesResponse.data ?? []) as SlateRow[];

    const results = (resultsResponse.data ?? []) as TeamResultRow[];

    const stats = (statsResponse.data ?? []) as PlayerStatRow[];

    const lineupById = new Map<number, LineupRow>(
      lineups.map((lineup) => [lineup.id, lineup]),
    );

    const teamById = new Map<number, TeamRow>(
      teams.map((team) => [team.id, team]),
    );

    const slateById = new Map<number, SlateRow>(
      slates.map((slate) => [slate.id, slate]),
    );

    const resultBySlateAndTeam = new Map<string, TeamResultRow>(
      results.map((result) => [`${result.slate_id}:${result.team_id}`, result]),
    );

    const statBySlateId = new Map<number, PlayerStatRow>(
      stats.map((stat) => [stat.slate_id, stat]),
    );

    const draftedRows: DraftedRow[] = lineupPlayers
      .map((lineupPlayer): DraftedRow | null => {
        const lineup = lineupById.get(lineupPlayer.lineup_id);

        if (!lineup) {
          return null;
        }

        return {
          lineup,
          lineupPlayer,
        };
      })
      .filter((row): row is DraftedRow => row !== null);

    const allHistory: RecentHistoryRow[] = draftedRows.map(
      ({ lineup, lineupPlayer }) => {
        const team = teamById.get(lineup.team_id);
        const slate = slateById.get(lineup.slate_id);

        const result = resultBySlateAndTeam.get(
          `${lineup.slate_id}:${lineup.team_id}`,
        );

        const stat = statBySlateId.get(lineup.slate_id);

        const startDate = slate?.start_date ?? slate?.date ?? "";

        const endDate = slate?.end_date ?? slate?.date ?? "";

        const slateLabel =
          startDate && endDate && startDate !== endDate
            ? `${startDate} - ${endDate}`
            : startDate || "Unknown slate";

        const season = startDate ? Number(startDate.slice(0, 4)) : null;

        const fantasyPoints = numberOrNull(stat?.fantasy_points);

        const projectedFantasyPoints = numberOrNull(
          lineupPlayer.projected_fantasy_points,
        );

        const projectionDifference =
          fantasyPoints !== null && projectedFantasyPoints !== null
            ? round(fantasyPoints - projectedFantasyPoints)
            : null;

        return {
          slateId: lineup.slate_id,
          slateLabel,
          slateStartDate: startDate,
          season: season !== null && Number.isFinite(season) ? season : null,
          teamName: team?.name ?? "Unknown",
          finishPosition: numberOrNull(result?.finish_position),
          points: numberOrZero(stat?.points),
          rebounds: numberOrZero(stat?.rebounds),
          assists: numberOrZero(stat?.assists),
          steals: numberOrZero(stat?.steals),
          blocks: numberOrZero(stat?.blocks),
          turnovers: numberOrZero(stat?.turnovers),
          fantasyPoints,
          projectedFantasyPoints,
          projectionDifference,
          projectionConfidence: lineupPlayer.projection_confidence ?? null,
          projectionSource: lineupPlayer.projection_source ?? null,
          projectedAt: lineupPlayer.projected_at ?? null,
        };
      },
    );

    const filteredHistory = allHistory.filter((row) => {
      if (isAllTime) {
        return true;
      }

      return row.season === selectedSeason;
    });

    const completedScores = filteredHistory
      .map((row) => row.fantasyPoints)
      .filter((score): score is number => score !== null);

    const finishes = filteredHistory
      .map((row) => row.finishPosition)
      .filter((finish): finish is number => finish !== null);

    const projectionRows = filteredHistory.filter(
      (
        row,
      ): row is RecentHistoryRow & {
        fantasyPoints: number;
        projectedFantasyPoints: number;
        projectionDifference: number;
      } =>
        row.fantasyPoints !== null &&
        row.projectedFantasyPoints !== null &&
        row.projectionDifference !== null,
    );

    const draftedByCount = new Map<string, number>();

    for (const row of filteredHistory) {
      draftedByCount.set(
        row.teamName,
        (draftedByCount.get(row.teamName) ?? 0) + 1,
      );
    }

    const draftedByBreakdown = Array.from(draftedByCount.entries())
      .map(([teamName, count]) => ({
        teamName,
        count,
      }))
      .sort(
        (a, b) => b.count - a.count || a.teamName.localeCompare(b.teamName),
      );

    const wins = filteredHistory.filter(
      (row) => row.finishPosition === 1,
    ).length;

    const runnerUps = filteredHistory.filter(
      (row) => row.finishPosition === 2,
    ).length;

    const averageFantasyPoints =
      completedScores.length > 0
        ? round(
            completedScores.reduce((sum, score) => sum + score, 0) /
              completedScores.length,
          )
        : null;

    const averageFinish =
      finishes.length > 0
        ? round(
            finishes.reduce((sum, finish) => sum + finish, 0) / finishes.length,
          )
        : null;

    const averageProjectionDifference =
      projectionRows.length > 0
        ? round(
            projectionRows.reduce(
              (sum, row) => sum + row.projectionDifference,
              0,
            ) / projectionRows.length,
          )
        : null;

    const exceededProjectionCount = projectionRows.filter(
      (row) => row.projectionDifference > 0,
    ).length;

    const missedProjectionCount = projectionRows.filter(
      (row) => row.projectionDifference < 0,
    ).length;

    const matchedProjectionCount = projectionRows.filter(
      (row) => row.projectionDifference === 0,
    ).length;

    const recentHistory = [...filteredHistory]
      .sort((a, b) => b.slateStartDate.localeCompare(a.slateStartDate))
      .slice(0, 8)
      .map(({ slateStartDate: _slateStartDate, ...row }) => row);

    return NextResponse.json({
      success: true,

      selectedSeason: isAllTime ? "all" : selectedSeason,

      player: {
        id: player?.id ?? playerId,
        name: player?.name ?? "Unknown Player",
        position_group: player?.position_group ?? null,
      },

      summary: {
        timesDrafted: filteredHistory.length,
        wins,
        runnerUps,

        winRate:
          filteredHistory.length > 0
            ? round((wins / filteredHistory.length) * 100)
            : null,

        draftedMostBy: draftedByBreakdown[0] ?? null,

        draftedByBreakdown,

        averageFantasyPoints,

        bestFantasyPoints:
          completedScores.length > 0
            ? round(Math.max(...completedScores))
            : null,

        worstFantasyPoints:
          completedScores.length > 0
            ? round(Math.min(...completedScores))
            : null,

        averageFinish,

        projectionSampleSize: projectionRows.length,
        averageProjectionDifference,
        exceededProjectionCount,
        missedProjectionCount,
        matchedProjectionCount,
      },

      recentHistory,
    });
  } catch (error) {
    console.error("Unexpected player profile error:", error);

    return NextResponse.json(
      {
        error: "Unexpected server error while loading player profile.",
      },
      { status: 500 },
    );
  }
}
