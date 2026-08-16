import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGolfStatusMeta } from "@/lib/golf/status";
import { calculateGolfCutLine } from "@/lib/golf/cutLine";

type GolfSlateRow = {
  id: number;
  date: string | null;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
  first_game_start_time: string | null;
  display_name: string | null;
  has_cut: boolean;
  tournament_analysis: string | null;
  show_tournament_analysis: boolean;
};

type TeamResultRow = {
  slate_id: number;
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
};

type GolfEventPlayerRow = {
  id: number;
  slate_id: number;
  player_id: number;
  leaderboard_order: number | null;
  official_score_to_par: number | null;
  official_score_display: string | null;
  fantasy_score: number | null;
  penalty_strokes: number | null;
  status: string | null;
  current_round: number | null;
  last_hole: number | null;
  holes_completed: number | null;
  rounds_completed: number | null;
  tee_time: string | null;
  tee_time_raw: string | null;
};

type GolfCutRoundRow = {
  event_player_id: number;
  round_number: number;
  score_to_par: number | null;
};

type GolfPlayerRow = {
  id: number;
  display_name: string;
  short_name: string | null;
  espn_player_id: string | null;
  headshot_url: string | null;
  country: string | null;
  owgr_rank: number | null;
};

type LineupRow = {
  id: number;
  slate_id: number;
  team_id: number;
};

type LineupPlayerRow = {
  lineup_id: number;
  player_id: number;
};

function formatSlateLabel(
  startDate: string,
  endDate: string,
) {
  return startDate === endDate
    ? startDate
    : `${startDate} - ${endDate}`;
}

function getSeason(date: string) {
  return (
    Number(date.slice(0, 4)) ||
    new Date().getFullYear()
  );
}

function golfScore(
  value: number | null | undefined,
) {
  const score = Number(value ?? 0);

  if (score === 0) return "E";
  return score > 0 ? `+${score}` : String(score);
}

function isTerminalGolfStatus(
  status: string | null | undefined,
) {
  return [
    "finished",
    "cut",
    "withdrawn",
    "disqualified",
  ].includes(String(status ?? "").toLowerCase());
}

export async function getGolfHomeSummary() {
  const [
    { data: slateData, error: slateError },
    { data: resultData, error: resultError },
    { data: teamData, error: teamError },
    { data: teamUserData, error: teamUserError },
    { data: slateTeamData, error: slateTeamError },
  ] = await Promise.all([
    supabaseAdmin
      .from("slates")
      .select(
        "id, date, start_date, end_date, is_locked, first_game_start_time, display_name, has_cut, tournament_analysis, show_tournament_analysis",
      )
      .eq("sport", "golf")
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false }),

    supabaseAdmin
      .from("team_slate_results")
      .select(
        "slate_id, team_id, fantasy_points, finish_position, games_completed, games_in_progress, games_remaining",
      ),

    supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true }),

    supabaseAdmin
      .from("app_users")
      .select("team_id, avatar_url")
      .not("team_id", "is", null),

    supabaseAdmin
      .from("slate_teams")
      .select(
        "slate_id, team_id, is_participating",
      )
      .eq("is_participating", true),
  ]);

  const initialError =
    slateError ||
    resultError ||
    teamError ||
    teamUserError ||
    slateTeamError;

  if (initialError) {
    return NextResponse.json(
      {
        error:
          initialError.message ||
          "Failed to load Golf home data.",
      },
      { status: 500 },
    );
  }

  const slates =
    (slateData ?? []) as GolfSlateRow[];

  const results =
    (resultData ?? []) as TeamResultRow[];

  const teamNameById = new Map(
    (teamData ?? []).map((team) => [
      Number(team.id),
      String(team.name),
    ]),
  );

  const avatarByTeamId =
    new Map<number, string | null>();

  (teamUserData ?? []).forEach((user) => {
    if (user.team_id == null) return;

    avatarByTeamId.set(
      Number(user.team_id),
      user.avatar_url ?? null,
    );
  });

  const participatingTeamIdsBySlate =
    new Map<number, Set<number>>();

  (slateTeamData ?? []).forEach((row) => {
    const slateId = Number(row.slate_id);

    const existing =
      participatingTeamIdsBySlate.get(slateId) ??
      new Set<number>();

    existing.add(Number(row.team_id));

    participatingTeamIdsBySlate.set(
      slateId,
      existing,
    );
  });

  const resultsBySlateId =
    new Map<number, TeamResultRow[]>();

  results.forEach((row) => {
    const existing =
      resultsBySlateId.get(row.slate_id) ?? [];

    existing.push(row);

    resultsBySlateId.set(
      row.slate_id,
      existing,
    );
  });

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const normalizedSlates = slates.map(
    (slate) => ({
      ...slate,
      date:
        slate.date ??
        slate.start_date ??
        today,
      start_date:
        slate.start_date ??
        slate.date ??
        today,
      end_date:
        slate.end_date ??
        slate.start_date ??
        slate.date ??
        today,
    }),
  );

  function rowsForSlate(slateId: number) {
    const participatingIds =
      participatingTeamIdsBySlate.get(slateId);

    const slateResults =
      resultsBySlateId.get(slateId) ?? [];

    if (!participatingIds) {
      return slateResults;
    }

    return slateResults.filter((row) =>
      participatingIds.has(row.team_id),
    );
  }

  function isLiveSlate(slateId: number) {
    return rowsForSlate(slateId).some(
      (row) =>
        Number(row.games_in_progress ?? 0) > 0,
    );
  }

  /*
   * Golf cannot use the generic team_slate_results game counters to decide
   * whether a tournament is final.
   *
   * Those counters describe the current scoring state and can legitimately
   * reach 0 remaining between rounds. For example, after every drafted golfer
   * finishes Round 2, games_remaining can be 0 even though Rounds 3 and 4
   * have not been played yet.
   *
   * Final Golf state is resolved later from golf_event_players, where we have
   * the actual tournament-round state.
   */
  function isCompleteSlate(slateId: number) {
    const slate = normalizedSlates.find(
      (row) => row.id === slateId,
    );

    return slate?.is_locked === true;
  }

  const now = Date.now();

  const liveSlate =
    normalizedSlates.find((slate) =>
      isLiveSlate(slate.id),
    ) ?? null;

  const startedOpenSlate =
    normalizedSlates.find((slate) => {
      if (slate.is_locked) return false;

      const startTime =
        slate.first_game_start_time
          ? new Date(
              slate.first_game_start_time,
            ).getTime()
          : new Date(
              `${slate.start_date}T00:00:00`,
            ).getTime();

      return startTime <= now;
    }) ?? null;

  const latestCompletedSlate =
    normalizedSlates.find(
      (slate) =>
        slate.is_locked ||
        isCompleteSlate(slate.id),
    ) ?? null;

  const nextSlate =
    normalizedSlates
      .filter((slate) => {
        if (slate.is_locked) return false;

        const startTime =
          slate.first_game_start_time
            ? new Date(
                slate.first_game_start_time,
              ).getTime()
            : new Date(
                `${slate.start_date}T00:00:00`,
              ).getTime();

        return startTime > now;
      })
      .sort((a, b) => {
        const aTime = new Date(
          a.first_game_start_time ??
            `${a.start_date}T00:00:00`,
        ).getTime();

        const bTime = new Date(
          b.first_game_start_time ??
            `${b.start_date}T00:00:00`,
        ).getTime();

        return aTime - bTime;
      })[0] ?? null;

  const latestSlate =
    liveSlate ??
    startedOpenSlate ??
    latestCompletedSlate ??
    nextSlate ??
    normalizedSlates[0] ??
    null;

  let latestEventPlayers: GolfEventPlayerRow[] =
    [];

  let latestGolfCutRounds: GolfCutRoundRow[] =
    [];

  let latestGolfPlayers: GolfPlayerRow[] = [];
  let latestLineups: LineupRow[] = [];
  let latestLineupPlayers: LineupPlayerRow[] =
    [];

  if (latestSlate) {
    const [
      {
        data: eventPlayerData,
        error: eventPlayerError,
      },
      {
        data: golfPlayerData,
        error: golfPlayerError,
      },
      {
        data: lineupData,
        error: lineupError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("golf_event_players")
        .select(
          "id, slate_id, player_id, leaderboard_order, official_score_to_par, official_score_display, fantasy_score, penalty_strokes, status, current_round, last_hole, holes_completed, rounds_completed, tee_time, tee_time_raw",
        )
        .eq("slate_id", latestSlate.id)
        .order("leaderboard_order", {
          ascending: true,
          nullsFirst: false,
        }),

      supabaseAdmin
        .from("golf_players")
        .select(
          "id, display_name, short_name, espn_player_id, headshot_url, country, owgr_rank",
        ),

      supabaseAdmin
        .from("lineups")
        .select("id, slate_id, team_id")
        .eq("slate_id", latestSlate.id),
    ]);

    const detailError =
      eventPlayerError ||
      golfPlayerError ||
      lineupError;

    if (detailError) {
      return NextResponse.json(
        {
          error:
            detailError.message ||
            "Failed to load the Golf tournament leaderboard.",
        },
        { status: 500 },
      );
    }

    latestEventPlayers =
      (eventPlayerData ??
        []) as GolfEventPlayerRow[];

    const latestEventPlayerIds =
      latestEventPlayers.map(
        (player) => player.id,
      );

    if (latestEventPlayerIds.length > 0) {
      const {
        data: cutRoundData,
        error: cutRoundError,
      } = await supabaseAdmin
        .from("golf_rounds")
        .select(
          "event_player_id, round_number, score_to_par",
        )
        .in(
          "event_player_id",
          latestEventPlayerIds,
        )
        .in(
          "round_number",
          [1, 2],
        );

      if (cutRoundError) {
        return NextResponse.json(
          {
            error:
              "Failed to load Golf cut-round scores: " +
              cutRoundError.message,
          },
          { status: 500 },
        );
      }

      latestGolfCutRounds =
        (cutRoundData ??
          []) as GolfCutRoundRow[];
    }

    latestGolfPlayers =
      (golfPlayerData ?? []) as GolfPlayerRow[];

    latestLineups =
      (lineupData ?? []) as LineupRow[];

    const lineupIds = latestLineups.map(
      (lineup) => lineup.id,
    );

    if (lineupIds.length > 0) {
      const {
        data: lineupPlayerData,
        error: lineupPlayerError,
      } = await supabaseAdmin
        .from("lineup_players")
        .select("lineup_id, player_id")
        .in("lineup_id", lineupIds);

      if (lineupPlayerError) {
        return NextResponse.json(
          {
            error:
              lineupPlayerError.message,
          },
          { status: 500 },
        );
      }

      latestLineupPlayers =
        (lineupPlayerData ??
          []) as LineupPlayerRow[];
    }
  }

  const golfPlayerById = new Map(
    latestGolfPlayers.map((player) => [
      player.id,
      player,
    ]),
  );

  const eventPlayerByPlayerId = new Map(
    latestEventPlayers.map((player) => [
      player.player_id,
      player,
    ]),
  );

  const lineupById = new Map(
    latestLineups.map((lineup) => [
      lineup.id,
      lineup,
    ]),
  );

  const playerIdsByTeamId =
    new Map<number, number[]>();

  const allDraftedPlayerIds = new Set<number>();

  const ownerNamesByPlayerId =
    new Map<number, string[]>();

  latestLineupPlayers.forEach((row) => {
    const lineup = lineupById.get(
      row.lineup_id,
    );

    if (!lineup) return;

    const existing =
      playerIdsByTeamId.get(lineup.team_id) ??
      [];

    existing.push(row.player_id);

    playerIdsByTeamId.set(
      lineup.team_id,
      existing,
    );

    allDraftedPlayerIds.add(row.player_id);

    const teamName =
      teamNameById.get(lineup.team_id) ??
      "Unknown Team";

    const ownerNames =
      ownerNamesByPlayerId.get(row.player_id) ??
      [];

    if (!ownerNames.includes(teamName)) {
      ownerNames.push(teamName);
    }

    ownerNamesByPlayerId.set(
      row.player_id,
      ownerNames,
    );
  });

  function getTeamGolfStatus(teamId: number) {
    const playerIds =
      playerIdsByTeamId.get(teamId) ?? [];

    if (playerIds.length === 0) {
      return "No lineup";
    }

    const players = playerIds
      .map((playerId) =>
        eventPlayerByPlayerId.get(playerId),
      )
      .filter(
        (
          player,
        ): player is GolfEventPlayerRow =>
          Boolean(player),
      );

    if (players.length === 0) {
      return `${playerIds.length}/4 drafted`;
    }

    const currentRound = Math.max(
      1,
      ...players.map((player) =>
        Number(
          player.current_round ??
            Math.max(
              Number(player.rounds_completed ?? 0),
              1,
            ),
        ),
      ),
    );

    function currentRoundHoles(
      player: GolfEventPlayerRow,
    ) {
      const totalHoles = Math.max(
        0,
        Number(
          player.holes_completed ?? 0,
        ),
      );

      const roundsCompleted = Math.max(
        0,
        Number(
          player.rounds_completed ?? 0,
        ),
      );

      const playerCurrentRound = Math.max(
        1,
        Number(
          player.current_round ??
            roundsCompleted + 1,
        ),
      );

      const status = String(
        player.status ?? "",
      ).toLowerCase();

      /*
       * golf_event_players.holes_completed is cumulative for the
       * tournament. Once a golfer advances to the next round,
       * 36 holes means:
       *
       *   R1 complete
       *   R2 complete
       *   R3 = 0 holes
       *
       * It must NOT be interpreted as "R3 complete".
       */
      if (
        playerCurrentRound >
        roundsCompleted
      ) {
        return Math.min(
          18,
          Math.max(
            0,
            totalHoles -
              roundsCompleted * 18,
          ),
        );
      }

      /*
       * A golfer explicitly sitting in round_complete for the round
       * they just finished should still display that round as complete.
       */
      if (
        status === "round_complete" &&
        roundsCompleted >=
          playerCurrentRound
      ) {
        return 18;
      }

      return Math.min(
        18,
        Math.max(
          0,
          totalHoles -
            Math.max(
              0,
              playerCurrentRound - 1,
            ) *
              18,
        ),
      );
    }

    /*
     * Current-round progress should only consider golfers who are still
     * eligible to play this round.
     *
     * CUT / WD / DQ golfers are finished with the tournament, but they
     * should not count as having completed the current round and should
     * not remain in the progress denominator.
     */
    const eligiblePlayers = players.filter(
      (player) =>
        !isTerminalGolfStatus(
          player.status,
        ),
    );

    if (eligiblePlayers.length === 0) {
      return `R${currentRound} complete`;
    }

    const livePlayers =
      eligiblePlayers.filter(
        (player) => {
          const status = String(
            player.status ?? "",
          ).toLowerCase();

          const holes =
            currentRoundHoles(player);

          return (
            status === "active" &&
            holes > 0 &&
            holes < 18
          );
        },
      );

    const completedCurrentRound =
      eligiblePlayers.filter(
        (player) =>
          currentRoundHoles(player) ===
          18,
      );

    if (
      completedCurrentRound.length ===
      eligiblePlayers.length
    ) {
      return `R${currentRound} complete`;
    }

    const progressLabel =
      `${completedCurrentRound.length}/${eligiblePlayers.length} complete`;

    if (livePlayers.length > 0) {
      return (
        `R${currentRound} · ` +
        `${livePlayers.length} live · ` +
        progressLabel
      );
    }

    return `R${currentRound} · ${progressLabel}`;
  }

  const latestRows = latestSlate
    ? rowsForSlate(latestSlate.id)
        .map((row) => ({
          ...row,
          teamName:
            teamNameById.get(row.team_id) ??
            "Unknown Team",
          avatarUrl:
            avatarByTeamId.get(row.team_id) ??
            null,
          projected_points: null,
          pregame_projected_points: null,
          win_probability: null,
          golf_status_label:
            getTeamGolfStatus(row.team_id),
        }))
        .sort((a, b) => {
          const aScore = Number(
            a.fantasy_points ?? 0,
          );

          const bScore = Number(
            b.fantasy_points ?? 0,
          );

          if (aScore !== bScore) {
            return aScore - bScore;
          }

          return a.teamName.localeCompare(
            b.teamName,
          );
        })
        .map((row, index) => ({
          ...row,
          finish_position:
            row.finish_position ?? index + 1,
        }))
    : [];

  /*
   * Determine whether the selected Golf tournament is genuinely over.
   *
   * A normal golfer must have reached the end of Round 4.
   * CUT / WD / DQ golfers are terminal and do not prevent the tournament
   * from completing.
   *
   * This deliberately does NOT treat "everyone finished the current round"
   * as tournament completion.
   */
  const latestGolfTournamentIsFinal =
    latestSlate !== null &&
    latestEventPlayers.length > 0 &&
    latestEventPlayers.every((player) => {
      if (isTerminalGolfStatus(player.status)) {
        return true;
      }

      const roundsCompleted = Number(
        player.rounds_completed ?? 0,
      );

      const holesCompleted = Number(
        player.holes_completed ?? 0,
      );

      const currentRound = Number(
        player.current_round ?? 0,
      );

      return (
        roundsCompleted >= 4 ||
        holesCompleted >= 72 ||
        (
          currentRound >= 4 &&
          holesCompleted > 0 &&
          holesCompleted % 18 === 0
        )
      );
    });

  const latestSeason = latestSlate
    ? getSeason(latestSlate.start_date)
    : new Date().getFullYear();

  const lockedSlateIds = new Set(
    normalizedSlates
      .filter((slate) => {
        if (slate.is_locked) {
          return true;
        }

        if (
          latestSlate &&
          slate.id === latestSlate.id
        ) {
          return latestGolfTournamentIsFinal;
        }

        return isCompleteSlate(slate.id);
      })
      .map((slate) => slate.id),
  );

  const seasonResults = results.filter(
    (row) => {
      const slate = normalizedSlates.find(
        (item) => item.id === row.slate_id,
      );

      return (
        slate &&
        getSeason(slate.start_date) ===
          latestSeason &&
        lockedSlateIds.has(row.slate_id)
      );
    },
  );

  const seasonSnapshot = Array.from(
    teamNameById.entries(),
  )
    .map(([teamId, name]) => {
      const rows = seasonResults.filter(
        (row) => row.team_id === teamId,
      );

      const scores = rows.map((row) =>
        Number(row.fantasy_points ?? 0),
      );

      const finishes = rows
        .map((row) => row.finish_position)
        .filter(
          (value): value is number =>
            value !== null &&
            value !== undefined,
        );

      return {
        team_id: teamId,
        name,
        wins: rows.filter(
          (row) => row.finish_position === 1,
        ).length,
        runner_ups: rows.filter(
          (row) => row.finish_position === 2,
        ).length,
        avg_finish:
          finishes.length > 0
            ? Number(
                (
                  finishes.reduce(
                    (sum, value) =>
                      sum + value,
                    0,
                  ) / finishes.length
                ).toFixed(2),
              )
            : null,
        avg_score:
          scores.length > 0
            ? Number(
                (
                  scores.reduce(
                    (sum, value) =>
                      sum + value,
                    0,
                  ) / scores.length
                ).toFixed(2),
              )
            : null,
        slates_played: rows.length,
      };
    })
    .sort((a, b) => {
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }

      return (
        (a.avg_finish ?? 999) -
        (b.avg_finish ?? 999)
      );
    });

  const tournamentLeaderboard =
    latestEventPlayers
      .filter(
        (player) =>
          player.leaderboard_order !== null,
      )
      .map((player) => {
        const golfPlayer =
          golfPlayerById.get(player.player_id);

        const draftedBy =
          ownerNamesByPlayerId.get(
            player.player_id,
          ) ?? [];

        return {
          playerId: player.player_id,
          name:
            golfPlayer?.display_name ??
            `Golfer ${player.player_id}`,
          shortName:
            golfPlayer?.short_name?.trim() ||
            golfPlayer?.display_name ||
            `Golfer ${player.player_id}`,
          espnGolfPlayerId:
            golfPlayer?.espn_player_id ??
            null,
          headshotUrl:
            golfPlayer?.headshot_url ??
            null,
          country:
            golfPlayer?.country ?? null,
          owgrRank:
            golfPlayer?.owgr_rank ?? null,
          position:
            player.leaderboard_order,
          score:
            player.official_score_to_par,
          scoreDisplay:
            player.official_score_display ??
            golfScore(
              player.official_score_to_par,
            ),
          status:
            player.status,
          statusLabel:
            getGolfStatusMeta(
              player,
            ).compactLabel,
          currentRound:
            player.current_round,
          lastHole:
            player.last_hole,
          holesCompleted:
            player.holes_completed,
          roundsCompleted:
            player.rounds_completed,
          isDrafted:
            draftedBy.length > 0,
          draftedBy,
        };
      });

  const cutRoundScoresByEventPlayerId =
    new Map<
      number,
      Map<number, number>
    >();

  latestGolfCutRounds.forEach((round) => {
    if (
      round.score_to_par === null ||
      round.score_to_par === undefined
    ) {
      return;
    }

    const eventPlayerScores =
      cutRoundScoresByEventPlayerId.get(
        round.event_player_id,
      ) ?? new Map<number, number>();

    eventPlayerScores.set(
      Number(round.round_number),
      Number(round.score_to_par),
    );

    cutRoundScoresByEventPlayerId.set(
      round.event_player_id,
      eventPlayerScores,
    );
  });

  const projectedCut =
    latestSlate?.has_cut !== false
      ? calculateGolfCutLine(
          latestEventPlayers.map(
        (player) => {
          const roundScores =
            cutRoundScoresByEventPlayerId.get(
              player.id,
            );

          const roundOne =
            roundScores?.get(1);

          const roundTwo =
            roundScores?.get(2);

          const hasThirtySixHoleScore =
            roundOne !== undefined &&
            roundTwo !== undefined;

          const thirtySixHoleScore =
            hasThirtySixHoleScore
              ? Number(roundOne) +
                Number(roundTwo)
              : null;

          return {
            /*
             * R1/R2 remains dynamic while Friday is in progress.
             * After R2, this value is frozen even while the golfer's
             * live tournament score changes on Saturday/Sunday.
             */
            score:
              thirtySixHoleScore ??
              player.official_score_to_par,
            status: player.status,
            position:
              player.leaderboard_order,
            holesCompleted:
              player.holes_completed,
            roundsCompleted:
              player.rounds_completed,
            currentRound:
              player.current_round,
          };
            },
          ),
        )
      : null;

  const tournamentFacts =
    tournamentLeaderboard
      .slice(0, 25)
      .map((player) => ({
        label: `#${player.position}`,
        value:
          `${player.shortName}` +
          `${player.isDrafted ? "*" : ""} ` +
          `${golfScore(player.score)}`,
        detail: player.statusLabel,
      }));

  const funFacts =
    tournamentFacts.length > 0
      ? tournamentFacts
      : [
          {
            label: "Golf",
            value:
              "Tournament leaderboard will appear after the first refresh.",
          },
        ];

  function serializeSlate(
    slate:
      | (typeof normalizedSlates)[number]
      | null,
  ) {
    if (!slate) return null;

    return {
      id: slate.id,
      date: slate.date,
      start_date: slate.start_date,
      end_date: slate.end_date,
      label:
        slate.display_name?.trim() ||
        formatSlateLabel(
          slate.start_date,
          slate.end_date,
        ),
      display_name:
        slate.display_name ?? null,
      is_locked: slate.is_locked,
      has_cut: slate.has_cut !== false,
      first_game_start_time:
        slate.first_game_start_time,
      tournament_analysis:
        slate.tournament_analysis ?? null,
      show_tournament_analysis:
        slate.show_tournament_analysis === true,
    };
  }

  return NextResponse.json({
    success: true,
    latestSlate:
      serializeSlate(latestSlate),
    latestGolfTournamentIsFinal,
    nextSlate: serializeSlate(nextSlate),
    latestSlateRows: latestRows,
    tournamentLeaderboard,
    projectedCut,
    seasonSnapshot,
    funFacts,
    latestSeason,
  });
}
