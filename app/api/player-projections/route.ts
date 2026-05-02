import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Player = {
  id: number;
  name: string;
  nba_player_id: number | null;
  is_active: boolean;
};

type Slate = {
  id: number;
  start_date: string | null;
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

type PlayerSlateStat = {
  slate_id: number;
  player_id: number;
  fantasy_points: number | null;
};

type TeamSlateResult = {
  slate_id: number;
  team_id: number;
  finish_position: number | null;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function getNbaSeason(appSeason: string) {
  const year = Number(appSeason);
  if (!Number.isFinite(year)) return "2025-26";
  return `${year - 1}-${String(year).slice(-2)}`;
}

function getDateRangeForSeason(appSeason: string) {
  const year = Number(appSeason);
  if (!Number.isFinite(year)) {
    return {
      start: "2026-01-01",
      end: "2026-12-31",
    };
  }

  // App season means fantasy-app season only.
  // Example: season=2026 should use only 2026 app slates.
  // NBA regular season fallback remains separate via getNbaSeason().
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

export async function GET(req: NextRequest) {
  const season = req.nextUrl.searchParams.get("season") || "2026";
  const nbaSeason = getNbaSeason(season);
  const range = getDateRangeForSeason(season);

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
    .gte("start_date", range.start)
    .lte("start_date", range.end);

  if (slatesError) {
    return NextResponse.json({ error: slatesError.message }, { status: 500 });
  }

  const slateIds = ((slates || []) as Slate[]).map((slate) => slate.id);

  const slateDateById = new Map<number, string>();
  for (const slate of (slates || []) as Slate[]) {
    slateDateById.set(slate.id, slate.start_date || "");
  }

  const { data: nbaRows, error: nbaError } = await supabaseAdmin
    .from("player_nba_season_averages")
    .select("season,nba_player_id,player_name,fantasy_points")
    .eq("season", nbaSeason);

  if (nbaError) {
    return NextResponse.json({ error: nbaError.message }, { status: 500 });
  }

  const nbaAverageByNbaId = new Map<number, number>();
  for (const row of nbaRows || []) {
    nbaAverageByNbaId.set(Number(row.nba_player_id), Number(row.fantasy_points));
  }

  let lineups: Lineup[] = [];
  let lineupPlayers: LineupPlayer[] = [];
  let playerStats: PlayerSlateStat[] = [];
  let teamResults: TeamSlateResult[] = [];

  if (slateIds.length > 0) {
    const [lineupsRes, statsRes, resultsRes] = await Promise.all([
      supabaseAdmin
        .from("lineups")
        .select("id,slate_id,team_id")
        .in("slate_id", slateIds),
      supabaseAdmin
        .from("player_slate_stats")
        .select("slate_id,player_id,fantasy_points")
        .in("slate_id", slateIds),
      supabaseAdmin
        .from("team_slate_results")
        .select("slate_id,team_id,finish_position")
        .in("slate_id", slateIds),
    ]);

    if (lineupsRes.error) {
      return NextResponse.json({ error: lineupsRes.error.message }, { status: 500 });
    }

    if (statsRes.error) {
      return NextResponse.json({ error: statsRes.error.message }, { status: 500 });
    }

    if (resultsRes.error) {
      return NextResponse.json({ error: resultsRes.error.message }, { status: 500 });
    }

    lineups = (lineupsRes.data || []) as Lineup[];
    playerStats = (statsRes.data || []) as PlayerSlateStat[];
    teamResults = (resultsRes.data || []) as TeamSlateResult[];

    const lineupIds = lineups.map((lineup) => lineup.id);

    if (lineupIds.length > 0) {
      const lineupPlayersRes = await supabaseAdmin
        .from("lineup_players")
        .select("lineup_id,player_id")
        .in("lineup_id", lineupIds);

      if (lineupPlayersRes.error) {
        return NextResponse.json({ error: lineupPlayersRes.error.message }, { status: 500 });
      }

      lineupPlayers = (lineupPlayersRes.data || []) as LineupPlayer[];
    }
  }

  const lineupById = new Map<number, Lineup>();
  for (const lineup of lineups) {
    lineupById.set(lineup.id, lineup);
  }

  const statBySlateAndPlayer = new Map<string, number>();
  for (const stat of playerStats) {
    const fp = Number(stat.fantasy_points ?? 0);
    if (!Number.isFinite(fp) || fp <= 0) continue;
    statBySlateAndPlayer.set(`${stat.slate_id}:${stat.player_id}`, fp);
  }

  const finishBySlateAndTeam = new Map<string, number>();
  for (const result of teamResults) {
    const finish = Number(result.finish_position);
    if (!Number.isFinite(finish) || finish <= 0) continue;
    finishBySlateAndTeam.set(`${result.slate_id}:${result.team_id}`, finish);
  }

  const scoresByPlayer = new Map<number, Array<{ score: number; slateDate: string }>>();
  const finishesByPlayer = new Map<number, number[]>();

  for (const lp of lineupPlayers) {
    const lineup = lineupById.get(lp.lineup_id);
    if (!lineup) continue;

    const score = statBySlateAndPlayer.get(`${lineup.slate_id}:${lp.player_id}`);
    if (typeof score === "number") {
      const scores = scoresByPlayer.get(lp.player_id) || [];
      scores.push({
        score,
        slateDate: slateDateById.get(lineup.slate_id) || "",
      });
      scoresByPlayer.set(lp.player_id, scores);
    }

    const finish = finishBySlateAndTeam.get(`${lineup.slate_id}:${lineup.team_id}`);
    if (typeof finish === "number") {
      const finishes = finishesByPlayer.get(lp.player_id) || [];
      finishes.push(finish);
      finishesByPlayer.set(lp.player_id, finishes);
    }
  }

  const projections: Record<number, any> = {};

  for (const player of (players || []) as Player[]) {
    const scoreRows = (scoresByPlayer.get(player.id) || []).sort((a, b) =>
      a.slateDate.localeCompare(b.slateDate)
    );
    const scores = scoreRows.map((row) => row.score);
    const finishes = finishesByPlayer.get(player.id) || [];
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
    let source: "league" | "nbaSeasonAverage" | "none" = "none";
    let confidence: "high" | "medium" | "low" = "low";
    const badges: string[] = [];

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
      source = "league";
      confidence = draftedCount >= 4 ? "high" : "medium";

      const badgeBaseline = nbaSeasonAverage ?? seasonAvg;

      if (badgeBaseline !== null) {
        if (recentAvg >= badgeBaseline + 2.5) badges.push("hot");
        if (recentAvg <= badgeBaseline - 2.5) badges.push("cold");
      }

      if (badges.includes("hot")) {
        projection = round1(projection + 1.5);
      }

      if (badges.includes("cold")) {
        projection = round1(projection - 1.5);
      }

      if (avgFinish !== null && avgFinish <= 2) badges.push("trophy");
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
      avgFinish: avgFinish === null ? null : round1(avgFinish),
      nbaSeasonAverage: nbaSeasonAverage === null ? null : round1(nbaSeasonAverage),
    };
  }

  return NextResponse.json({
    season,
    nbaSeason,
    count: Object.keys(projections).length,
    projections,
  });
}
