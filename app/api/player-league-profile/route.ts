import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const playerId = Number(searchParams.get("playerId"));

  if (!playerId) {
    return NextResponse.json({ error: "Missing playerId." }, { status: 400 });
  }

  const [
    { data: player },
    { data: lineupPlayers },
    { data: lineups },
    { data: teams },
    { data: slates },
    { data: results },
    { data: stats },
  ] = await Promise.all([
    supabaseAdmin.from("players").select("id, name, position_group").eq("id", playerId).single(),
    supabaseAdmin.from("lineup_players").select("lineup_id, player_id").eq("player_id", playerId),
    supabaseAdmin.from("lineups").select("id, slate_id, team_id"),
    supabaseAdmin.from("teams").select("id, name"),
    supabaseAdmin.from("slates").select("id, date, start_date, end_date"),
    supabaseAdmin.from("team_slate_results").select("slate_id, team_id, finish_position"),
    supabaseAdmin
      .from("player_slate_stats")
      .select("slate_id, player_id, points, rebounds, assists, steals, blocks, turnovers, fantasy_points")
      .eq("player_id", playerId),
  ]);

  const safeLineupPlayers = lineupPlayers ?? [];
  const safeLineups = lineups ?? [];
  const safeTeams = teams ?? [];
  const safeSlates = slates ?? [];
  const safeResults = results ?? [];
  const safeStats = stats ?? [];

  const draftedRows = safeLineupPlayers
    .map((lp) => safeLineups.find((l) => l.id === lp.lineup_id))
    .filter(Boolean);

  const enriched = draftedRows.map((draft: any) => {
    const team = safeTeams.find((t) => t.id === draft.team_id);
    const slate = safeSlates.find((s) => s.id === draft.slate_id);
    const result = safeResults.find(
      (r) => r.slate_id === draft.slate_id && r.team_id === draft.team_id
    );
    const stat = safeStats.find((s) => s.slate_id === draft.slate_id);

    const start = slate?.start_date ?? slate?.date ?? "";
    const end = slate?.end_date ?? slate?.date ?? "";
    const label = start && end && start !== end ? `${start} - ${end}` : start || "Unknown slate";

    return {
      slateId: draft.slate_id,
      slateLabel: label,
      teamName: team?.name ?? "Unknown",
      finishPosition: result?.finish_position ?? null,
      points: stat?.points ?? 0,
      rebounds: stat?.rebounds ?? 0,
      assists: stat?.assists ?? 0,
      steals: stat?.steals ?? 0,
      blocks: stat?.blocks ?? 0,
      turnovers: stat?.turnovers ?? 0,
      fantasyPoints: stat?.fantasy_points ?? null,
    };
  });

  const scores = enriched
    .map((r) => r.fantasyPoints)
    .filter((v): v is number => v !== null && v !== undefined);

  const draftedByBreakdown = [...enriched.reduce((map, row) => {
    map.set(row.teamName, (map.get(row.teamName) ?? 0) + 1);
    return map;
  }, new Map<string, number>())]
    .map(([teamName, count]) => ({ teamName, count }))
    .sort((a, b) => b.count - a.count || a.teamName.localeCompare(b.teamName));

  const draftedMostBy = draftedByBreakdown[0] ?? null;
  const wins = enriched.filter((r) => r.finishPosition === 1).length;
  const runnerUps = enriched.filter((r) => r.finishPosition === 2).length;
  const winRate = enriched.length > 0 ? round((wins / enriched.length) * 100, 1) : null;

  return NextResponse.json({
    success: true,
    player: {
      id: player?.id ?? playerId,
      name: player?.name ?? "Unknown Player",
      position_group: player?.position_group ?? null,
    },
    summary: {
      timesDrafted: enriched.length,
      wins,
      runnerUps,
      winRate,
      draftedMostBy,
      draftedByBreakdown,
      averageFantasyPoints:
        scores.length > 0 ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      bestFantasyPoints: scores.length > 0 ? round(Math.max(...scores)) : null,
      worstFantasyPoints: scores.length > 0 ? round(Math.min(...scores)) : null,
    },
    recentHistory: enriched
      .sort((a, b) => String(b.slateLabel).localeCompare(String(a.slateLabel)))
      .slice(0, 8),
  });
}
