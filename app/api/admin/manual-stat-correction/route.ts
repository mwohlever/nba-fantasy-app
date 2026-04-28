import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function calculateFantasyPoints({
  points,
  rebounds,
  assists,
  steals,
  blocks,
  turnovers,
}: {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
}) {
  return Number(
    (
      points +
      rebounds * 1.2 +
      assists * 1.5 +
      steals * 2 +
      blocks * 2 -
      turnovers
    ).toFixed(1)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const slateId = Number(body.slateId);
    const playerId = Number(body.playerId);

    const points = Number(body.points ?? 0);
    const rebounds = Number(body.rebounds ?? 0);
    const assists = Number(body.assists ?? 0);
    const steals = Number(body.steals ?? 0);
    const blocks = Number(body.blocks ?? 0);
    const turnovers = Number(body.turnovers ?? 0);

    if (!Number.isFinite(slateId) || !Number.isFinite(playerId)) {
      return NextResponse.json(
        { error: "Valid slateId and playerId required" },
        { status: 400 }
      );
    }

    const fantasyPoints = calculateFantasyPoints({
      points,
      rebounds,
      assists,
      steals,
      blocks,
      turnovers,
    });

    // ✅ UPSERT (fixes your issue permanently)
    const { error: upsertError } = await supabaseAdmin
      .from("player_slate_stats")
      .upsert(
        {
          slate_id: slateId,
          player_id: playerId,
          points,
          rebounds,
          assists,
          steals,
          blocks,
          turnovers,
          fantasy_points: fantasyPoints,
        },
        { onConflict: "slate_id,player_id" }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // 🔁 Recalculate team results (same logic you already had)
    const { data: lineups } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, lineup_players(player_id)")
      .eq("slate_id", slateId);

    const allPlayerIds = Array.from(
      new Set(
        (lineups ?? []).flatMap((l) =>
          (l.lineup_players ?? []).map((lp: any) => Number(lp.player_id))
        )
      )
    );

    const { data: stats } = await supabaseAdmin
      .from("player_slate_stats")
      .select("player_id, fantasy_points")
      .eq("slate_id", slateId)
      .in("player_id", allPlayerIds);

    const statMap = new Map<number, number>();
    (stats ?? []).forEach((s) =>
      statMap.set(Number(s.player_id), Number(s.fantasy_points ?? 0))
    );

    const results = (lineups ?? []).map((l) => {
      const total = (l.lineup_players ?? []).reduce(
        (sum: number, lp: any) =>
          sum + Number(statMap.get(Number(lp.player_id)) ?? 0),
        0
      );

      return {
        team_id: l.team_id,
        fantasy_points: Number(total.toFixed(1)),
      };
    });

    const ranked = [...results].sort(
      (a, b) => b.fantasy_points - a.fantasy_points
    );

    for (const r of ranked) {
      const finish =
        ranked.findIndex((x) => x.fantasy_points === r.fantasy_points) + 1;

      await supabaseAdmin
        .from("team_slate_results")
        .upsert(
          {
            slate_id: slateId,
            team_id: r.team_id,
            fantasy_points: r.fantasy_points,
            finish_position: finish,
            games_completed: 5,
            games_in_progress: 0,
            games_remaining: 0,
          },
          { onConflict: "slate_id,team_id" }
        );
    }

    return NextResponse.json({
      success: true,
      slateId,
      playerId,
      fantasyPoints,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
