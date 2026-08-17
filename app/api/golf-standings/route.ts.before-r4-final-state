import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type TeamRow = {
  id: number;
  name: string;
};

type SlateRow = {
  id: number;
  start_date: string;
  end_date: string | null;
  display_name: string | null;
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
  status: string | null;
  rounds_completed: number | null;
  holes_completed: number | null;
  golf_rounds: GolfRoundRow[] | null;
};

type TournamentState =
  | "final"
  | "live"
  | "upcoming";

type TournamentMeta = {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  season: number;
  state: TournamentState;
};

type TournamentHistoryRow = {
  slate_id: number;
  tournament_name: string;
  start_date: string;
  state: TournamentState;
  score: number | null;
  finish_position: number | null;
};

type GolfStandingAccumulator = {
  teamId: number;
  name: string;

  wins: number;
  runnerUps: number;
  podiums: number;

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

  history: TournamentHistoryRow[];
};

function seasonFromDate(
  value: string,
) {
  return (
    Number(value.slice(0, 4)) ||
    new Date(
      `${value}T00:00:00`,
    ).getFullYear()
  );
}

function roundTo(
  value: number,
  digits = 2,
) {
  return Number(
    value.toFixed(digits),
  );
}

function noStoreHeaders() {
  return {
    "Cache-Control":
      "no-store, max-age=0",
  };
}

function tournamentName(
  slate: SlateRow,
) {
  const displayName =
    slate.display_name?.trim();

  if (displayName) {
    return displayName;
  }

  if (
    slate.end_date &&
    slate.end_date !==
      slate.start_date
  ) {
    return (
      `${slate.start_date} - ` +
      `${slate.end_date}`
    );
  }

  return slate.start_date;
}

function tournamentState(
  eventPlayers: GolfEventPlayerRow[],
): TournamentState {
  if (eventPlayers.length === 0) {
    return "upcoming";
  }

  const statuses =
    eventPlayers.map((row) =>
      String(
        row.status ?? "scheduled",
      ).toLowerCase(),
    );

  const hasFinishedGolfer =
    statuses.includes("finished");

  const hasNonTerminalGolfer =
    statuses.some((status) =>
      [
        "scheduled",
        "active",
        "round_complete",
      ].includes(status),
    );

  if (
    hasFinishedGolfer &&
    !hasNonTerminalGolfer
  ) {
    return "final";
  }

  const hasActivity =
    eventPlayers.some(
      (row) =>
        Number(
          row.holes_completed ?? 0,
        ) > 0 ||
        Number(
          row.rounds_completed ?? 0,
        ) > 0 ||
        [
          "active",
          "round_complete",
          "cut",
          "withdrawn",
          "disqualified",
          "finished",
        ].includes(
          String(
            row.status ?? "",
          ).toLowerCase(),
        ),
    );

  return hasActivity
    ? "live"
    : "upcoming";
}

export async function GET(
  request: NextRequest,
) {
  try {
    const seasonParam =
      request.nextUrl.searchParams.get(
        "season",
      );

    const [
      {
        data: teamData,
        error: teamError,
      },
      {
        data: slateData,
        error: slateError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("teams")
        .select("id, name")
        .order("name", {
          ascending: true,
        }),

      supabaseAdmin
        .from("slates")
        .select(
          "id, start_date, end_date, display_name",
        )
        .eq("sport", "golf")
        .order("start_date", {
          ascending: true,
        }),
    ]);

    if (
      teamError ||
      slateError
    ) {
      return NextResponse.json(
        {
          error:
            teamError?.message ||
            slateError?.message ||
            "Unable to load Golf standings setup.",
        },
        {
          status: 500,
          headers:
            noStoreHeaders(),
        },
      );
    }

    const teams =
      (teamData ?? []) as TeamRow[];

    const allSlates =
      (slateData ??
        []) as SlateRow[];

    const availableSeasons =
      Array.from(
        new Set(
          allSlates.map(
            (slate) =>
              seasonFromDate(
                slate.start_date,
              ),
          ),
        ),
      ).sort(
        (a, b) => b - a,
      );

    const selectedSeason:
      number | "all" =
      seasonParam === "all"
        ? "all"
        : seasonParam &&
            Number.isFinite(
              Number(
                seasonParam,
              ),
            )
          ? Number(seasonParam)
          : availableSeasons[0] ??
            "all";

    const selectedSlates =
      selectedSeason === "all"
        ? allSlates
        : allSlates.filter(
            (slate) =>
              seasonFromDate(
                slate.start_date,
              ) === selectedSeason,
          );

    const slateIds =
      selectedSlates.map(
        (slate) => slate.id,
      );

    if (
      slateIds.length === 0
    ) {
      return NextResponse.json(
        {
          success: true,
          selectedSeason,
          availableSeasons,
          finalizedTournaments: 0,
          liveTournaments: 0,
          upcomingTournaments: 0,
          standings:
            teams.map(
              (team) => ({
                team_id:
                  team.id,
                name:
                  team.name,
                wins: 0,
                runner_ups: 0,
                podiums: 0,
                avg_finish: null,
                tournaments_played: 0,
                total_to_par: 0,
                avg_tournament_score:
                  null,
                best_tournament_score:
                  null,
                birdies: 0,
                eagles_or_better: 0,
                pars: 0,
                bogeys: 0,
                double_bogeys_or_worse:
                  0,
                rounds_under_par: 0,
                tournament_history:
                  [],
              }),
            ),
        },
        {
          headers:
            noStoreHeaders(),
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
        .from(
          "team_slate_results",
        )
        .select(
          [
            "slate_id",
            "team_id",
            "fantasy_points",
            "finish_position",
          ].join(","),
        )
        .in(
          "slate_id",
          slateIds,
        ),

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
        .in(
          "slate_id",
          slateIds,
        ),

      supabaseAdmin
        .from(
          "golf_event_players",
        )
        .select(
          `
          id,
          slate_id,
          player_id,
          status,
          rounds_completed,
          holes_completed,
          golf_rounds (
            score_to_par,
            holes_completed,
            golf_holes (
              relative_to_par
            )
          )
        `,
        )
        .in(
          "slate_id",
          slateIds,
        ),
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
          headers:
            noStoreHeaders(),
        },
      );
    }

    const results =
      (resultData ??
        []) as unknown as TeamResultRow[];

    const lineups =
      (lineupData ??
        []) as unknown as LineupRow[];

    const eventPlayers =
      (eventPlayerData ??
        []) as unknown as GolfEventPlayerRow[];

    const eventPlayersBySlate =
      new Map<
        number,
        GolfEventPlayerRow[]
      >();

    for (
      const eventPlayer of
      eventPlayers
    ) {
      const slateId =
        Number(
          eventPlayer.slate_id,
        );

      const existing =
        eventPlayersBySlate.get(
          slateId,
        ) ?? [];

      existing.push(
        eventPlayer,
      );

      eventPlayersBySlate.set(
        slateId,
        existing,
      );
    }

    const tournamentBySlateId =
      new Map<
        number,
        TournamentMeta
      >(
        selectedSlates.map(
          (slate) => {
            const state =
              tournamentState(
                eventPlayersBySlate.get(
                  slate.id,
                ) ?? [],
              );

            return [
              slate.id,
              {
                id: slate.id,
                name:
                  tournamentName(
                    slate,
                  ),
                startDate:
                  slate.start_date,
                endDate:
                  slate.end_date,
                season:
                  seasonFromDate(
                    slate.start_date,
                  ),
                state,
              },
            ];
          },
        ),
      );

    const finalizedSlateIds =
      new Set(
        Array.from(
          tournamentBySlateId.values(),
        )
          .filter(
            (tournament) =>
              tournament.state ===
              "final",
          )
          .map(
            (tournament) =>
              tournament.id,
          ),
      );

    const liveTournaments =
      Array.from(
        tournamentBySlateId.values(),
      ).filter(
        (tournament) =>
          tournament.state ===
          "live",
      ).length;

    const upcomingTournaments =
      Array.from(
        tournamentBySlateId.values(),
      ).filter(
        (tournament) =>
          tournament.state ===
          "upcoming",
      ).length;

    const resultBySlateTeam =
      new Map<
        string,
        TeamResultRow
      >();

    for (
      const result of results
    ) {
      resultBySlateTeam.set(
        `${result.slate_id}:${result.team_id}`,
        result,
      );
    }

    const accumulatorByTeamId =
      new Map<
        number,
        GolfStandingAccumulator
      >(
        teams.map(
          (team) => [
            team.id,
            {
              teamId:
                team.id,
              name:
                team.name,

              wins: 0,
              runnerUps: 0,
              podiums: 0,

              totalFinish: 0,
              tournamentsPlayed: 0,

              totalToPar: 0,
              tournamentScores:
                [],

              birdies: 0,
              eaglesOrBetter: 0,
              pars: 0,
              bogeys: 0,
              doubleBogeysOrWorse:
                0,
              roundsUnderPar: 0,

              history: [],
            },
          ],
        ),
      );

    /*
     * Tournament history includes live events,
     * but season standings only count finalized
     * tournaments.
     */
    for (
      const lineup of lineups
    ) {
      const tournament =
        tournamentBySlateId.get(
          Number(
            lineup.slate_id,
          ),
        );

      const accumulator =
        accumulatorByTeamId.get(
          Number(
            lineup.team_id,
          ),
        );

      if (
        !tournament ||
        !accumulator
      ) {
        continue;
      }

      const result =
        resultBySlateTeam.get(
          `${lineup.slate_id}:${lineup.team_id}`,
        );

      accumulator.history.push(
        {
          slate_id:
            Number(
              lineup.slate_id,
            ),
          tournament_name:
            tournament.name,
          start_date:
            tournament.startDate,
          state:
            tournament.state,
          score:
            result?.fantasy_points ===
              null ||
            result?.fantasy_points ===
              undefined
              ? null
              : Number(
                  result.fantasy_points,
                ),
          finish_position:
            tournament.state ===
              "final" &&
            result?.finish_position !==
              null &&
            result?.finish_position !==
              undefined
              ? Number(
                  result.finish_position,
                )
              : null,
        },
      );

      if (
        tournament.state !==
        "final" ||
        !result
      ) {
        continue;
      }

      const score =
        Number(
          result.fantasy_points ??
            0,
        );

      accumulator.tournamentsPlayed +=
        1;

      accumulator.totalToPar +=
        score;

      accumulator.tournamentScores.push(
        score,
      );

      if (
        result.finish_position !==
          null &&
        result.finish_position !==
          undefined
      ) {
        const finish =
          Number(
            result.finish_position,
          );

        accumulator.totalFinish +=
          finish;

        if (finish === 1) {
          accumulator.wins +=
            1;
        }

        if (finish === 2) {
          accumulator.runnerUps +=
            1;
        }

        if (
          finish >= 1 &&
          finish <= 3
        ) {
          accumulator.podiums +=
            1;
        }
      }
    }

    /*
     * Hole-level performance totals intentionally
     * include live play. They are descriptive stats,
     * not settled season results.
     */
    const ownerBySlatePlayer =
      new Map<string, number>();

    for (
      const lineup of lineups
    ) {
      for (
        const lineupPlayer of
        lineup.lineup_players ??
        []
      ) {
        ownerBySlatePlayer.set(
          `${lineup.slate_id}:${lineupPlayer.player_id}`,
          Number(
            lineup.team_id,
          ),
        );
      }
    }

    for (
      const eventPlayer of
      eventPlayers
    ) {
      const teamId =
        ownerBySlatePlayer.get(
          `${eventPlayer.slate_id}:${eventPlayer.player_id}`,
        );

      if (
        teamId === undefined
      ) {
        continue;
      }

      const accumulator =
        accumulatorByTeamId.get(
          teamId,
        );

      if (!accumulator) {
        continue;
      }

      for (
        const round of
        eventPlayer.golf_rounds ??
        []
      ) {
        const roundScore =
          round.score_to_par ===
          null
            ? null
            : Number(
                round.score_to_par,
              );

        if (
          Number(
            round.holes_completed ??
              0,
          ) >= 18 &&
          roundScore !== null &&
          roundScore < 0
        ) {
          accumulator.roundsUnderPar +=
            1;
        }

        for (
          const hole of
          round.golf_holes ??
          []
        ) {
          if (
            hole.relative_to_par ===
              null ||
            hole.relative_to_par ===
              undefined
          ) {
            continue;
          }

          const relative =
            Number(
              hole.relative_to_par,
            );

          if (
            relative <= -2
          ) {
            accumulator.eaglesOrBetter +=
              1;
          } else if (
            relative === -1
          ) {
            accumulator.birdies +=
              1;
          } else if (
            relative === 0
          ) {
            accumulator.pars +=
              1;
          } else if (
            relative === 1
          ) {
            accumulator.bogeys +=
              1;
          } else if (
            relative >= 2
          ) {
            accumulator.doubleBogeysOrWorse +=
              1;
          }
        }
      }
    }

    const standings =
      Array.from(
        accumulatorByTeamId.values(),
      )
        .map((row) => ({
          team_id:
            row.teamId,

          name:
            row.name,

          wins:
            row.wins,

          runner_ups:
            row.runnerUps,

          podiums:
            row.podiums,

          avg_finish:
            row.tournamentsPlayed >
            0
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
            row.tournamentsPlayed >
            0
              ? roundTo(
                  row.totalToPar /
                    row.tournamentsPlayed,
                )
              : null,

          best_tournament_score:
            row.tournamentScores
              .length > 0
              ? Math.min(
                  ...row.tournamentScores,
                )
              : null,

          birdies:
            row.birdies,

          eagles_or_better:
            row.eaglesOrBetter,

          pars:
            row.pars,

          bogeys:
            row.bogeys,

          double_bogeys_or_worse:
            row.doubleBogeysOrWorse,

          rounds_under_par:
            row.roundsUnderPar,

          tournament_history:
            [...row.history].sort(
              (a, b) =>
                b.start_date.localeCompare(
                  a.start_date,
                ),
            ),
        }))
        .sort(
          (a, b) =>
            b.wins -
              a.wins ||
            b.podiums -
              a.podiums ||
            Number(
              a.avg_finish ??
                Number.MAX_SAFE_INTEGER,
            ) -
              Number(
                b.avg_finish ??
                  Number.MAX_SAFE_INTEGER,
              ) ||
            Number(
              a.avg_tournament_score ??
                Number.MAX_SAFE_INTEGER,
            ) -
              Number(
                b.avg_tournament_score ??
                  Number.MAX_SAFE_INTEGER,
              ) ||
            a.name.localeCompare(
              b.name,
            ),
        );

    return NextResponse.json(
      {
        success: true,
        selectedSeason,
        availableSeasons,

        finalizedTournaments:
          finalizedSlateIds.size,

        liveTournaments,

        upcomingTournaments,

        standings,
      },
      {
        headers:
          noStoreHeaders(),
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
        headers:
          noStoreHeaders(),
      },
    );
  }
}
