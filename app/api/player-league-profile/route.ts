import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getStatColumns } from "@/lib/statColumns";

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
  fantasy_points: number | null;
  [key: string]: unknown;
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
  stats: Record<string, number>;
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
    const sportParam = searchParams.get("sport");
    const sport =
      sportParam === "nfl"
        ? "nfl"
        : sportParam === "golf"
          ? "golf"
          : "nba";

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

    if (sport === "golf") {
      const db = supabaseAdmin as any;

      const { data: golfer, error: golferError } = await db
        .from("golf_players")
        .select(
          "id, display_name, country, owgr_rank, owgr_updated_at",
        )
        .eq("id", playerId)
        .maybeSingle();

      if (golferError) {
        return NextResponse.json(
          { error: golferError.message },
          { status: 500 },
        );
      }

      if (!golfer) {
        return NextResponse.json(
          { error: "Golfer not found." },
          { status: 404 },
        );
      }

      const { data: golfSlates, error: golfSlatesError } = await db
        .from("slates")
        .select("id, start_date, date")
        .eq("sport", "golf");

      if (golfSlatesError) {
        return NextResponse.json(
          { error: golfSlatesError.message },
          { status: 500 },
        );
      }

      const filteredGolfSlateIds = (golfSlates ?? [])
        .filter((slate: any) => {
          if (isAllTime) return true;

          const date = slate.start_date ?? slate.date ?? "";
          return Number(String(date).slice(0, 4)) === selectedSeason;
        })
        .map((slate: any) => Number(slate.id));

      let matchingLineups: any[] = [];

      if (filteredGolfSlateIds.length > 0) {
        const { data: lineups, error: lineupsError } = await db
          .from("lineups")
          .select("id, team_id, slate_id")
          .in("slate_id", filteredGolfSlateIds);

        if (lineupsError) {
          return NextResponse.json(
            { error: lineupsError.message },
            { status: 500 },
          );
        }

        matchingLineups = lineups ?? [];
      }

      const lineupIds = matchingLineups.map((lineup: any) =>
        Number(lineup.id),
      );

      let golferLineupPlayers: any[] = [];

      if (lineupIds.length > 0) {
        const { data: lineupPlayers, error: lineupPlayersError } = await db
          .from("lineup_players")
          .select("lineup_id, player_id")
          .eq("player_id", playerId)
          .in("lineup_id", lineupIds);

        if (lineupPlayersError) {
          return NextResponse.json(
            { error: lineupPlayersError.message },
            { status: 500 },
          );
        }

        golferLineupPlayers = lineupPlayers ?? [];
      }

      const ownedLineupIds = new Set(
        golferLineupPlayers.map((row: any) => Number(row.lineup_id)),
      );

      const ownedLineups = matchingLineups.filter((lineup: any) =>
        ownedLineupIds.has(Number(lineup.id)),
      );

      const teamIds = [
        ...new Set(
          ownedLineups.map((lineup: any) => Number(lineup.team_id)),
        ),
      ];

      let teamRows: any[] = [];

      if (teamIds.length > 0) {
        const { data: teams, error: teamsError } = await db
          .from("teams")
          .select("id, name")
          .in("id", teamIds);

        if (teamsError) {
          return NextResponse.json(
            { error: teamsError.message },
            { status: 500 },
          );
        }

        teamRows = teams ?? [];
      }

      const teamNameById = new Map(
        teamRows.map((team: any) => [
          Number(team.id),
          String(team.name),
        ]),
      );

      const draftedByCount = new Map<string, number>();

      ownedLineups.forEach((lineup: any) => {
        const teamName =
          teamNameById.get(Number(lineup.team_id)) ?? "Unknown";

        draftedByCount.set(
          teamName,
          (draftedByCount.get(teamName) ?? 0) + 1,
        );
      });

      const draftedByBreakdown = Array.from(
        draftedByCount.entries(),
      )
        .map(([teamName, count]) => ({ teamName, count }))
        .sort(
          (a, b) =>
            b.count - a.count ||
            a.teamName.localeCompare(b.teamName),
        );

      return NextResponse.json({
        success: true,
        selectedSeason: isAllTime ? "all" : selectedSeason,
        player: {
          id: Number(golfer.id),
          name: golfer.display_name,
          position_group: "GOLFER",
          country: golfer.country ?? null,
          owgrRank: golfer.owgr_rank ?? null,
          owgrUpdatedAt: golfer.owgr_updated_at ?? null,
        },
        summary: {
          timesDrafted: ownedLineups.length,
          wins: 0,
          runnerUps: 0,
          winRate: null,
          draftedMostBy: draftedByBreakdown[0] ?? null,
          draftedByBreakdown,
          averageFantasyPoints: null,
          bestFantasyPoints: null,
          worstFantasyPoints: null,
          averageFinish: null,
          projectionSampleSize: 0,
          averageProjectionDifference: null,
          exceededProjectionCount: 0,
          missedProjectionCount: 0,
          matchedProjectionCount: 0,
        },
        recentHistory: [],
      });
    }

    const playersTable = sport === "nfl" ? "players_nfl" : "players";
    const playersSelect =
      sport === "nfl" ? "id, name, position_group:position" : "id, name, position_group";
    const statsTable = sport === "nfl" ? "player_nfl_slate_stats" : "player_slate_stats";
    const statColumns = getStatColumns(sport);
    const statsSelect = `slate_id, player_id, fantasy_points, ${statColumns
      .map((column) => column.key)
      .join(", ")}`;

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
        .from(playersTable)
        .select(playersSelect)
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

      db.from("slates").select("id, date, start_date, end_date").eq("sport", sport),

      db
        .from("team_slate_results")
        .select("slate_id, team_id, finish_position"),

      db
        .from(statsTable)
        .select(statsSelect)
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

    const allHistory: RecentHistoryRow[] = draftedRows
      .filter(({ lineup }) => slateById.has(lineup.slate_id))
      .map(({ lineup, lineupPlayer }) => {
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

        const statsObj: Record<string, number> = {};
        statColumns.forEach((column) => {
          statsObj[column.key] = numberOrZero(stat?.[column.key]);
        });

        return {
          slateId: lineup.slate_id,
          slateLabel,
          slateStartDate: startDate,
          season: season !== null && Number.isFinite(season) ? season : null,
          teamName: team?.name ?? "Unknown",
          finishPosition: numberOrNull(result?.finish_position),
          stats: statsObj,
          fantasyPoints,
          projectedFantasyPoints,
          projectionDifference,
          projectionConfidence: lineupPlayer.projection_confidence ?? null,
          projectionSource: lineupPlayer.projection_source ?? null,
          projectedAt: lineupPlayer.projected_at ?? null,
        };
      });

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
