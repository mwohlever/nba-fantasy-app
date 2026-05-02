import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Player = {
  id: number;
  name: string;
  nba_player_id: number | null;
  is_active: boolean;
};

type PlayerStat = {
  player_id: number;
  fantasy_points: number | null;
};

function getNbaSeason(appSeason: string) {
  const year = Number(appSeason);
  if (!Number.isFinite(year)) return "2025-26";
  return `${year - 1}-${String(year).slice(-2)}`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export async function GET(req: NextRequest) {
  const season = req.nextUrl.searchParams.get("season") || "2026";
  const nbaSeason = getNbaSeason(season);

  const seasonStart = `${Number(season) - 1}-01-01`;
  const seasonEnd = `${season}-12-31`;

  const { data: players, error: playersError } = await supabaseAdmin
    .from("players")
    .select("id,name,nba_player_id,is_active")
    .eq("is_active", true);

  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 });
  }

  const { data: slates, error: slatesError } = await supabaseAdmin
    .from("slates")
    .select("id,start_date")
    .gte("start_date", seasonStart)
    .lte("start_date", seasonEnd);

  if (slatesError) {
    return NextResponse.json({ error: slatesError.message }, { status: 500 });
  }

  const slateIds = (slates || []).map((s) => s.id);

  let playerStats: PlayerStat[] = [];

  if (slateIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("player_slate_stats")
      .select("player_id,fantasy_points")
      .in("slate_id", slateIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    playerStats = data || [];
  }

  const { data: nbaAverages, error: nbaAverageError } = await supabaseAdmin
    .from("player_nba_season_averages")
    .select("season,nba_player_id,player_name,fantasy_points")
    .eq("season", nbaSeason);

  if (nbaAverageError) {
    return NextResponse.json({ error: nbaAverageError.message }, { status: 500 });
  }

  const nbaAverageByPlayerId = new Map<number, number>();
  for (const row of nbaAverages || []) {
    nbaAverageByPlayerId.set(Number(row.nba_player_id), Number(row.fantasy_points));
  }

  const statsByPlayer = new Map<number, number[]>();

  for (const stat of playerStats) {
    const fp = Number(stat.fantasy_points ?? 0);
    if (!Number.isFinite(fp) || fp <= 0) continue;

    const existing = statsByPlayer.get(stat.player_id) || [];
    existing.push(fp);
    statsByPlayer.set(stat.player_id, existing);
  }

  const projections: Record<number, any> = {};

  for (const player of (players || []) as Player[]) {
    const draftedScores = statsByPlayer.get(player.id) || [];
    const draftedCount = draftedScores.length;

    const seasonAvg =
      draftedCount > 0
        ? draftedScores.reduce((sum, value) => sum + value, 0) / draftedCount
        : null;

    const recentScores = draftedScores.slice(-3);
    const recentAvg =
      recentScores.length > 0
        ? recentScores.reduce((sum, value) => sum + value, 0) / recentScores.length
        : null;

    const nbaSeasonAverage = player.nba_player_id
      ? nbaAverageByPlayerId.get(Number(player.nba_player_id)) ?? null
      : null;

    let projection: number | null = null;
    let source: "league" | "nbaSeasonAverage" | "none" = "none";
    let confidence: "high" | "medium" | "low" = "low";
    const badges: string[] = [];

    if (draftedCount >= 2 && seasonAvg !== null && recentAvg !== null) {
      projection = round1(seasonAvg * 0.45 + recentAvg * 0.5);
      source = "league";
      confidence = draftedCount >= 4 ? "high" : "medium";

      if (recentAvg >= seasonAvg + 3) badges.push("hot");
      if (recentAvg <= seasonAvg - 3) badges.push("cold");
      if (seasonAvg >= 40) badges.push("trophy");
    } else if (nbaSeasonAverage !== null) {
      projection = round1(nbaSeasonAverage);
      source = "nbaSeasonAverage";
      confidence = "low";
    }

    projections[player.id] = {
      playerId: player.id,
      playerName: player.name,
      projection,
      source,
      confidence,
      badges,
      draftedCount,
      seasonAvg: seasonAvg === null ? null : round1(seasonAvg),
      recentAvg: recentAvg === null ? null : round1(recentAvg),
      avgFinish: null,
      nbaSeasonAverage,
    };
  }

  return NextResponse.json({
    season,
    nbaSeason,
    count: Object.keys(projections).length,
    projections,
  });
}
