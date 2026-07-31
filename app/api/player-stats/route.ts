export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

type GolfCourseHoleRow = {
  hole_number: number;
  par: number;
  yards: number | null;
  is_host: boolean;
};

function mergeGolfRoundHoles(
  playerHoles: any[],
  courseHoleByNumber: Map<number, GolfCourseHoleRow>,
) {
  const playerHoleByNumber = new Map(
    (playerHoles ?? []).map((hole: any) => [
      Number(hole.hole_number),
      hole,
    ]),
  );

  return Array.from(
    { length: 18 },
    (_, index) => index + 1,
  ).map((holeNumber) => {
    const playerHole =
      playerHoleByNumber.get(holeNumber);

    const courseHole =
      courseHoleByNumber.get(holeNumber);

    return {
      hole_number: holeNumber,
      par:
        courseHole?.par === undefined
          ? null
          : Number(courseHole.par),
      yards:
        courseHole?.yards === null ||
        courseHole?.yards === undefined
          ? null
          : Number(courseHole.yards),
      strokes:
        playerHole?.strokes === null ||
        playerHole?.strokes === undefined
          ? null
          : Number(playerHole.strokes),
      relative_to_par:
        playerHole?.relative_to_par === null ||
        playerHole?.relative_to_par === undefined
          ? null
          : Number(playerHole.relative_to_par),
      score_display:
        playerHole?.score_display ?? null,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const slateIdParam = request.nextUrl.searchParams.get("slateId");

    if (!slateIdParam) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "slateId must be a valid number." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("sport")
      .eq("id", slateId)
      .maybeSingle();

    if (slateError) {
      return NextResponse.json(
        { error: `Failed to load slate: ${slateError.message}` },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    const sport =
      slate?.sport === "nfl"
        ? "nfl"
        : slate?.sport === "golf"
          ? "golf"
          : "nba";

    if (sport === "golf") {
      const { data, error } = await supabaseAdmin
        .from("golf_event_players")
        .select(
          `
          player_id,
          leaderboard_order,
          official_score_to_par,
          official_score_display,
          penalty_strokes,
          fantasy_score,
          rounds_completed,
          holes_completed,
          current_round,
          last_hole,
          status,
          tee_time,
          tee_time_raw,
          golf_rounds (
            round_number,
            score_to_par,
            score_display,
            strokes,
            holes_completed,
            tee_time,
            tee_time_raw,
            status,
            golf_holes (
              hole_number,
              strokes,
              relative_to_par,
              score_display
            )
          )
        `,
        )
        .eq("slate_id", slateId)
        .order("leaderboard_order", {
          ascending: true,
          nullsFirst: false,
        });

      if (error) {
        return NextResponse.json(
          { error: `Failed to load Golf stats: ${error.message}` },
          { status: 500, headers: noStoreHeaders() },
        );
      }

      const { data: courseHoleData, error: courseHoleError } =
        await supabaseAdmin
          .from("golf_course_holes")
          .select(
            "hole_number, par, yards, is_host",
          )
          .eq("slate_id", slateId)
          .order("is_host", {
            ascending: false,
          })
          .order("hole_number", {
            ascending: true,
          });

      if (courseHoleError) {
        return NextResponse.json(
          {
            error:
              `Failed to load Golf course data: ${courseHoleError.message}`,
          },
          {
            status: 500,
            headers: noStoreHeaders(),
          },
        );
      }

      const courseHoleByNumber =
        new Map<number, GolfCourseHoleRow>();

      for (const row of courseHoleData ?? []) {
        const holeNumber = Number(row.hole_number);

        if (!courseHoleByNumber.has(holeNumber)) {
          courseHoleByNumber.set(
            holeNumber,
            row as GolfCourseHoleRow,
          );
        }
      }

      const playerStats = (data ?? []).map((row: any) => ({
        player_id: Number(row.player_id),
        leaderboard_order:
          row.leaderboard_order === null
            ? null
            : Number(row.leaderboard_order),
        official_score_to_par:
          row.official_score_to_par === null
            ? null
            : Number(row.official_score_to_par),
        official_score_display: row.official_score_display ?? null,
        penalty_strokes: Number(row.penalty_strokes ?? 0),
        fantasy_points:
          row.fantasy_score === null ? null : Number(row.fantasy_score),
        rounds_completed: Number(row.rounds_completed ?? 0),
        holes_completed: Number(row.holes_completed ?? 0),
        current_round:
          row.current_round === null ? null : Number(row.current_round),
        last_hole: row.last_hole === null ? null : Number(row.last_hole),
        status: row.status ?? "scheduled",
        tee_time: row.tee_time ?? null,
        tee_time_raw: row.tee_time_raw ?? null,
        rounds: (row.golf_rounds ?? [])
          .map((round: any) => ({
            round_number: Number(round.round_number),
            score_to_par:
              round.score_to_par === null
                ? null
                : Number(round.score_to_par),
            score_display: round.score_display ?? null,
            strokes:
              round.strokes === null ? null : Number(round.strokes),
            holes_completed: Number(round.holes_completed ?? 0),
            tee_time: round.tee_time ?? null,
            tee_time_raw: round.tee_time_raw ?? null,
            status: round.status ?? "scheduled",
            holes: mergeGolfRoundHoles(
              round.golf_holes ?? [],
              courseHoleByNumber,
            ),
          }))
          .sort(
            (a: { round_number: number }, b: { round_number: number }) =>
              a.round_number - b.round_number,
          ),
      }));

      return NextResponse.json(
        {
          success: true,
          sport,
          playerStats,
        },
        { headers: noStoreHeaders() },
      );
    }

    if (sport === "nfl") {
      const { data, error } = await supabaseAdmin
        .from("player_nfl_slate_stats")
        .select(
          `
          player_id,
          passing_yards,
          passing_tds,
          passing_ints,
          rushing_yards,
          rushing_tds,
          receiving_yards,
          receiving_tds,
          receptions,
          fumbles_lost,
          fantasy_points,
          game_status,
          game_status_text
        `,
        )
        .eq("slate_id", slateId)
        .order("player_id", { ascending: true });

      if (error) {
        return NextResponse.json(
          { error: `Failed to load player stats: ${error.message}` },
          { status: 500, headers: noStoreHeaders() },
        );
      }

      return NextResponse.json(
        { success: true, sport, playerStats: data ?? [] },
        { headers: noStoreHeaders() },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("player_slate_stats")
      .select(
        `
        player_id,
        points,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        fantasy_points,
        game_status,
        game_status_text,
        period,
        game_clock
      `,
      )
      .eq("slate_id", slateId)
      .order("player_id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load player stats: ${error.message}` },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    return NextResponse.json(
      { success: true, sport, playerStats: data ?? [] },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Unexpected server error while loading player stats." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
