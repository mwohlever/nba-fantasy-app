import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

type SubmittedPick = {
  gameId: number;
  pickedTeamId: string;
};

function submittedPicks(
  value: unknown,
): SubmittedPick[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry: any) => ({
      gameId:
        Number(entry?.gameId),

      pickedTeamId:
        String(
          entry?.pickedTeamId ??
            "",
        ).trim(),
    }))
    .filter(
      (entry) =>
        Number.isInteger(
          entry.gameId,
        ) &&
        entry.gameId > 0 &&
        entry.pickedTeamId.length >
          0,
    );
}

export async function POST(
  request: NextRequest,
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        { status: 401 },
      );
    }

    const body =
      await request.json();

    const weekId =
      Number(body?.weekId);

    const picks =
      submittedPicks(
        body?.picks,
      );

    if (
      !Number.isInteger(weekId) ||
      weekId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Valid weekId is required.",
        },
        { status: 400 },
      );
    }

    const {
      data: week,
      error: weekError,
    } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .select(
        "id, lock_at, status",
      )
      .eq("id", weekId)
      .maybeSingle();

    if (weekError || !week) {
      return NextResponse.json(
        {
          error:
            weekError?.message ??
            "Pick 'Em week not found.",
        },
        { status: 404 },
      );
    }

    const lockTime =
      week.lock_at
        ? new Date(
            week.lock_at,
          ).getTime()
        : null;

    const locked =
      week.status !== "open" ||
      (
        lockTime !== null &&
        Number.isFinite(lockTime) &&
        Date.now() >= lockTime
      );

    if (locked) {
      return NextResponse.json(
        {
          error:
            "This week's picks are locked.",
        },
        { status: 409 },
      );
    }

    const {
      data: games,
      error: gamesError,
    } = await supabaseAdmin
      .from("ncaa_pickem_games")
      .select(
        "id, away_team_id, home_team_id",
      )
      .eq("week_id", weekId)
      .eq("included", true);

    if (gamesError) {
      return NextResponse.json(
        {
          error:
            gamesError.message,
        },
        { status: 500 },
      );
    }

    const gameById =
      new Map(
        (games ?? []).map(
          (game) => [
            Number(game.id),
            game,
          ],
        ),
      );

    if (
      picks.length !==
      gameById.size
    ) {
      return NextResponse.json(
        {
          error:
            "Please make a pick for every game before saving.",
        },
        { status: 400 },
      );
    }

    for (const pick of picks) {
      const game =
        gameById.get(
          pick.gameId,
        );

      if (!game) {
        return NextResponse.json(
          {
            error:
              "One of the submitted games is not part of this week's card.",
          },
          { status: 400 },
        );
      }

      const validTeamIds =
        new Set([
          String(
            game.away_team_id,
          ),
          String(
            game.home_team_id,
          ),
        ]);

      if (
        !validTeamIds.has(
          pick.pickedTeamId,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "One of the submitted picks does not belong to that matchup.",
          },
          { status: 400 },
        );
      }
    }

    const rows =
      picks.map(
        (pick) => ({
          week_id: weekId,

          game_id:
            pick.gameId,

          team_id:
            user.teamId,

          picked_team_id:
            pick.pickedTeamId,

          updated_at:
            new Date().toISOString(),
        }),
      );

    const {
      error: saveError,
    } = await supabaseAdmin
      .from("ncaa_pickem_picks")
      .upsert(
        rows,
        {
          onConflict:
            "game_id,team_id",
        },
      );

    if (saveError) {
      return NextResponse.json(
        {
          error:
            saveError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      saved:
        rows.length,
    });
  } catch (error) {
    console.error(
      "Failed to save NCAA Pick 'Em picks",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to save NCAA Pick 'Em picks.",
      },
      { status: 500 },
    );
  }
}
