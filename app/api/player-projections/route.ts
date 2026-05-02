import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PlayerRow = {
  id: number;
  name: string;
  nba_player_id: number | null;
};

type SlateRow = {
  id: number;
  start_date: string | null;
  date: string | null;
};

type PlayerSlateStatRow = {
  player_id: number;
  slate_id: number;
  fantasy_points: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
};

type TeamSlateResultRow = {
  slate_id: number;
  team_id: number;
  finish_position: number | null;
};

type LineupRow = {
  id: number;
  slate_id: number;
  team_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
};

type NbaDashRow = {
  PLAYER_ID: number;
  PLAYER_NAME: string;
  PTS: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  TOV: number;
};

function fallbackFantasyPoints(row: PlayerSlateStatRow) {
  return (
    Number(row.points ?? 0) +
    Number(row.rebounds ?? 0) * 1.2 +
    Number(row.assists ?? 0) * 1.5 +
    Number(row.steals ?? 0) * 2 +
    Number(row.blocks ?? 0) * 2 -
    Number(row.turnovers ?? 0)
  );
}

function nbaFantasyPoints(row: NbaDashRow) {
  return (
    Number(row.PTS ?? 0) +
    Number(row.REB ?? 0) * 1.2 +
    Number(row.AST ?? 0) * 1.5 +
    Number(row.STL ?? 0) * 2 +
    Number(row.BLK ?? 0) * 2 -
    Number(row.TOV ?? 0)
  );
}

function round1(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(1));
}

function avg(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seasonToNbaSeason(season: string) {
  const year = Number(season);
  if (!Number.isFinite(year)) return "2025-26";
  return `${year - 1}-${String(year).slice(-2)}`;
}

async function fetchNbaSeasonAverages(season: string) {
  const nbaSeason = seasonToNbaSeason(season);

  const params = new URLSearchParams({
    College: "",
    Conference: "",
    Country: "",
    DateFrom: "",
    DateTo: "",
    Division: "",
    DraftPick: "",
    DraftYear: "",
    GameScope: "",
    GameSegment: "",
    Height: "",
    LastNGames: "0",
    LeagueID: "00",
    Location: "",
    MeasureType: "Base",
    Month: "0",
    OpponentTeamID: "0",
    Outcome: "",
    PORound: "0",
    PaceAdjust: "N",
    PerMode: "PerGame",
    Period: "0",
    PlayerExperience: "",
    PlayerPosition: "",
    PlusMinus: "N",
    Rank: "N",
    Season: nbaSeason,
    SeasonSegment: "",
    SeasonType: "Regular Season",
    ShotClockRange: "",
    StarterBench: "",
    TeamID: "0",
    TwoWay: "0",
    VsConference: "",
    VsDivision: "",
  });

  const url = `https://stats.nba.com/stats/leaguedashplayerstats?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
      Origin: "https://www.nba.com",
      Referer: "https://www.nba.com/",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true",
    },
  });

  if (!response.ok) {
    throw new Error(`NBA season averages request failed: ${response.status}`);
  }

  const payload = await response.json();
  const resultSet = payload.resultSets?.[0] ?? payload.resultSet;
  const headers: string[] = resultSet?.headers ?? [];
  const rows: any[][] = resultSet?.rowSet ?? [];

  const playerIdIndex = headers.indexOf("PLAYER_ID");
  const playerNameIndex = headers.indexOf("PLAYER_NAME");
  const ptsIndex = headers.indexOf("PTS");
  const rebIndex = headers.indexOf("REB");
  const astIndex = headers.indexOf("AST");
  const stlIndex = headers.indexOf("STL");
  const blkIndex = headers.indexOf("BLK");
  const tovIndex = headers.indexOf("TOV");

  const map = new Map<number, NbaDashRow>();

  rows.forEach((row) => {
    const playerId = Number(row[playerIdIndex]);
    if (!Number.isFinite(playerId)) return;

    map.set(playerId, {
      PLAYER_ID: playerId,
      PLAYER_NAME: String(row[playerNameIndex] ?? ""),
      PTS: Number(row[ptsIndex] ?? 0),
      REB: Number(row[rebIndex] ?? 0),
      AST: Number(row[astIndex] ?? 0),
      STL: Number(row[stlIndex] ?? 0),
      BLK: Number(row[blkIndex] ?? 0),
      TOV: Number(row[tovIndex] ?? 0),
    });
  });

  return map;
}

export async function GET(request: NextRequest) {
  try {
    const season = request.nextUrl.searchParams.get("season") ?? "2026";

    const [
      playersResponse,
      slatesResponse,
      statsResponse,
      lineupsResponse,
      lineupPlayersResponse,
      resultsResponse,
      nbaAverages,
    ] = await Promise.all([
      supabaseAdmin
        .from("players")
        .select("id, name, nba_player_id")
        .eq("is_active", true),
      supabaseAdmin.from("slates").select("id, start_date, date"),
      supabaseAdmin
        .from("player_slate_stats")
        .select(
          "player_id, slate_id, fantasy_points, points, rebounds, assists, steals, blocks, turnovers"
        ),
      supabaseAdmin.from("lineups").select("id, slate_id, team_id"),
      supabaseAdmin.from("lineup_players").select("lineup_id, player_id"),
      supabaseAdmin
        .from("team_slate_results")
        .select("slate_id, team_id, finish_position"),
      fetchNbaSeasonAverages(season).catch((error) => {
        console.error("NBA average fallback failed", error);
        return new Map<number, NbaDashRow>();
      }),
    ]);

    if (playersResponse.error) throw new Error(playersResponse.error.message);
    if (slatesResponse.error) throw new Error(slatesResponse.error.message);
    if (statsResponse.error) throw new Error(statsResponse.error.message);
    if (lineupsResponse.error) throw new Error(lineupsResponse.error.message);
    if (lineupPlayersResponse.error) {
      throw new Error(lineupPlayersResponse.error.message);
    }
    if (resultsResponse.error) throw new Error(resultsResponse.error.message);

    const players = (playersResponse.data ?? []) as PlayerRow[];
    const slates = (slatesResponse.data ?? []) as SlateRow[];
    const stats = (statsResponse.data ?? []) as PlayerSlateStatRow[];
    const lineups = (lineupsResponse.data ?? []) as LineupRow[];
    const lineupPlayers = (lineupPlayersResponse.data ?? []) as LineupPlayerRow[];
    const results = (resultsResponse.data ?? []) as TeamSlateResultRow[];

    const slateDateMap = new Map<number, string>();

    slates.forEach((slate) => {
      const date = slate.start_date ?? slate.date ?? "";
      if (!date) return;
      slateDateMap.set(Number(slate.id), date);
    });

    const seasonSlateIds = new Set(
      slates
        .filter((slate) => {
          const date = slate.start_date ?? slate.date ?? "";
          return date.startsWith(season);
        })
        .map((slate) => Number(slate.id))
    );

    const lineupById = new Map<number, LineupRow>();
    lineups.forEach((lineup) => lineupById.set(Number(lineup.id), lineup));

    const resultBySlateTeam = new Map<string, TeamSlateResultRow>();
    results.forEach((result) => {
      resultBySlateTeam.set(`${result.slate_id}-${result.team_id}`, result);
    });

    const draftedSlateIdsByPlayer = new Map<number, Set<number>>();
    const finishesByPlayer = new Map<number, number[]>();

    lineupPlayers.forEach((lineupPlayer) => {
      const lineup = lineupById.get(Number(lineupPlayer.lineup_id));
      if (!lineup) return;
      if (!seasonSlateIds.has(Number(lineup.slate_id))) return;

      const playerId = Number(lineupPlayer.player_id);
      const slateSet = draftedSlateIdsByPlayer.get(playerId) ?? new Set<number>();
      slateSet.add(Number(lineup.slate_id));
      draftedSlateIdsByPlayer.set(playerId, slateSet);

      const result = resultBySlateTeam.get(`${lineup.slate_id}-${lineup.team_id}`);
      const finish = Number(result?.finish_position ?? 0);
      if (finish > 0) {
        const current = finishesByPlayer.get(playerId) ?? [];
        current.push(finish);
        finishesByPlayer.set(playerId, current);
      }
    });

    const scoresByPlayer = new Map<
      number,
      Array<{ slateId: number; date: string; fantasyPoints: number }>
    >();

    stats.forEach((stat) => {
      const slateId = Number(stat.slate_id);
      if (!seasonSlateIds.has(slateId)) return;

      const playerId = Number(stat.player_id);
      const score = Number(stat.fantasy_points ?? fallbackFantasyPoints(stat));

      if (!Number.isFinite(score) || score <= 0) return;

      const current = scoresByPlayer.get(playerId) ?? [];
      current.push({
        slateId,
        date: slateDateMap.get(slateId) ?? "",
        fantasyPoints: score,
      });
      scoresByPlayer.set(playerId, current);
    });

    const projections: Record<number, any> = {};

    players.forEach((player) => {
      const playerId = Number(player.id);
      const nbaPlayerId = player.nba_player_id ? Number(player.nba_player_id) : null;
      const nbaRow = nbaPlayerId ? nbaAverages.get(nbaPlayerId) ?? null : null;
      const nbaSeasonAverage = nbaRow ? nbaFantasyPoints(nbaRow) : null;

      const draftedCount = draftedSlateIdsByPlayer.get(playerId)?.size ?? 0;

      const scoreRows = (scoresByPlayer.get(playerId) ?? []).sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      const allScores = scoreRows.map((row) => row.fantasyPoints);
      const seasonAvg = avg(allScores);
      const recentAvg = avg(scoreRows.slice(-3).map((row) => row.fantasyPoints));
      const avgFinish = avg(finishesByPlayer.get(playerId) ?? []);

      const useLeagueProjection =
        draftedCount >= 2 && seasonAvg !== null && recentAvg !== null;

      let projection: number | null = null;
      let source: "league" | "nbaSeasonAverage" = "nbaSeasonAverage";

      if (useLeagueProjection) {
        const finishBoost =
          avgFinish !== null ? Math.max(-3, Math.min(3, (3 - avgFinish) * 1.5)) : 0;

        projection = seasonAvg * 0.45 + recentAvg * 0.50 + finishBoost;
        source = "league";
      } else {
        projection = nbaSeasonAverage;
      }

      const badges: string[] = [];

      if (
        source === "league" &&
        seasonAvg !== null &&
        recentAvg !== null &&
        recentAvg >= seasonAvg * 1.1
      ) {
        badges.push("hot");
      }

      if (
        source === "league" &&
        seasonAvg !== null &&
        recentAvg !== null &&
        recentAvg <= seasonAvg * 0.9
      ) {
        badges.push("cold");
      }

      if (source === "league" && avgFinish !== null && avgFinish <= 2) {
        badges.push("trophy");
      }

      const confidence =
        source === "league" && draftedCount >= 4
          ? "high"
          : source === "league"
            ? "medium"
            : "low";

      projections[playerId] = {
        playerId,
        playerName: player.name,
        projection: round1(projection),
        source,
        confidence,
        badges,
        draftedCount,
        seasonAvg: round1(seasonAvg),
        recentAvg: round1(recentAvg),
        avgFinish: round1(avgFinish),
        nbaSeasonAverage: round1(nbaSeasonAverage),
      };
    });

    return NextResponse.json({
      season,
      nbaSeason: seasonToNbaSeason(season),
      projections,
    });
  } catch (error) {
    console.error("Failed to build player projections", error);
    return NextResponse.json(
      { error: "Failed to build player projections." },
      { status: 500 }
    );
  }
}
