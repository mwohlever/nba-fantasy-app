import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slateId = Number(body.slateId);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json({ error: "Valid slateId is required." }, { status: 400 });
    }

    const authorization = await authorizeSlateResource(
      request,
      slateId,
      { requireCommissioner: true },
    );

    if (!authorization.ok) return authorization.response;

    const { data: lineups, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select("id, team_id, lineup_players(player_id)")
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json({ error: lineupsError.message }, { status: 500 });
    }

    const allPlayerIds = Array.from(
      new Set(
        (lineups ?? []).flatMap((lineup) =>
          (lineup.lineup_players ?? []).map((lp: { player_id: number }) =>
            Number(lp.player_id)
          )
        )
      )
    );

    const { data: stats, error: statsError } = await supabaseAdmin
      .from("player_slate_stats")
      .select("player_id, fantasy_points")
      .eq("slate_id", slateId)
      .in("player_id", allPlayerIds);

    if (statsError) {
      return NextResponse.json({ error: statsError.message }, { status: 500 });
    }

    const statMap = new Map<number, number>();
    (stats ?? []).forEach((stat) => {
      statMap.set(Number(stat.player_id), Number(stat.fantasy_points ?? 0));
    });

    const results = (lineups ?? []).map((lineup) => {
      const total = (lineup.lineup_players ?? []).reduce(
        (sum: number, lp: { player_id: number }) =>
          sum + Number(statMap.get(Number(lp.player_id)) ?? 0),
        0
      );

      return {
        team_id: Number(lineup.team_id),
        fantasy_points: Number(total.toFixed(1)),
      };
    });

    const ranked = [...results].sort((a, b) => b.fantasy_points - a.fantasy_points);

    for (const result of ranked) {
      const finishPosition =
        ranked.findIndex((row) => row.fantasy_points === result.fantasy_points) + 1;

      const { error: upsertError } = await supabaseAdmin
        .from("team_slate_results")
        .upsert(
          {
            slate_id: slateId,
            team_id: result.team_id,
            fantasy_points: result.fantasy_points,
            finish_position: finishPosition,
            games_completed: 5,
            games_in_progress: 0,
            games_remaining: 0,
          },
          { onConflict: "slate_id,team_id" }
        );

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      slateId,
      results: ranked.map((row) => ({
        ...row,
        finish_position:
          ranked.findIndex((other) => other.fantasy_points === row.fantasy_points) + 1,
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while recomputing slate results." },
      { status: 500 }
    );
  }
}
