import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RouteContext = {
  params: Promise<{
    slateId: string;
  }>;
};

type SlateTeamRow = {
  slate_id: number;
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

type TeamResultRow = {
  slate_id: number;
  team_id: number;
  finish_position: number | null;
  fantasy_points: number | null;
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const { slateId: slateIdParam } = await context.params;
    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "Invalid slate id." },
        { status: 400 }
      );
    }

    const { data: currentSlate, error: currentSlateError } = await supabaseAdmin
      .from("slates")
      .select("id, start_date, end_date")
      .eq("id", slateId)
      .single();

    if (currentSlateError || !currentSlate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    const [
      { data: previousSlates, error: previousSlatesError },
      { data: slateTeams, error: slateTeamsError },
      { data: teams, error: teamsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select("id, start_date, end_date, is_locked")
        .lt("start_date", currentSlate.start_date)
        .eq("is_locked", true)
        .order("start_date", { ascending: false })
        .limit(1),
      supabaseAdmin
        .from("slate_teams")
        .select("slate_id, team_id, draft_order, is_participating")
        .eq("slate_id", slateId),
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .order("name", { ascending: true }),
    ]);

    if (previousSlatesError || slateTeamsError || teamsError) {
      return NextResponse.json(
        {
          error:
            previousSlatesError?.message ||
            slateTeamsError?.message ||
            teamsError?.message ||
            "Failed to prepare reseed.",
        },
        { status: 500 }
      );
    }

    const previousSlate = previousSlates?.[0];

    if (!previousSlate) {
      return NextResponse.json(
        { error: "No previous locked slate found to reseed from." },
        { status: 400 }
      );
    }

    const { data: previousResults, error: previousResultsError } = await supabaseAdmin
      .from("team_slate_results")
      .select("slate_id, team_id, finish_position, fantasy_points")
      .eq("slate_id", previousSlate.id);

    if (previousResultsError) {
      return NextResponse.json(
        { error: `Failed to load previous slate results: ${previousResultsError.message}` },
        { status: 500 }
      );
    }

    const safeSlateTeams = (slateTeams ?? []) as SlateTeamRow[];
    const safePreviousResults = (previousResults ?? []) as TeamResultRow[];

    const configMap = new Map(
      safeSlateTeams.map((row) => [row.team_id, row])
    );

    const previousOrderMap = new Map<number, number>();
    safePreviousResults
      .filter((row) => row.finish_position !== null)
      .sort((a, b) => {
        const aFinish = a.finish_position ?? 999;
        const bFinish = b.finish_position ?? 999;
        if (aFinish !== bFinish) return aFinish - bFinish;
        return Number(a.fantasy_points ?? 0) - Number(b.fantasy_points ?? 0);
      })
      .forEach((row) => {
        previousOrderMap.set(row.team_id, row.finish_position ?? 999);
      });

    const merged = (teams ?? []).map((team, index) => {
      const config = configMap.get(team.id);
      return {
        team_id: team.id,
        draft_order: config?.draft_order ?? index + 1,
        is_participating: config?.is_participating ?? true,
      };
    });

    const participating = merged
      .filter((row) => row.is_participating)
      .sort((a, b) => {
        const aPrev = previousOrderMap.get(a.team_id) ?? 999;
        const bPrev = previousOrderMap.get(b.team_id) ?? 999;
        if (aPrev !== bPrev) return bPrev - aPrev;
        return a.draft_order - b.draft_order;
      });

    const nonParticipating = merged
      .filter((row) => !row.is_participating)
      .sort((a, b) => a.draft_order - b.draft_order);

    const reseeded = [...participating, ...nonParticipating].map((row, index) => ({
      slate_id: slateId,
      team_id: row.team_id,
      draft_order: index + 1,
      is_participating: row.is_participating,
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("slate_teams")
      .upsert(reseeded, { onConflict: "slate_id,team_id" });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to reseed slate: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Slate reseeded from previous results.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while reseeding slate." },
      { status: 500 }
    );
  }
}
