import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateTeamUpdate = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

type UpdateSlateBody = {
  is_locked?: boolean;
  teams?: SlateTeamUpdate[];
  nba_team_abbreviations?: string[];
};

type RouteContext = {
  params: Promise<{
    slateId: string;
  }>;
};

export async function GET(_: NextRequest, context: RouteContext) {
  try {
    const { slateId: slateIdParam } = await context.params;
    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "Invalid slate id." },
        { status: 400 }
      );
    }

    const [
      { data: slate, error: slateError },
      { data: teams, error: teamsError },
      { data: slateTeams, error: slateTeamsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select("id, date, start_date, end_date, is_locked, nba_team_abbreviations")
        .eq("id", slateId)
        .single(),
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("slate_teams")
        .select("slate_id, team_id, draft_order, is_participating")
        .eq("slate_id", slateId),
    ]);

    if (slateError || !slate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    if (teamsError || slateTeamsError) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            slateTeamsError?.message ||
            "Failed to load slate details.",
        },
        { status: 500 }
      );
    }

    const safeTeams = teams ?? [];
    const safeSlateTeams = slateTeams ?? [];

    const configMap = new Map(
      safeSlateTeams.map((row) => [row.team_id, row])
    );

    const mergedTeams = safeTeams
      .map((team, index) => {
        const config = configMap.get(team.id);

        return {
          team_id: team.id,
          team_name: team.name,
          draft_order: config?.draft_order ?? index + 1,
          is_participating: config?.is_participating ?? true,
        };
      })
      .sort((a, b) => a.draft_order - b.draft_order);

    return NextResponse.json({
      success: true,
      slate: {
        ...slate,
        label:
          slate.start_date && slate.end_date && slate.start_date !== slate.end_date
            ? `${slate.start_date} - ${slate.end_date}`
            : slate.start_date ?? slate.date,
      },
      teams: mergedTeams,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading slate details." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { slateId: slateIdParam } = await context.params;
    const slateId = Number(slateIdParam);
    const body = (await request.json()) as UpdateSlateBody;

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "Invalid slate id." },
        { status: 400 }
      );
    }

    const teams = body.teams ?? [];
    const isLocked = body.is_locked;
    const nbaTeamAbbreviations = (body.nba_team_abbreviations ?? [])
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    if (!Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        { error: "At least one team config is required." },
        { status: 400 }
      );
    }

    const uniqueOrders = new Set(teams.map((team) => team.draft_order));
    if (uniqueOrders.size !== teams.length) {
      return NextResponse.json(
        { error: "Draft order values must be unique." },
        { status: 400 }
      );
    }

    const { data: existingSlate, error: existingSlateError } = await supabaseAdmin
      .from("slates")
      .select("id")
      .eq("id", slateId)
      .single();

    if (existingSlateError || !existingSlate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    const slateUpdatePayload: {
      is_locked?: boolean;
      nba_team_abbreviations?: string[];
    } = {
      nba_team_abbreviations: nbaTeamAbbreviations,
    };

    if (typeof isLocked === "boolean") {
      slateUpdatePayload.is_locked = isLocked;
    }

    const { error: slateUpdateError } = await supabaseAdmin
      .from("slates")
      .update(slateUpdatePayload)
      .eq("id", slateId);

    if (slateUpdateError) {
      return NextResponse.json(
        { error: `Failed to update slate: ${slateUpdateError.message}` },
        { status: 500 }
      );
    }

    const payload = teams.map((team) => ({
      slate_id: slateId,
      team_id: team.team_id,
      draft_order: team.draft_order,
      is_participating: team.is_participating,
    }));

    const { error: upsertError } = await supabaseAdmin
      .from("slate_teams")
      .upsert(payload, { onConflict: "slate_id,team_id" });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to save slate teams: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Slate updated successfully.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while updating slate." },
      { status: 500 }
    );
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  try {
    const { slateId: slateIdParam } = await context.params;
    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "Invalid slate id." },
        { status: 400 }
      );
    }

    const { data: lineups, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select("id")
      .eq("slate_id", slateId);

    if (lineupsError) {
      return NextResponse.json(
        { error: `Failed to load slate lineups: ${lineupsError.message}` },
        { status: 500 }
      );
    }

    const lineupIds = (lineups ?? []).map((row) => row.id);

    if (lineupIds.length > 0) {
      const { error: deleteLineupPlayersError } = await supabaseAdmin
        .from("lineup_players")
        .delete()
        .in("lineup_id", lineupIds);

      if (deleteLineupPlayersError) {
        return NextResponse.json(
          { error: `Failed to delete lineup players: ${deleteLineupPlayersError.message}` },
          { status: 500 }
        );
      }

      const { error: deleteLineupsError } = await supabaseAdmin
        .from("lineups")
        .delete()
        .eq("slate_id", slateId);

      if (deleteLineupsError) {
        return NextResponse.json(
          { error: `Failed to delete lineups: ${deleteLineupsError.message}` },
          { status: 500 }
        );
      }
    }

    const { error: deletePlayerStatsError } = await supabaseAdmin
      .from("player_slate_stats")
      .delete()
      .eq("slate_id", slateId);

    if (deletePlayerStatsError) {
      return NextResponse.json(
        { error: `Failed to delete player stats: ${deletePlayerStatsError.message}` },
        { status: 500 }
      );
    }

    const { error: deleteTeamResultsError } = await supabaseAdmin
      .from("team_slate_results")
      .delete()
      .eq("slate_id", slateId);

    if (deleteTeamResultsError) {
      return NextResponse.json(
        { error: `Failed to delete team results: ${deleteTeamResultsError.message}` },
        { status: 500 }
      );
    }

    const { error: deleteSlateTeamsError } = await supabaseAdmin
      .from("slate_teams")
      .delete()
      .eq("slate_id", slateId);

    if (deleteSlateTeamsError) {
      return NextResponse.json(
        { error: `Failed to delete slate teams: ${deleteSlateTeamsError.message}` },
        { status: 500 }
      );
    }

    const { error: deleteSlateError } = await supabaseAdmin
      .from("slates")
      .delete()
      .eq("id", slateId);

    if (deleteSlateError) {
      return NextResponse.json(
        { error: `Failed to delete slate: ${deleteSlateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Slate deleted successfully.",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while deleting slate." },
      { status: 500 }
    );
  }
}
