import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type TeamRow = {
  id: number;
  name: string;
};

type SlateRow = {
  id: number;
  start_date: string;
};

type TeamResultRow = {
  slate_id: number;
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
};

type LineupRow = {
  id: number;
  slate_id: number;
  team_id: number;
  lineup_players:
    | Array<{
        player_id: number;
      }>
    | null;
};

type GolfHoleRow = {
  relative_to_par: number | null;
};

type GolfRoundRow = {
  score_to_par: number | null;
  holes_completed: number | null;
  golf_holes: GolfHoleRow[] | null;
};

type GolfEventPlayerRow = {
  id: number;
  slate_id: number;
  player_id: number;
  golf_rounds: GolfRoundRow[] | null;
};

type GolfStandingAccumulator = {
  teamId: number;
  name: string;
  wins: number;
  runnerUps: number;
  totalFinish: number;
  tournamentsPlayed: number;
  totalToPar: number;
  tournamentScores: number[];
  birdies: number;
  eaglesOrBetter: number;
  pars: number;
  bogeys: number;
  doubleBogeysOrWorse: number;
  roundsUnderPar: number;
};

function seasonFromDate(value: string) {
  return new Date(`${value}T00:00:00`).getFullYear();
}

function roundTo(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}

export async function GET(request: NextRequest) {
  try {
    const seasonParam =
      request.nextUrl.searchParams.get("season");

    const [
      { data: teamData, error: teamError },
      { data: slateData, error: slateError },
    ] = await Promise.all([
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .order("name", {
          ascending: true,
        }),

      supabaseAdmin
        .from("slates")
        .select("id, start_date")
        .eq("sport", "golf")
        .eq("is_locked", true)
        .order("start_date", {
          ascending: true,
        }),
    ]);

    if (teamError || slateError) {
      return NextResponse.json(
        {
          error:
            teamError?.message ||
            slateError?.message ||
            "Unable to load Golf standings setup.",
        },
        {
          status: 500,
          headers: noStoreHeaders(),
        },
      );
    }

    const teams = (teamData ?? []) as TeamRow[];
    const allSlates = (slateData ?? []) as SlateRow[];

    const availableSeasons = Array.from(
      new Set(
        allSlates.map((slate) =>
          seasonFromDate(slate.start_date),
        ),
      ),
    ).sort((a, b) => b - a);

    const selectedSeason =
      seasonParam === "all"
        ? "all"
        : seasonParam &&
            Number.isFinite(Number(seasonParam))
          ? Number(seasonParam)
          : availableSeasons[0] ?? "all";

    const selectedSlates =
      selectedSeason === "all"
        ? allSlates
        : allSlates.filter(
            (slate) =>
              seasonFromDate(slate.start_date) ===
              selectedSeason,
          );

    const slateIds = selectedSlates.map(
      (slate) => slate.id,
    );

    if (slateIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          selectedSeason,
          availableSeasons,
          standings: teams.map((team) => ({
            team_id: team.id,
            name: team.name,
            wins: 0,
            runner_ups: 0,
            avg_finish: null,
            tournaments_played: 0,
            total_to_par: 0,
            avg_tournament_score: null,
            best_tournament_score: null,
            birdies: 0,
            eagles_or_better: 0,
            pars: 0,
            bogeys: 0,
            double_bogeys_or_worse: 0,
            rounds_under_par: 0,
          })),
        },
        {
          headers: noStoreHeaders(),
        },
      );
    }

    const [
      {
        data: resultData,
        error: resultError,
      },
      {
        data: lineupData,
        error: lineupError,
      },
      {
        data: eventPlayerData,
        error: eventPlayerError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("team_slate_results")
        .select(
          "slate_id, team_id, fantasy_points, finish_position",
        )
        .in("slate_id", slateIds),

      supabaseAdmin
        .from("lineups")
        .select(
          `
          id,
          slate_id,
          team_id,
          lineup_players (
            player_id
          )
        `,
        )
        .in("slate_id", slateIds),

      supabaseAdmin
        .from("golf_event_players")
        .select(
          `
          id,
          slate_id,
          player_id,
          golf_rounds (
            score_to_par,
            holes_completed,
            golf_holes (
              relative_to_par
            )
          )
        `,
        )
        .in("slate_id", slateIds),
    ]);

    if (
      resultError ||
      lineupError ||
      eventPlayerError
    ) {
      return NextResponse.json(
        {
          error:
            resultError?.message ||
            lineupError?.message ||
            eventPlayerError?.message ||
            "Unable to load Golf standings data.",
        },
        {
          status: 500,
          headers: noStoreHeaders(),
        },
      );
    }

    const results =
      (resultData ?? []) as TeamResultRow[];

    const lineups =
      (lineupData ?? []) as LineupRow[];

    const eventPlayers =
      (eventPlayerData ?? []) as GolfEventPlayerRow[];

    const accumulatorByTeamId = new Map<
      number,
      GolfStandingAccumulator
    >(
      teams.map((team) => [
        team.id,
        {
          teamId: team.id,
          name: team.name,
          wins: 0,
          runnerUps: 0,
          totalFinish: 0,
          tournamentsPlayed: 0,
          totalToPar: 0,
          tournamentScores: [],
          birdies: 0,
          eaglesOrBetter: 0,
          pars: 0,
          bogeys: 0,
          doubleBogeysOrWorse: 0,
          roundsUnderPar: 0,
        },
      ]),
    );

    for (const result of results) {
      const accumulator =
        accumulatorByTeamId.get(
          Number(result.team_id),
        );

      if (!accumulator) continue;

      const score = Number(
        result.fantasy_points ?? 0,
      );

      accumulator.tournamentsPlayed += 1;
      accumulator.totalToPar += score;
      accumulator.tournamentScores.push(score);

      if (result.finish_position !== null) {
        accumulator.totalFinish += Number(
          result.finish_position,
        );
      }

      if (result.finish_position === 1) {
        accumulator.wins += 1;
      }

      if (result.finish_position === 2) {
        accumulator.runnerUps += 1;
      }
    }

    const ownerBySlatePlayer = new Map<
      string,
      number
    >();

    for (const lineup of lineups) {
      for (
        const lineupPlayer of
        lineup.lineup_players ?? []
      ) {
        ownerBySlatePlayer.set(
          `${lineup.slate_id}:${lineupPlayer.player_id}`,
          Number(lineup.team_id),
        );
      }
    }

    for (const eventPlayer of eventPlayers) {
      const teamId = ownerBySlatePlayer.get(
        `${eventPlayer.slate_id}:${eventPlayer.player_id}`,
      );

      if (teamId === undefined) continue;

      const accumulator =
        accumulatorByTeamId.get(teamId);

      if (!accumulator) continue;

      for (
        const round of
        eventPlayer.golf_rounds ?? []
      ) {
        const roundScore =
          round.score_to_par === null
            ? null
            : Number(round.score_to_par);

        if (
          Number(round.holes_completed ?? 0) >= 18 &&
          roundScore !== null &&
          roundScore < 0
        ) {
          accumulator.roundsUnderPar += 1;
        }

        for (
          const hole of round.golf_holes ?? []
        ) {
          if (
            hole.relative_to_par === null ||
            hole.relative_to_par === undefined
          ) {
            continue;
          }

          const relative = Number(
            hole.relative_to_par,
          );

          if (relative <= -2) {
            accumulator.eaglesOrBetter += 1;
          } else if (relative === -1) {
            accumulator.birdies += 1;
          } else if (relative === 0) {
            accumulator.pars += 1;
          } else if (relative === 1) {
            accumulator.bogeys += 1;
          } else if (relative >= 2) {
            accumulator.doubleBogeysOrWorse += 1;
          }
        }
      }
    }

    const standings = Array.from(
      accumulatorByTeamId.values(),
    )
      .map((row) => ({
        team_id: row.teamId,
        name: row.name,
        wins: row.wins,
        runner_ups: row.runnerUps,
        avg_finish:
          row.tournamentsPlayed > 0
            ? roundTo(
                row.totalFinish /
                  row.tournamentsPlayed,
              )
            : null,
        tournaments_played:
          row.tournamentsPlayed,
        total_to_par:
          row.totalToPar,
        avg_tournament_score:
          row.tournamentsPlayed > 0
            ? roundTo(
                row.totalToPar /
                  row.tournamentsPlayed,
              )
            : null,
        best_tournament_score:
          row.tournamentScores.length > 0
            ? Math.min(
                ...row.tournamentScores,
              )
            : null,
        birdies: row.birdies,
        eagles_or_better:
          row.eaglesOrBetter,
        pars: row.pars,
        bogeys: row.bogeys,
        double_bogeys_or_worse:
          row.doubleBogeysOrWorse,
        rounds_under_par:
          row.roundsUnderPar,
      }))
      .sort(
        (a, b) =>
          b.wins - a.wins ||
          b.runner_ups - a.runner_ups ||
          Number(
            a.avg_finish ??
              Number.MAX_SAFE_INTEGER,
          ) -
            Number(
              b.avg_finish ??
                Number.MAX_SAFE_INTEGER,
            ) ||
          a.total_to_par - b.total_to_par,
      );

    return NextResponse.json(
      {
        success: true,
        selectedSeason,
        availableSeasons,
        standings,
      },
      {
        headers: noStoreHeaders(),
      },
    );
  } catch (error) {
    console.error(
      "Unable to load Golf standings",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unexpected error while loading Golf standings.",
      },
      {
        status: 500,
        headers: noStoreHeaders(),
      },
    );
  }
}
