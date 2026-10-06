import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authorizeSlateResource, loadActiveGroupTeamIds } from "@/lib/security/resourceAuthorization";
import { hasStaleSlateTeams, loadSlateParticipantState, staleParticipantNotice } from "@/lib/slates/participantConfiguration.server";
import { buildSuggestedOrderIds } from "@/lib/slates/participantOrder";
import { validateSlateTeamConfigurations } from "@/lib/security/resourcePolicy";

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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { slateId: slateIdParam } = await context.params;
    const slateId = Number(slateIdParam);

    if (!Number.isFinite(slateId)) {
      return NextResponse.json(
        { error: "Invalid slate id." },
        { status: 400 }
      );
    }

    const authorization = await authorizeSlateResource(
      request,
      slateId,
      { requireCommissioner: true },
    );

    if (!authorization.ok) return authorization.response;

    const { data: currentSlate, error: currentSlateError } = await supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, sport, league_id, is_locked, archived_at")
      .eq("id", slateId)
      .single();

    if (currentSlateError || !currentSlate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    if (currentSlate.league_id !== authorization.target.leagueId ||
        currentSlate.sport !== authorization.target.sportKey) {
      return NextResponse.json({ error: "Cannot reseed this slate." }, { status: 400 });
    }
    const participantState = await loadSlateParticipantState(currentSlate);
    if (!participantState.editable) {
      return NextResponse.json({ error: participantState.notice }, { status: 409 });
    }
    const activeIds = await loadActiveGroupTeamIds(authorization.target.groupId);
    const activeTeamIds = new Set(activeIds);
    const previousQuery = supabaseAdmin.from("slates")
      .select("id, start_date, end_date, is_locked")
      .lt("start_date", currentSlate.start_date)
      .eq("is_locked", true)
      .eq("league_id", authorization.target.leagueId)
      .eq("sport", currentSlate.sport);
    const teamsQuery = supabaseAdmin.from("teams").select("id, name")
      .eq("group_id", authorization.target.groupId);

    const [
      { data: previousSlates, error: previousSlatesError },
      { data: slateTeams, error: slateTeamsError },
      { data: teams, error: teamsError },
    ] = await Promise.all([
      previousQuery.order("start_date", { ascending: false }).limit(1),
      supabaseAdmin
        .from("slate_teams")
        .select("slate_id, team_id, draft_order, is_participating")
        .eq("slate_id", slateId),
      teamsQuery.order("name", { ascending: true }),
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
    if (hasStaleSlateTeams(safeSlateTeams, activeIds)) {
      return NextResponse.json({ error: staleParticipantNotice }, { status: 409 });
    }

    const configMap = new Map(
      safeSlateTeams.map((row) => [row.team_id, row])
    );

    const eligibleTeams = (teams ?? []).filter((team) => activeTeamIds.has(team.id));
    const suggestedIds = buildSuggestedOrderIds(safePreviousResults, eligibleTeams);
    const merged = suggestedIds.map((teamId, index) => {
      const config = configMap.get(teamId);
      return {
        team_id: teamId,
        draft_order: index + 1,
        is_participating: config?.is_participating ?? true,
      };
    });

    const participating = merged
      .filter((row) => row.is_participating)
      .sort((a, b) => a.draft_order - b.draft_order);

    const nonParticipating = merged
      .filter((row) => !row.is_participating)
      .sort((a, b) => a.draft_order - b.draft_order);

    const reseeded = [...participating, ...nonParticipating].map((row, index) => ({
      slate_id: slateId,
      team_id: row.team_id,
      draft_order: index + 1,
      is_participating: row.is_participating,
    }));
    const validation = validateSlateTeamConfigurations(reseeded, activeIds);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

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
