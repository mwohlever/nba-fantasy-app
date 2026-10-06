import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  authorizeSlateResource,
  loadActiveGroupTeamIds,
} from "@/lib/security/resourceAuthorization";
import { validateSlateTeamConfigurations } from "@/lib/security/resourcePolicy";
import { inspectSlateDiscard, slateDiscardArguments } from "@/lib/slates/discard.server";
import {
  hasStaleSlateTeams,
  loadSlateParticipantState,
  staleParticipantNotice,
} from "@/lib/slates/participantConfiguration.server";

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
  archived?: boolean;
  archiveOnly?: boolean;
};

type RouteContext = {
  params: Promise<{
    slateId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
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
          "id, date, start_date, end_date, is_locked, sport, rules_version, rules_snapshot, display_name, external_event_id, cut_penalty_per_round, has_cut, tournament_analysis, show_tournament_analysis, nba_team_abbreviations, archived_at"
        )
        .eq("id", slateId)
        .single(),
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .eq(
          "group_id",
          authorization.target.groupId,
        )
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
    const participantState = await loadSlateParticipantState(slate);
    const discard = await inspectSlateDiscard(authorization);
    const activeTeamIds = participantState.editable
      ? await loadActiveGroupTeamIds(authorization.target.groupId)
      : [];
    const active = new Set(activeTeamIds);
    const hasStaleTeams = participantState.editable && hasStaleSlateTeams(safeSlateTeams, activeTeamIds);

    const configMap = new Map(
      safeSlateTeams.map((row) => [row.team_id, row])
    );

    const mergedTeams = safeTeams
      .filter((team) => participantState.editable ? active.has(team.id) : configMap.has(team.id))
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
        draft_order: participantState.editable ? index + 1 : team.draft_order,
      }));

    return NextResponse.json({
      success: true,
      slate: {
        ...slate,
        discard,
        participants_editable: participantState.editable && !hasStaleTeams,
        participant_notice: hasStaleTeams ? staleParticipantNotice : participantState.notice,
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

    const authorization = await authorizeSlateResource(
      request,
      slateId,
      { requireCommissioner: true },
    );

    if (!authorization.ok) return authorization.response;

    if (body.archiveOnly === true) {
      if (typeof body.archived !== "boolean") {
        return NextResponse.json(
          { error: "Archive state is required." },
          { status: 400 },
        );
      }

      const { error } = await supabaseAdmin
        .from("slates")
        .update({
          archived_at: body.archived
            ? new Date().toISOString()
            : null,
        })
        .eq("id", slateId);

      if (error) {
        return NextResponse.json(
          { error: `Failed to update slate archive state: ${error.message}` },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: body.archived
          ? "Slate archived successfully."
          : "Slate restored successfully.",
      });
    }

    const hasTeamUpdates = body.teams !== undefined;
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

    if (hasTeamUpdates && (!Array.isArray(teams) || teams.length === 0)) {
      return NextResponse.json(
        { error: "At least one team config is required." },
        { status: 400 }
      );
    }

    if (tournamentAnalysis.length > 4000) {
      return NextResponse.json(
        {
          error:
            "MW Analysis must be 4,000 characters or fewer.",
        },
        { status: 400 },
      );
    }

    const { data: existingSlate, error: existingSlateError } = await supabaseAdmin
      .from("slates")
      .select("id, sport, is_locked, archived_at, date, end_date")
      .eq("id", slateId)
      .single();

    if (existingSlateError || !existingSlate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }
    const participantState = await loadSlateParticipantState(existingSlate);
    if (hasTeamUpdates && !participantState.editable) {
      return NextResponse.json({ error: participantState.notice }, { status: 409 });
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

    if (hasTeamUpdates) {
      const activeTeamIds = await loadActiveGroupTeamIds(
        authorization.target.groupId,
      );
      const teamValidation = validateSlateTeamConfigurations(
        normalizedTeams.map((team) => ({
          team_id: Number(team.team_id),
          draft_order: Number(team.draft_order),
          is_participating: Boolean(team.is_participating),
        })),
        activeTeamIds,
      );

      if (!teamValidation.ok) {
        return NextResponse.json(
          { error: teamValidation.error },
          { status: 400 },
        );
      }

      const { data: storedTeams, error: storedTeamsError } = await supabaseAdmin
        .from("slate_teams").select("team_id").eq("slate_id", slateId);
      if (storedTeamsError) throw new Error(storedTeamsError.message);
      // Safely deleting obsolete rows requires dependency checks in a transaction.
      // Do not leave a stale participating row behind while reporting a successful save.
      if (hasStaleSlateTeams(storedTeams ?? [], activeTeamIds)) {
        return NextResponse.json({ error: staleParticipantNotice }, { status: 409 });
      }
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
      archived_at?: string | null;
    } = {
      nba_team_abbreviations: nbaTeamAbbreviations,
    };

    if (existingSlate.sport === "golf") {
      slateUpdatePayload.cut_penalty_per_round =
        rawCutPenalty;

      if (typeof hasCut === "boolean") {
        slateUpdatePayload.has_cut = hasCut;
      }
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

    if (typeof isLocked === "boolean") {
      slateUpdatePayload.is_locked = isLocked;
    }
    if (typeof body.archived === "boolean") {
      slateUpdatePayload.archived_at = body.archived
        ? new Date().toISOString()
        : null;
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

    if (hasTeamUpdates) {
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

/** Permanently discard an eligible abandoned NFL attempt; never ordinary history deletion. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { slateId: slateIdParam } = await context.params;
    const slateId = Number(slateIdParam);
    if (!Number.isSafeInteger(slateId) || slateId <= 0) {
      return NextResponse.json({ error: "Invalid slate id." }, { status: 400 });
    }
    const authorization = await authorizeSlateResource(
      request, slateId, { requireCommissioner: true },
    );
    if (!authorization.ok) return authorization.response;
    // Confirmation is explicit and slate-specific. Ownership, actor and all
    // lifecycle/scoring facts come from authorization and the database.
    const body = await request.json().catch(() => null);
    if (body?.action !== "discard" || body?.confirmedSlateId !== slateId) {
      return NextResponse.json({ error: "Explicit slate discard confirmation is required." }, { status: 400 });
    }
    if (authorization.target.sportKey !== "nfl") {
      return NextResponse.json({ error: "Discard is available only for pre-game NFL slates.", code: "unsupported_sport" }, { status: 409 });
    }
    const { data, error } = await supabaseAdmin.rpc(
      "discard_abandoned_nfl_slate", slateDiscardArguments(authorization),
    );
    if (error || !data || typeof data.success !== "boolean") {
      return NextResponse.json({ error: "Slate discard is unavailable. No discard was confirmed; reload Slate Admin before retrying.", code: "unavailable" }, { status: 503 });
    }
    if (!data.success) {
      const status = data.code === "not_found" ? 404 : data.code === "dependency_failure" ? 500 : 409;
      return NextResponse.json({ error: data.reason, code: data.code }, { status });
    }
    return NextResponse.json({ success: true, slateId, notificationsDetached: data.notificationsDetached,
      message: "Slate discarded. You can now recreate this NFL week." });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unexpected server error while discarding slate. Reload Slate Admin before retrying." }, { status: 500 });
  }
}
