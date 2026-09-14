import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SubmittedPick = { gameId: number; pickedTeamId: string };

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function submittedPicks(value: unknown): SubmittedPick[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({ gameId: positiveInteger(entry?.gameId) ?? 0, pickedTeamId: String(entry?.pickedTeamId ?? "").trim() }))
    .filter((pick) => pick.gameId > 0 && pick.pickedTeamId.length > 0);
}

async function commissionerAccess() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Login required." }, { status: 401 }) };
  const access = await getNcaaPickEmAccess(user);
  if (!access) return { error: NextResponse.json({ error: "NCAA Pick 'Em is not enabled for this Group." }, { status: 404 }) };
  if (!access.context.canAdministerGroup) return { error: NextResponse.json({ error: "Group admin access required." }, { status: 403 }) };
  return { access };
}

async function loadScopedCard(leagueId: string, weekId: number) {
  const { data: week, error: weekError } = await supabaseAdmin.from("ncaa_pickem_weeks")
    .select("id, season, week_number, label, lock_at, status, league_id")
    .eq("id", weekId).eq("league_id", leagueId).maybeSingle();
  if (weekError) throw new Error(weekError.message);
  if (!week) return null;

  const { data: games, error: gamesError } = await supabaseAdmin.from("ncaa_pickem_games")
    .select("id, kickoff_at, away_team_id, away_team_name, away_team_abbreviation, away_team_logo_url, home_team_id, home_team_name, home_team_abbreviation, home_team_logo_url, status, status_detail, winner_team_id, included")
    .eq("week_id", weekId).eq("included", true).order("kickoff_at", { ascending: true });
  if (gamesError) throw new Error(gamesError.message);
  return { week, games: games ?? [] };
}

export async function GET(request: NextRequest) {
  try {
    const authorized = await commissionerAccess();
    if ("error" in authorized) return authorized.error;
    const weekId = positiveInteger(new URL(request.url).searchParams.get("weekId"));
    const teamId = positiveInteger(new URL(request.url).searchParams.get("teamId"));
    if (!weekId) return NextResponse.json({ error: "Valid weekId is required." }, { status: 400 });
    const card = await loadScopedCard(authorized.access.league.id, weekId);
    if (!card) return NextResponse.json({ error: "Pick 'Em week not found." }, { status: 404 });
    const participant = teamId ? authorized.access.participants.find((candidate) => candidate.teamId === teamId) : null;
    if (!teamId) return NextResponse.json({ success: true, participants: authorized.access.participants });
    if (!participant) return NextResponse.json({ error: "Participant does not belong to this Group." }, { status: 404 });
    const { data: picks, error } = await supabaseAdmin.from("ncaa_pickem_picks")
      .select("id, week_id, game_id, team_id, picked_team_id, is_correct, updated_at")
      .eq("week_id", weekId).eq("team_id", teamId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, participant, ...card, picks: picks ?? [] });
  } catch (error) {
    console.error("Failed to load NCAA Pick 'Em correction card", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Pick 'Em correction card." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorized = await commissionerAccess();
    if ("error" in authorized) return authorized.error;
    const body = await request.json();
    const weekId = positiveInteger(body?.weekId);
    const teamId = positiveInteger(body?.teamId);
    const picks = submittedPicks(body?.picks);
    if (!weekId || !teamId) return NextResponse.json({ error: "Valid weekId and teamId are required." }, { status: 400 });
    if (!picks.length) return NextResponse.json({ error: "At least one valid pick is required." }, { status: 400 });
    if (new Set(picks.map((pick) => pick.gameId)).size !== picks.length) return NextResponse.json({ error: "Each game may only be corrected once per save." }, { status: 400 });
    if (!authorized.access.participants.some((participant) => participant.teamId === teamId)) {
      return NextResponse.json({ error: "Participant does not belong to this Group." }, { status: 404 });
    }
    const card = await loadScopedCard(authorized.access.league.id, weekId);
    if (!card) return NextResponse.json({ error: "Pick 'Em week not found." }, { status: 404 });
    const gamesById = new Map(card.games.map((game) => [Number(game.id), game]));
    for (const pick of picks) {
      const game = gamesById.get(pick.gameId);
      if (!game) return NextResponse.json({ error: "One of the submitted games is not part of this week's card." }, { status: 400 });
      if (pick.pickedTeamId !== String(game.away_team_id) && pick.pickedTeamId !== String(game.home_team_id)) {
        return NextResponse.json({ error: "One of the submitted picks does not belong to that matchup." }, { status: 400 });
      }
    }
    const now = new Date().toISOString();
    const rows = picks.map((pick) => {
      const game = gamesById.get(pick.gameId)!;
      return {
        week_id: weekId, game_id: pick.gameId, team_id: teamId, picked_team_id: pick.pickedTeamId,
        // Persisted winner data is the same authoritative data used by the refresh process.
        is_correct: game.winner_team_id ? pick.pickedTeamId === String(game.winner_team_id) : null,
        updated_at: now,
      };
    });
    const { error: saveError } = await supabaseAdmin.from("ncaa_pickem_picks").upsert(rows, { onConflict: "game_id,team_id" });
    if (saveError) throw new Error(saveError.message);
    return NextResponse.json({ success: true, saved: rows.length, graded: rows.filter((row) => row.is_correct !== null).length, correction: true });
  } catch (error) {
    console.error("Failed to save NCAA Pick 'Em correction", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save Pick 'Em correction." }, { status: 500 });
  }
}
