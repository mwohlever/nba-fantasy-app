import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  getCorrectionPlayerSource,
  parseCorrectionSport,
  uniqueParticipatingTeamIds,
} from "@/lib/corrections/correctionPolicy";
import { getActiveLeagueForSport } from "@/lib/groups/context";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { resolveLeagueRules } from "@/lib/rules/leagueRules";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function formatSlateLabel(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} - ${endDate}`;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const user = await getCurrentUser();
    const sport = parseCorrectionSport(request.nextUrl.searchParams.get("sport"));

    if (!user) {
      return NextResponse.json({ error: "Login required." }, { status: 401 });
    }

    if (!sport) {
      return NextResponse.json(
        { error: "Corrections are supported for NBA and NFL slates." },
        { status: 400 },
      );
    }

    const activeLeague = await getActiveLeagueForSport(user, sport);

    if (!activeLeague || !activeLeague.context.canAdministerGroup) {
      return NextResponse.json({ error: "League not found." }, { status: 404 });
    }

    const { data: slates, error: slatesError } = await supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, is_locked, sport, league_id, rules_snapshot")
      .eq("league_id", activeLeague.league.id)
      .eq("sport", sport)
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false });

    if (slatesError) {
      return NextResponse.json({ error: slatesError.message }, { status: 500 });
    }

    const requestedSlateId = Number(request.nextUrl.searchParams.get("slateId"));
    const hasRequestedSlate = Number.isInteger(requestedSlateId) && requestedSlateId > 0;
    const selectedSlate = hasRequestedSlate
      ? (slates ?? []).find((slate) => Number(slate.id) === requestedSlateId) ?? null
      : (slates ?? [])[0] ?? null;

    if (hasRequestedSlate && !selectedSlate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }

    let teams: Array<{ id: number; name: string }> = [];

    if (selectedSlate) {
      const [
        { data: slateTeams, error: slateTeamsError },
        { data: historicalLineups, error: lineupsError },
      ] = await Promise.all([
        supabaseAdmin
          .from("slate_teams")
          .select("team_id, is_participating, draft_order")
          .eq("slate_id", selectedSlate.id)
          .order("draft_order", { ascending: true }),
        supabaseAdmin
          .from("lineups")
          .select("team_id")
          .eq("slate_id", selectedSlate.id),
      ]);

      if (slateTeamsError) {
        return NextResponse.json({ error: slateTeamsError.message }, { status: 500 });
      }
      if (lineupsError) {
        return NextResponse.json({ error: lineupsError.message }, { status: 500 });
      }

      const participantIds = uniqueParticipatingTeamIds([
        ...(slateTeams ?? []),
        ...(historicalLineups ?? []).map((row) => ({
          team_id: Number(row.team_id),
          is_participating: true,
        })),
      ]);

      if (participantIds.length > 0) {
        const { data: participantTeams, error: teamsError } = await supabaseAdmin
          .from("teams")
          .select("id, name")
          .eq("group_id", activeLeague.context.group.id)
          .in("id", participantIds);

        if (teamsError) {
          return NextResponse.json({ error: teamsError.message }, { status: 500 });
        }

        const teamById = new Map(
          (participantTeams ?? []).map((team) => [Number(team.id), team]),
        );
        teams = participantIds
          .map((teamId) => teamById.get(teamId))
          .filter((team): team is { id: number; name: string } => Boolean(team));
      }
    }

    const playerSource = getCorrectionPlayerSource(sport);
    const playerColumns = sport === "nfl"
      ? "id, name, position, is_active, team_abbreviation"
      : "id, name, position_group, is_active, team_abbreviation";
    const { data: players, error: playersError } = await supabaseAdmin
      .from(playerSource.table)
      .select(playerColumns)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (playersError) {
      return NextResponse.json({ error: playersError.message }, { status: 500 });
    }

    const rules = selectedSlate
      ? resolveLeagueRules({ sport, settings: selectedSlate.rules_snapshot })
      : resolveLeagueRules({ sport, settings: activeLeague.league.settings });

    return NextResponse.json({
      success: true,
      sport,
      selectedSlateId: selectedSlate ? Number(selectedSlate.id) : null,
      scoring: rules.scoring,
      slates: (slates ?? []).map((slate) => {
        const startDate = slate.start_date ?? slate.date;
        const endDate = slate.end_date ?? slate.date;

        return {
          id: Number(slate.id),
          start_date: startDate,
          end_date: endDate,
          is_locked: Boolean(slate.is_locked),
          label: formatSlateLabel(startDate, endDate),
        };
      }),
      teams,
      players: (players ?? []).map((player) => ({
        id: Number(player.id),
        name: player.name,
        positionGroup:
          sport === "nfl"
            ? (player as { position?: string | null }).position ?? null
            : (player as { position_group?: string | null }).position_group ?? null,
        isActive: Boolean(player.is_active),
        teamAbbreviation: player.team_abbreviation ?? null,
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading correction data." },
      { status: 500 },
    );
  }
}
