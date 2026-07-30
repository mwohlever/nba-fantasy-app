import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchGolfTournamentByEventId,
  type GolfCompetitor,
  type GolfTournament,
} from "@/lib/providers/golf";

type RefreshBody = {
  slateId?: number | string;
};

type GolfSlateRecord = {
  id: number;
  sport: string;
  display_name: string | null;
  external_event_id: string | null;
  start_date: string;
  end_date: string;
  is_locked: boolean;
};

type GolfPlayerIdRow = {
  id: number;
  espn_player_id: string;
};

function parseSlateId(value: unknown): number | null {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getTournamentYear(startDate: string): string | null {
  const year = startDate.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function deduplicateCompetitors(
  competitors: GolfCompetitor[]
): GolfCompetitor[] {
  return Array.from(
    new Map(
      competitors.map((competitor) => [
        competitor.espnPlayerId,
        competitor,
      ])
    ).values()
  );
}

async function fetchTournamentForSlate(
  slate: GolfSlateRecord
): Promise<GolfTournament | null> {
  const eventId = slate.external_event_id?.trim();

  if (!eventId) {
    return null;
  }

  const tournamentYear = getTournamentYear(slate.start_date);

  if (tournamentYear) {
    const tournament = await fetchGolfTournamentByEventId(
      eventId,
      tournamentYear
    );

    if (tournament) {
      return tournament;
    }
  }

  // Fallback to ESPN's current scoreboard in case the year-filtered
  // response does not contain the requested tournament.
  return fetchGolfTournamentByEventId(eventId);
}

export async function POST(request: Request) {
  try {
    let body: RefreshBody;

    try {
      body = (await request.json()) as RefreshBody;
    } catch {
      return NextResponse.json(
        { error: "A valid JSON request body is required." },
        { status: 400 }
      );
    }

    const slateId = parseSlateId(body.slateId);

    if (!slateId) {
      return NextResponse.json(
        { error: "A valid slateId is required." },
        { status: 400 }
      );
    }

    const { data: slateData, error: slateError } = await supabaseAdmin
      .from("slates")
      .select(
        "id, sport, display_name, external_event_id, start_date, end_date, is_locked"
      )
      .eq("id", slateId)
      .single();

    if (slateError || !slateData) {
      return NextResponse.json(
        { error: "Slate not found." },
        { status: 404 }
      );
    }

    const slate = slateData as GolfSlateRecord;

    if (slate.sport !== "golf") {
      return NextResponse.json(
        { error: "This slate is not a Golf slate." },
        { status: 400 }
      );
    }

    if (slate.is_locked) {
      return NextResponse.json(
        { error: "This slate is locked and cannot be refreshed." },
        { status: 400 }
      );
    }

    if (!slate.external_event_id?.trim()) {
      return NextResponse.json(
        {
          error:
            "This Golf slate does not have an ESPN external event ID.",
        },
        { status: 400 }
      );
    }

    const tournament = await fetchTournamentForSlate(slate);

    if (!tournament) {
      return NextResponse.json(
        {
          error: `ESPN tournament ${slate.external_event_id} was not found.`,
        },
        { status: 404 }
      );
    }

    const competitors = deduplicateCompetitors(
      tournament.competitors
    );

    if (competitors.length === 0) {
      return NextResponse.json(
        {
          error:
            "ESPN returned the tournament, but the tournament field is not available yet.",
          tournament: {
            eventId: tournament.espnEventId,
            name: tournament.name,
            status: tournament.status,
          },
        },
        { status: 502 }
      );
    }

    const refreshedAt = new Date().toISOString();

    const golfPlayerRows = competitors.map((competitor) => ({
      espn_player_id: competitor.espnPlayerId,
      display_name: competitor.displayName,
      short_name: competitor.shortName,
      country: competitor.country,
      country_flag_url: competitor.countryFlagUrl,
      player_url: competitor.playerUrl,
      is_active: true,
      updated_at: refreshedAt,
    }));

    const { data: savedPlayersData, error: playersUpsertError } =
      await supabaseAdmin
        .from("golf_players")
        .upsert(golfPlayerRows, {
          onConflict: "espn_player_id",
        })
        .select("id, espn_player_id");

    if (playersUpsertError) {
      return NextResponse.json(
        {
          error: `Failed to save Golf players: ${playersUpsertError.message}`,
        },
        { status: 500 }
      );
    }

    const savedPlayers =
      (savedPlayersData ?? []) as GolfPlayerIdRow[];

    const playerIdByEspnId = new Map(
      savedPlayers.map((player) => [
        player.espn_player_id,
        Number(player.id),
      ])
    );

    const unresolvedCompetitors = competitors.filter(
      (competitor) =>
        !playerIdByEspnId.has(competitor.espnPlayerId)
    );

    if (unresolvedCompetitors.length > 0) {
      return NextResponse.json(
        {
          error:
            "Golf players were saved, but one or more database player IDs could not be resolved.",
          unresolvedPlayers: unresolvedCompetitors.map(
            (competitor) => ({
              espnPlayerId: competitor.espnPlayerId,
              displayName: competitor.displayName,
            })
          ),
        },
        { status: 500 }
      );
    }

    const eventPlayerRows = competitors.map((competitor) => ({
      slate_id: slateId,
      player_id: playerIdByEspnId.get(
        competitor.espnPlayerId
      )!,
      leaderboard_order: competitor.leaderboardOrder,
      official_score_to_par:
        competitor.officialScoreToPar,
      official_score_display:
        competitor.officialScoreDisplay,
      rounds_completed: competitor.roundsCompleted,
      holes_completed: competitor.holesCompleted,
      current_round: competitor.currentRound,
      last_hole: competitor.lastHole,
      status: competitor.status,
      tee_time: competitor.teeTime,
      tee_time_raw: competitor.teeTimeRaw,
      updated_at: refreshedAt,
    }));

    const { error: eventPlayersUpsertError } =
      await supabaseAdmin
        .from("golf_event_players")
        .upsert(eventPlayerRows, {
          onConflict: "slate_id,player_id",
        });

    if (eventPlayersUpsertError) {
      return NextResponse.json(
        {
          error: `Golf players were saved, but the tournament field could not be linked to the slate: ${eventPlayersUpsertError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      slateId,
      refreshedAt,
      tournament: {
        eventId: tournament.espnEventId,
        name: tournament.name,
        status: tournament.status,
        statusDescription: tournament.statusDescription,
        currentRound: tournament.currentRound,
        completed: tournament.completed,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
      },
      playersUpserted: golfPlayerRows.length,
      eventPlayersUpserted: eventPlayerRows.length,
      preview: competitors.slice(0, 10).map((competitor) => ({
        espnPlayerId: competitor.espnPlayerId,
        displayName: competitor.displayName,
        leaderboardOrder: competitor.leaderboardOrder,
        officialScoreDisplay:
          competitor.officialScoreDisplay,
        status: competitor.status,
        teeTime: competitor.teeTime,
      })),
    });
  } catch (error) {
    console.error("Unexpected Golf refresh error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error while refreshing Golf data.",
      },
      { status: 500 }
    );
  }
}
