import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type LineupRow = {
  id: number;
  team_id: number;
  slate_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
};

type StatRow = {
  player_id: number;
  slate_id: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const season = req.nextUrl.searchParams.get("season");

    if (!season) {
      return NextResponse.json({ error: "season is required" }, { status: 400 });
    }

    const isAllTime = season === "all";

    let slateQuery = supabaseAdmin
      .from("slates")
      .select("id, start_date");

    if (!isAllTime) {
      slateQuery = slateQuery
        .gte("start_date", `${season}-01-01`)
        .lte("start_date", `${season}-12-31`);
    }

    const { data: slates, error: slateError } = await slateQuery;

    if (slateError) throw new Error(slateError.message);

    const slateIds = (slates ?? []).map((slate) => Number(slate.id));

    if (slateIds.length === 0) {
      return NextResponse.json({ success: true, teams: [] });
    }

    const { data: lineups, error: lineupError } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, slate_id")
      .in("slate_id", slateIds);

    if (lineupError) throw new Error(lineupError.message);

    const safeLineups = (lineups ?? []) as LineupRow[];
    const lineupIds = safeLineups.map((lineup) => Number(lineup.id));

    if (lineupIds.length === 0) {
      return NextResponse.json({ success: true, teams: [] });
    }

    const { data: lineupPlayers, error: lpError } = await supabaseAdmin
      .from("lineup_players")
      .select("lineup_id, player_id")
      .in("lineup_id", lineupIds);

    if (lpError) throw new Error(lpError.message);

    const safeLineupPlayers = (lineupPlayers ?? []) as LineupPlayerRow[];
    const playerIds = Array.from(
      new Set(safeLineupPlayers.map((lp) => Number(lp.player_id)))
    );

    if (playerIds.length === 0) {
      return NextResponse.json({ success: true, teams: [] });
    }

    const { data: stats, error: statsError } = await supabaseAdmin
      .from("player_slate_stats")
      .select("player_id, slate_id, points, rebounds, assists, steals, blocks, turnovers")
      .in("slate_id", slateIds)
      .in("player_id", playerIds);

    if (statsError) throw new Error(statsError.message);

    const safeStats = (stats ?? []) as StatRow[];

    const lineupMap = new Map<number, LineupRow>();
    safeLineups.forEach((lineup) => lineupMap.set(Number(lineup.id), lineup));

    const statsMap = new Map<string, StatRow>();
    safeStats.forEach((stat) => {
      statsMap.set(`${Number(stat.player_id)}-${Number(stat.slate_id)}`, stat);
    });

    const teamTotals = new Map<
      number,
      {
        slateIds: Set<number>;
        points: number;
        rebounds: number;
        assists: number;
        steals: number;
        blocks: number;
        turnovers: number;
      }
    >();

    safeLineupPlayers.forEach((lp) => {
      const lineup = lineupMap.get(Number(lp.lineup_id));
      if (!lineup) return;

      const stat = statsMap.get(`${Number(lp.player_id)}-${Number(lineup.slate_id)}`);
      if (!stat) return;

      const teamId = Number(lineup.team_id);

      const existing =
        teamTotals.get(teamId) ??
        {
          slateIds: new Set<number>(),
          points: 0,
          rebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
        };

      existing.slateIds.add(Number(lineup.slate_id));
      existing.points += Number(stat.points ?? 0);
      existing.rebounds += Number(stat.rebounds ?? 0);
      existing.assists += Number(stat.assists ?? 0);
      existing.steals += Number(stat.steals ?? 0);
      existing.blocks += Number(stat.blocks ?? 0);
      existing.turnovers += Number(stat.turnovers ?? 0);

      teamTotals.set(teamId, existing);
    });

    const teams = Array.from(teamTotals.entries()).map(([teamId, totals]) => {
      const slateCount = totals.slateIds.size || 1;

      return {
        teamId,
        slateCount,
        pointsPerSlate: Number((totals.points / slateCount).toFixed(1)),
        reboundsPerSlate: Number((totals.rebounds / slateCount).toFixed(1)),
        assistsPerSlate: Number((totals.assists / slateCount).toFixed(1)),
        stealsPerSlate: Number((totals.steals / slateCount).toFixed(1)),
        blocksPerSlate: Number((totals.blocks / slateCount).toFixed(1)),
        turnoversPerSlate: Number((totals.turnovers / slateCount).toFixed(1)),
      };
    });

    return NextResponse.json({ success: true, season, teams });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load team stats." },
      { status: 500 }
    );
  }
}
