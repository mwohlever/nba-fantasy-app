import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TeamRow = {
  id: number;
  name: string;
};

type SlateRow = {
  id: number;
  start_date: string;
  end_date: string;
  date: string;
};

type TeamSlateResultRow = {
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
};

type TeamConfigInput = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

function normalizeTeamConfigs(
  rawConfigs: TeamConfigInput[],
  allTeams: TeamRow[],
  suggestedOrderIds: number[]
) {
  const rawMap = new Map<number, TeamConfigInput>();
  rawConfigs.forEach((config) => {
    rawMap.set(Number(config.team_id), {
      team_id: Number(config.team_id),
      draft_order: Number(config.draft_order),
      is_participating: Boolean(config.is_participating),
    });
  });

  const allTeamIds = allTeams.map((team) => team.id);

  const participating = allTeamIds.filter(
    (teamId) => rawMap.get(teamId)?.is_participating ?? true
  );
  const notParticipating = allTeamIds.filter(
    (teamId) => !(rawMap.get(teamId)?.is_participating ?? true)
  );

  const suggestedRank = new Map<number, number>();
  suggestedOrderIds.forEach((teamId, index) => {
    suggestedRank.set(teamId, index);
  });

  const sortBySuggestedOrder = (a: number, b: number) => {
    const aRank = suggestedRank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bRank = suggestedRank.get(b) ?? Number.MAX_SAFE_INTEGER;

    if (aRank !== bRank) return aRank - bRank;

    const aName = allTeams.find((team) => team.id === a)?.name ?? "";
    const bName = allTeams.find((team) => team.id === b)?.name ?? "";
    return aName.localeCompare(bName);
  };

  participating.sort(sortBySuggestedOrder);
  notParticipating.sort(sortBySuggestedOrder);

  const finalOrder = [...participating, ...notParticipating];

  return finalOrder.map((teamId, index) => ({
    team_id: teamId,
    draft_order: index + 1,
    is_participating: participating.includes(teamId),
  }));
}

export async function GET() {
  try {
    const [{ data: teams, error: teamsError }, { data: latestSlate, error: latestSlateError }] =
      await Promise.all([
        supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
        supabaseAdmin
          .from("slates")
          .select("id, start_date, end_date, date")
          .order("start_date", { ascending: false })
          .order("end_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (teamsError) {
      return NextResponse.json(
        { error: `Failed to load teams: ${teamsError.message}` },
        { status: 500 }
      );
    }

    if (latestSlateError) {
      return NextResponse.json(
        { error: `Failed to load latest slate: ${latestSlateError.message}` },
        { status: 500 }
      );
    }

    const safeTeams = (teams ?? []) as TeamRow[];

    let latestSlateResults: TeamSlateResultRow[] = [];

    if (latestSlate?.id) {
      const { data: results, error: resultsError } = await supabaseAdmin
        .from("team_slate_results")
        .select("team_id, fantasy_points, finish_position")
        .eq("slate_id", latestSlate.id);

      if (resultsError) {
        return NextResponse.json(
          { error: `Failed to load latest slate results: ${resultsError.message}` },
          { status: 500 }
        );
      }

      latestSlateResults = (results ?? []) as TeamSlateResultRow[];
    }

    const rankedLatestTeams = [...latestSlateResults].sort((a, b) => {
      const aFinish = a.finish_position ?? Number.MAX_SAFE_INTEGER;
      const bFinish = b.finish_position ?? Number.MAX_SAFE_INTEGER;

      if (aFinish !== bFinish) return aFinish - bFinish;

      const aScore = a.fantasy_points ?? 0;
      const bScore = b.fantasy_points ?? 0;
      return bScore - aScore;
    });

    const inverseOrderIds = rankedLatestTeams.map((row) => row.team_id).reverse();

    const teamsMissingFromLatestSlate = safeTeams
      .filter((team) => !inverseOrderIds.includes(team.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => team.id);

    const suggestedOrderIds = [...inverseOrderIds, ...teamsMissingFromLatestSlate];

    const suggestedTeamConfigs = normalizeTeamConfigs(
      safeTeams.map((team) => ({
        team_id: team.id,
        draft_order: 0,
        is_participating: true,
      })),
      safeTeams,
      suggestedOrderIds
    );

    return NextResponse.json({
      success: true,
      teams: safeTeams,
      latestSlate: latestSlate ?? null,
      suggestedTeamConfigs,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading slate setup." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const startDate = body?.startDate;
    const endDate = body?.endDate;
    const teamConfigs = Array.isArray(body?.teamConfigs) ? body.teamConfigs : [];

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "Start date and end date are required." },
        { status: 400 }
      );
    }

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (teamsError || !teams) {
      return NextResponse.json(
        { error: `Failed to load teams: ${teamsError?.message}` },
        { status: 500 }
      );
    }

    const safeTeams = teams as TeamRow[];

    const latestSlateQuery = await supabaseAdmin
      .from("slates")
      .select("id, start_date, end_date, date")
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestSlateQuery.error) {
      return NextResponse.json(
        { error: `Failed to load latest slate: ${latestSlateQuery.error.message}` },
        { status: 500 }
      );
    }

    let latestSlateResults: TeamSlateResultRow[] = [];

    if (latestSlateQuery.data?.id) {
      const { data: results, error: resultsError } = await supabaseAdmin
        .from("team_slate_results")
        .select("team_id, fantasy_points, finish_position")
        .eq("slate_id", latestSlateQuery.data.id);

      if (resultsError) {
        return NextResponse.json(
          { error: `Failed to load latest slate results: ${resultsError.message}` },
          { status: 500 }
        );
      }

      latestSlateResults = (results ?? []) as TeamSlateResultRow[];
    }

    const rankedLatestTeams = [...latestSlateResults].sort((a, b) => {
      const aFinish = a.finish_position ?? Number.MAX_SAFE_INTEGER;
      const bFinish = b.finish_position ?? Number.MAX_SAFE_INTEGER;

      if (aFinish !== bFinish) return aFinish - bFinish;

      const aScore = a.fantasy_points ?? 0;
      const bScore = b.fantasy_points ?? 0;
      return bScore - aScore;
    });

    const inverseOrderIds = rankedLatestTeams.map((row) => row.team_id).reverse();

    const teamsMissingFromLatestSlate = safeTeams
      .filter((team) => !inverseOrderIds.includes(team.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => team.id);

    const suggestedOrderIds = [...inverseOrderIds, ...teamsMissingFromLatestSlate];

    const normalizedTeamConfigs = normalizeTeamConfigs(
      teamConfigs.length > 0
        ? (teamConfigs as TeamConfigInput[]).map((config) => ({
            team_id: Number(config.team_id),
            draft_order: Number(config.draft_order),
            is_participating: Boolean(config.is_participating),
          }))
        : safeTeams.map((team) => ({
            team_id: team.id,
            draft_order: 0,
            is_participating: true,
          })),
      safeTeams,
      suggestedOrderIds
    );

    const { data: newSlate, error: insertSlateError } = await supabaseAdmin
      .from("slates")
      .insert({
        date: startDate,
        start_date: startDate,
        end_date: endDate,
        is_locked: false,
      })
      .select("id, date, start_date, end_date, is_locked")
      .single();

    if (insertSlateError || !newSlate) {
      return NextResponse.json(
        { error: insertSlateError?.message || "Failed to create slate." },
        { status: 500 }
      );
    }

    const slateTeamRows = normalizedTeamConfigs.map((config) => ({
      slate_id: newSlate.id,
      team_id: config.team_id,
      draft_order: config.draft_order,
      is_participating: config.is_participating,
    }));

    const { error: insertSlateTeamsError } = await supabaseAdmin
      .from("slate_teams")
      .insert(slateTeamRows);

    if (insertSlateTeamsError) {
      await supabaseAdmin.from("slates").delete().eq("id", newSlate.id);

      return NextResponse.json(
        { error: `Failed to create slate team order: ${insertSlateTeamsError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      slate: newSlate,
      slateTeams: slateTeamRows,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while creating slate." },
      { status: 500 }
    );
  }
}
