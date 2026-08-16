import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";

function normalizeNbaTeamCode(value: string | null | undefined) {
  const code = String(value ?? "").trim().toUpperCase();
  if (code === "NY") return "NYK";
  return code;
}



type SlateTeamUpdate = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

type UpdateSlateBody = {
  is_locked?: boolean;
  teams?: SlateTeamUpdate[];
  nba_team_abbreviations?: string[];
  cut_penalty_per_round?: number;
  has_cut?: boolean;
  tournament_analysis?: string;
  show_tournament_analysis?: boolean;
};

type RouteContext = {
  params: Promise<{
    slateId: string;
  }>;
};

export async function GET(_: NextRequest, context: RouteContext) {
  const authError = await requireAdminApi();
  if (authError) return authError;

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
      {
        data: golfFieldRows,
        error: golfFieldError,
        count: golfFieldCount,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("slates")
        .select(
          "id, date, start_date, end_date, is_locked, sport, display_name, external_event_id, cut_penalty_per_round, has_cut, tournament_analysis, show_tournament_analysis, nba_team_abbreviations"
        )
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
      supabaseAdmin
        .from("golf_event_players")
        .select("updated_at", {
          count: "exact",
        })
        .eq("slate_id", slateId)
        .order("updated_at", {
          ascending: false,
        })
        .limit(1),
    ]);

    if (slateError || !slate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    if (teamsError || slateTeamsError || golfFieldError) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            slateTeamsError?.message ||
            golfFieldError?.message ||
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
      .sort((a, b) => {
        if (a.is_participating !== b.is_participating) {
          return a.is_participating ? -1 : 1;
        }

        if (a.draft_order !== b.draft_order) {
          return a.draft_order - b.draft_order;
        }

        return a.team_name.localeCompare(b.team_name);
      })
      .map((team, index) => ({
        ...team,
        draft_order: index + 1,
      }));

    return NextResponse.json({
      success: true,
      slate: {
        ...slate,
        label:
          slate.display_name?.trim() ||
          (
            slate.start_date &&
            slate.end_date &&
            slate.start_date !== slate.end_date
              ? `${slate.start_date} - ${slate.end_date}`
              : slate.start_date ?? slate.date
          ),
      },
      teams: mergedTeams,
      golfField:
        slate.sport === "golf"
          ? {
              golferCount: golfFieldCount ?? 0,
              lastRefreshedAt:
                golfFieldRows?.[0]?.updated_at ?? null,
            }
          : null,
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
  const authError = await requireAdminApi();
  if (authError) return authError;

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
    const rawCutPenalty = Number(body.cut_penalty_per_round);
    const hasCut = body.has_cut;

    const tournamentAnalysis =
      typeof body.tournament_analysis === "string"
        ? body.tournament_analysis.trim()
        : "";

    const showTournamentAnalysis =
      body.show_tournament_analysis;

    const nbaTeamAbbreviations = (body.nba_team_abbreviations ?? [])
      .map((value) => normalizeNbaTeamCode(value))
      .filter(Boolean);

    if (!Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        { error: "At least one team config is required." },
        { status: 400 }
      );
    }

    if (tournamentAnalysis.length > 4000) {
      return NextResponse.json(
        {
          error:
            "Tournament Analysis must be 4,000 characters or fewer.",
        },
        { status: 400 },
      );
    }

    const normalizedTeams = [...teams]
      .sort((a, b) => {
        if (a.is_participating !== b.is_participating) {
          return a.is_participating ? -1 : 1;
        }

        return a.draft_order - b.draft_order;
      })
      .map((team, index) => ({
        ...team,
        draft_order: index + 1,
      }));

    const { data: existingSlate, error: existingSlateError } = await supabaseAdmin
      .from("slates")
      .select("id, sport")
      .eq("id", slateId)
      .single();

    if (existingSlateError || !existingSlate) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    if (
      existingSlate.sport === "golf" &&
      (
        !Number.isInteger(rawCutPenalty) ||
        rawCutPenalty < 0 ||
        rawCutPenalty > 100
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Cut penalty must be a whole number from 0 through 100.",
        },
        { status: 400 }
      );
    }

    const slateUpdatePayload: {
      is_locked?: boolean;
      nba_team_abbreviations?: string[];
      cut_penalty_per_round?: number;
      has_cut?: boolean;
      tournament_analysis?: string | null;
      show_tournament_analysis?: boolean;
    } = {
      nba_team_abbreviations: nbaTeamAbbreviations,
    };

    if (existingSlate.sport === "golf") {
      slateUpdatePayload.cut_penalty_per_round =
        rawCutPenalty;

      if (typeof hasCut === "boolean") {
        slateUpdatePayload.has_cut = hasCut;
      }

      slateUpdatePayload.tournament_analysis =
        tournamentAnalysis || null;

      if (
        typeof showTournamentAnalysis ===
        "boolean"
      ) {
        slateUpdatePayload.show_tournament_analysis =
          showTournamentAnalysis;
      }
    }

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

    const payload = normalizedTeams.map((team) => ({
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
  const authError = await requireAdminApi();
  if (authError) return authError;

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