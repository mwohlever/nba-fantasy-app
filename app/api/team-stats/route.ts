import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getStatColumns } from "@/lib/statColumns";
import { DEFAULT_SPORT } from "@/lib/sports";

type LineupRow = {
  id: number;
  team_id: number;
  slate_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
};

type TeamSlateResultRow = {
  team_id: number;
  slate_id: number;
  fantasy_points: number | null;
};

export async function GET(req: NextRequest) {
  try {
    const season = req.nextUrl.searchParams.get("season");
    const sport = req.nextUrl.searchParams.get("sport") ?? DEFAULT_SPORT;

    if (!season) {
      return NextResponse.json({ error: "season is required" }, { status: 400 });
    }

    const isAllTime = season === "all";
    const statColumns = getStatColumns(sport);

    /*
     * Golf does not use player_slate_stats.
     *
     * Golf team/profile statistics are sourced from:
     *   golf_event_players
     *   golf_rounds
     *   golf_holes
     *
     * Those statistics are already provided by the dedicated Golf
     * standings/profile APIs. Returning an empty shared-stat payload
     * prevents this NBA/NFL compatibility endpoint from querying
     * nonexistent Golf columns.
     */
    if (sport === "golf") {
      return NextResponse.json({
        success: true,
        sport,
        season,
        statColumns: [],
        teams: [],
      });
    }

    const playersTable = sport === "nfl" ? "players_nfl" : "players";
    const statsTable = sport === "nfl" ? "player_nfl_slate_stats" : "player_slate_stats";

    let slateQuery = supabaseAdmin
      .from("slates")
      .select("id, start_date")
      .eq("sport", sport);

    if (!isAllTime) {
      slateQuery = slateQuery
        .gte("start_date", `${season}-01-01`)
        .lte("start_date", `${season}-12-31`);
    }

    const { data: slates, error: slateError } = await slateQuery;

    if (slateError) throw new Error(slateError.message);

    const slateIds = (slates ?? []).map((slate) => Number(slate.id));

    if (slateIds.length === 0) {
      return NextResponse.json({ success: true, sport, teams: [] });
    }

    const { data: lineups, error: lineupError } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, slate_id")
      .in("slate_id", slateIds);

    if (lineupError) throw new Error(lineupError.message);

    const safeLineups = (lineups ?? []) as LineupRow[];
    const lineupIds = safeLineups.map((lineup) => Number(lineup.id));

    if (lineupIds.length === 0) {
      return NextResponse.json({ success: true, sport, teams: [] });
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
      return NextResponse.json({ success: true, sport, teams: [] });
    }

    const statSelectColumns = ["player_id", "slate_id", ...statColumns.map((c) => c.key)].join(", ");

    const { data: stats, error: statsError } = await supabaseAdmin
      .from(statsTable)
      .select(statSelectColumns)
      .in("slate_id", slateIds)
      .in("player_id", playerIds);

    if (statsError) throw new Error(statsError.message);

    const safeStats = (stats ?? []) as any[];

    const { data: teamSlateResults, error: resultsError } = await supabaseAdmin
      .from("team_slate_results")
      .select("team_id, slate_id, fantasy_points")
      .in("slate_id", slateIds);

    if (resultsError) throw new Error(resultsError.message);

    const safeTeamSlateResults = (teamSlateResults ?? []) as TeamSlateResultRow[];

    const officialSlateCountByTeam = new Map<number, Set<number>>();

    safeTeamSlateResults.forEach((row) => {
      if ((row.fantasy_points ?? 0) <= 0) return;

      const teamId = Number(row.team_id);
      const existing = officialSlateCountByTeam.get(teamId) ?? new Set<number>();
      existing.add(Number(row.slate_id));
      officialSlateCountByTeam.set(teamId, existing);
    });

    const lineupMap = new Map<number, LineupRow>();
    safeLineups.forEach((lineup) => lineupMap.set(Number(lineup.id), lineup));

    const statsMap = new Map<string, any>();
    safeStats.forEach((stat) => {
      statsMap.set(`${Number(stat.player_id)}-${Number(stat.slate_id)}`, stat);
    });

    const teamTotals = new Map<number, { slateIds: Set<number>; totals: Record<string, number> }>();

    safeLineupPlayers.forEach((lp) => {
      const lineup = lineupMap.get(Number(lp.lineup_id));
      if (!lineup) return;

      const stat = statsMap.get(`${Number(lp.player_id)}-${Number(lineup.slate_id)}`);
      if (!stat) return;

      const rowValues: Record<string, number> = {};
      let hasRealStat = false;

      statColumns.forEach((column) => {
        const value = Number(stat[column.key] ?? 0);
        rowValues[column.key] = value;
        if (value > 0) hasRealStat = true;
      });

      if (!hasRealStat) return;

      const teamId = Number(lineup.team_id);

      const existing =
        teamTotals.get(teamId) ?? {
          slateIds: new Set<number>(),
          totals: Object.fromEntries(statColumns.map((c) => [c.key, 0])),
        };

      existing.slateIds.add(Number(lineup.slate_id));

      statColumns.forEach((column) => {
        existing.totals[column.key] += rowValues[column.key];
      });

      teamTotals.set(teamId, existing);
    });

    const teams = Array.from(teamTotals.entries()).map(([teamId, data]) => {
      const officialSlates = officialSlateCountByTeam.get(teamId);
      const slateCount = officialSlates ? officialSlates.size : data.slateIds.size || 1;

      const perSlate: Record<string, number> = {};
      statColumns.forEach((column) => {
        perSlate[column.key] = Number((data.totals[column.key] / slateCount).toFixed(1));
      });

      return {
        teamId,
        slateCount,
        stats: perSlate,
      };
    });

    return NextResponse.json({ success: true, sport, season, statColumns, teams });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load team stats." },
      { status: 500 }
    );
  }
}
