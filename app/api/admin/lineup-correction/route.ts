import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { recomputeCorrectedSlateResults } from "@/lib/corrections/recomputeSlateResults";
import { isMissingDraftInfrastructure, mutateFantasyDraft } from "@/lib/lineups/draftHistory.server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const slateId = Number(body.slateId);
    const teamId = Number(body.teamId);
    const action = String(body.action ?? "");
    const oldPlayerId = body.oldPlayerId ? Number(body.oldPlayerId) : null;
    const newPlayerId = body.newPlayerId ? Number(body.newPlayerId) : null;

    if (!Number.isSafeInteger(slateId) || slateId <= 0 || !Number.isSafeInteger(teamId) || teamId <= 0) {
      return NextResponse.json(
        { error: "Valid slateId and teamId are required." },
        { status: 400 }
      );
    }

    const authorization = await authorizeSlateResource(
      request,
      slateId,
      { requireCommissioner: true },
    );

    if (!authorization.ok) return authorization.response;

    const sport = authorization.target.sportKey;
    if (sport !== "nba" && sport !== "nfl") {
      return NextResponse.json(
        { error: "Lineup corrections are supported for NBA and NFL slates." },
        { status: 400 }
      );
    }

    const { data: lineup, error: lineupError } = await supabaseAdmin
      .from("lineups")
      .select("id,lineup_players(player_id)")
      .eq("slate_id", slateId)
      .eq("team_id", teamId)
      .maybeSingle();

    if (lineupError) {
      return NextResponse.json({ error: lineupError.message }, { status: 500 });
    }

    if (!lineup) {
      return NextResponse.json({ error: "Lineup not found." }, { status: 404 });
    }

    if (newPlayerId) {
      const { data: newPlayer, error: playerError } = await supabaseAdmin
        .from(sport === "nfl" ? "players_nfl" : "players")
        .select("id")
        .eq("id", newPlayerId)
        .maybeSingle();

      if (playerError) {
        return NextResponse.json({ error: playerError.message }, { status: 500 });
      }

      if (!newPlayer) {
        return NextResponse.json(
          { error: "Player not found for this sport." },
          { status: 404 }
        );
      }
    }

    if (!["add", "remove", "replace"].includes(action) ||
      ((action === "remove" || action === "replace") && (!oldPlayerId || !Number.isSafeInteger(oldPlayerId))) ||
      ((action === "add" || action === "replace") && (!newPlayerId || !Number.isSafeInteger(newPlayerId)))) {
      return NextResponse.json({ error: "Valid action and player IDs are required." }, { status: 400 });
    }
    const expectedIds = (lineup.lineup_players ?? []).map(row => Number(row.player_id));
    if ((action !== "add" && !expectedIds.includes(oldPlayerId!)) || (action !== "remove" && expectedIds.includes(newPlayerId!))) {
      return NextResponse.json({ error: "Roster changed or player is already assigned. Refresh corrections." }, { status: 409 });
    }
    const desiredIds = expectedIds.filter(id => action === "add" || id !== oldPlayerId);
    if (action !== "remove") desiredIds.push(newPlayerId!);
    let result;
    try {
      result = await mutateFantasyDraft({ slateId, teamId, sport, groupId: authorization.target.groupId,
        leagueId: authorization.target.leagueId, actorId: authorization.user!.id, expectedIds, desiredIds, correction: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Correction could not be saved." }, { status: 409 });
    }
    if (result.error) return NextResponse.json({ error: isMissingDraftInfrastructure(result.error)
      ? "Draft history setup is pending. Apply the reviewed migration before correcting rosters."
      : result.error.message }, { status: isMissingDraftInfrastructure(result.error) ? 503 : 409 });

    /* All roster changes and the audit record have committed atomically. */
    await recomputeCorrectedSlateResults(slateId, sport);
    return NextResponse.json({ success: true, slateId, teamId, action, oldPlayerId, newPlayerId });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while correcting lineup." },
      { status: 500 }
    );
  }
}
