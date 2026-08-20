import { NextResponse } from "next/server";
import { formatSlateDateLabel } from "@/lib/formatSlateLabel";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ProfileScope } from "@/lib/profile/profileScope";

function round(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function getSeasonFromSlate(slate: any) {
  const date =
    slate?.start_date ??
    slate?.date ??
    "";

  return date
    ? new Date(`${date}T00:00:00`).getFullYear()
    : new Date().getFullYear();
}

function getWinStreaks(rows: any[]) {
  let longest = 0;
  let current = 0;
  let running = 0;

  [...rows]
    .sort((a, b) =>
      String(a.slateStart).localeCompare(
        String(b.slateStart),
      ),
    )
    .forEach((row) => {
      if (row.finishPosition === 1) {
        running += 1;
        longest = Math.max(longest, running);
      } else {
        running = 0;
      }
    });

  [...rows]
    .sort((a, b) =>
      String(b.slateStart).localeCompare(
        String(a.slateStart),
      ),
    )
    .some((row) => {
      if (row.finishPosition === 1) {
        current += 1;
        return false;
      }

      return true;
    });

  return {
    current,
    longest,
  };
}

function summarize(rows: any[]) {
  const scores = rows.map((row) =>
    Number(row.score ?? 0),
  );

  const finishes = rows
    .map((row) => row.finishPosition)
    .filter(
      (value): value is number =>
        value !== null &&
        value !== undefined,
    );

  const wins = rows.filter(
    (row) => row.finishPosition === 1,
  ).length;

  const runnerUps = rows.filter(
    (row) => row.finishPosition === 2,
  ).length;

  const podiumFinishes = rows.filter(
    (row) =>
      row.finishPosition !== null &&
      row.finishPosition !== undefined &&
      Number(row.finishPosition) <= 3,
  ).length;

  return {
    slatesPlayed: rows.length,
    wins,
    runnerUps,
    podiumFinishes,
    winRate:
      rows.length > 0
        ? round((wins / rows.length) * 100)
        : null,
    avgFinish:
      finishes.length > 0
        ? round(
            finishes.reduce(
              (sum, value) => sum + value,
              0,
            ) / finishes.length,
          )
        : null,
    avgScore:
      scores.length > 0
        ? round(
            scores.reduce(
              (sum, value) => sum + value,
              0,
            ) / scores.length,
          )
        : null,
  };
}

function isCompletedResult(result: any) {
  /*
   * Golf completion is finalized by locking the slate.
   *
   * The games_* counters describe drafted-golfer status and are
   * not a reliable canonical signal that the tournament itself
   * has been finalized.
   */
  return Boolean(result.isLocked);
}

function isCutStatus(status: string | null | undefined) {
  return [
    "cut",
    "withdrawn",
    "disqualified",
    "did_not_start",
  ].includes(
    String(status ?? "").toLowerCase(),
  );
}

export async function getGolfTeamProfile(
  teamId: number,
  seasonParam: string | null,
  scope: ProfileScope,
) {
  const isAllTime =
    !seasonParam ||
    seasonParam === "all";

  const [
    { data: team, error: teamError },
    { data: slates, error: slatesError },
    { data: results, error: resultsError },
    { data: lineups, error: lineupsError },
    {
      data: slateTeamConfigs,
      error: slateTeamConfigsError,
    },
    { data: teamUser, error: teamUserError },
    { data: leagueAwards, error: awardsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name")
      .eq("id", teamId)
      .eq(
        "group_id",
        scope.groupId,
      )
      .maybeSingle(),

    supabaseAdmin
      .from("slates")
      .select(
        "id, date, start_date, end_date, display_name, is_locked, league_id",
      )
      .eq(
        "league_id",
        scope.leagueId,
      ),

    supabaseAdmin
      .from("team_slate_results")
      .select(
        "slate_id, team_id, fantasy_points, finish_position, games_completed, games_in_progress, games_remaining",
      )
      .eq("team_id", teamId),

    supabaseAdmin
      .from("lineups")
      .select("id, slate_id, team_id")
      .eq("team_id", teamId),

    supabaseAdmin
      .from("slate_teams")
      .select(
        "slate_id, team_id, draft_order, is_participating",
      )
      .eq("team_id", teamId),

    supabaseAdmin
      .from("app_users")
      .select("avatar_url")
      .eq("team_id", teamId)
      .maybeSingle(),

    supabaseAdmin
      .from("league_awards")
      .select(
        "id, season, team_id, title, emoji, description, rarity, display_order, featured",
      )
      .eq("team_id", teamId)
      .eq("sport", "golf")
      .order("season", {
        ascending: false,
      })
      .order("featured", {
        ascending: false,
      })
      .order("display_order", {
        ascending: true,
      }),
  ]);

  const initialError =
    teamError ||
    slatesError ||
    resultsError ||
    lineupsError ||
    slateTeamConfigsError ||
    teamUserError ||
    awardsError;

  if (initialError) {
    return NextResponse.json(
      {
        error:
          initialError.message ||
          "Unable to load Golf team profile.",
      },
      { status: 500 },
    );
  }

  const safeTeam =
    team ?? {
      id: teamId,
      name: "Unknown Team",
    };

  const safeSlates = slates ?? [];
  const safeResults = results ?? [];
  const safeLineups = lineups ?? [];
  const safeConfigs =
    slateTeamConfigs ?? [];

  const slateById = new Map(
    safeSlates.map((slate) => [
      Number(slate.id),
      slate,
    ]),
  );

  const slateIds = safeSlates.map(
    (slate) => Number(slate.id),
  );

  /*
   * Load every team's result for Golf slates so Golf-specific
   * winning-margin milestones can compare the winner to the runner-up.
   *
   * Lower scores are better in Golf.
   */
  const {
    data: allGolfResultData,
    error: allGolfResultError,
  } = slateIds.length > 0
    ? await supabaseAdmin
        .from("team_slate_results")
        .select(
          "slate_id, team_id, fantasy_points, finish_position",
        )
        .in("slate_id", slateIds)
    : {
        data: [],
        error: null,
      };

  if (allGolfResultError) {
    return NextResponse.json(
      {
        error:
          "Unable to load Golf winning margins: " +
          allGolfResultError.message,
      },
      { status: 500 },
    );
  }

  const allGolfResults =
    allGolfResultData ?? [];

  const golfLineups = safeLineups.filter(
    (lineup) =>
      slateById.has(
        Number(lineup.slate_id),
      ),
  );

  const lineupIds = golfLineups.map(
    (lineup) => Number(lineup.id),
  );

  let lineupPlayers: Array<{
    lineup_id: number;
    player_id: number;
  }> = [];

  if (lineupIds.length > 0) {
    const {
      data,
      error,
    } = await supabaseAdmin
      .from("lineup_players")
      .select("lineup_id, player_id")
      .in("lineup_id", lineupIds);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    lineupPlayers =
      (data ?? []).map((row) => ({
        lineup_id: Number(row.lineup_id),
        player_id: Number(row.player_id),
      }));
  }

  const playerIds = Array.from(
    new Set(
      lineupPlayers.map(
        (row) => row.player_id,
      ),
    ),
  );

  let golfPlayers: any[] = [];
  let eventPlayers: any[] = [];

  if (playerIds.length > 0) {
    const [
      {
        data: playerData,
        error: playerError,
      },
      {
        data: eventPlayerData,
        error: eventPlayerError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from("golf_players")
        .select(
          "id, display_name, short_name, espn_player_id, headshot_url, country, owgr_rank",
        )
        .in("id", playerIds),

      supabaseAdmin
        .from("golf_event_players")
        .select(
          "id, slate_id, player_id, leaderboard_order, official_score_to_par, fantasy_score, penalty_strokes, status, rounds_completed, holes_completed",
        )
        .in("slate_id", slateIds)
        .in("player_id", playerIds),
    ]);

    if (playerError || eventPlayerError) {
      return NextResponse.json(
        {
          error:
            playerError?.message ||
            eventPlayerError?.message ||
            "Unable to load Golf players.",
        },
        { status: 500 },
      );
    }

    golfPlayers = playerData ?? [];
    eventPlayers =
      eventPlayerData ?? [];
  }

  const eventPlayerIds = eventPlayers.map(
    (row) => Number(row.id),
  );

  let rounds: any[] = [];
  let holes: any[] = [];

  if (eventPlayerIds.length > 0) {
    const {
      data: roundData,
      error: roundError,
    } = await supabaseAdmin
      .from("golf_rounds")
      .select(
        "id, event_player_id, round_number, score_to_par, strokes, holes_completed, status",
      )
      .in(
        "event_player_id",
        eventPlayerIds,
      );

    if (roundError) {
      return NextResponse.json(
        { error: roundError.message },
        { status: 500 },
      );
    }

    rounds = roundData ?? [];

    const roundIds = rounds.map(
      (round) => Number(round.id),
    );

    if (roundIds.length > 0) {
      const {
        data: holeData,
        error: holeError,
      } = await supabaseAdmin
        .from("golf_holes")
        .select(
          "round_id, hole_number, strokes, relative_to_par",
        )
        .in("round_id", roundIds);

      if (holeError) {
        return NextResponse.json(
          { error: holeError.message },
          { status: 500 },
        );
      }

      holes = holeData ?? [];
    }
  }

  const playerById = new Map(
    golfPlayers.map((player) => [
      Number(player.id),
      player,
    ]),
  );

  const lineupById = new Map(
    golfLineups.map((lineup) => [
      Number(lineup.id),
      lineup,
    ]),
  );

  const playerIdsBySlateId =
    new Map<number, number[]>();

  lineupPlayers.forEach((row) => {
    const lineup = lineupById.get(
      row.lineup_id,
    );

    if (!lineup) return;

    const slateId = Number(
      lineup.slate_id,
    );

    const existing =
      playerIdsBySlateId.get(slateId) ??
      [];

    existing.push(row.player_id);

    playerIdsBySlateId.set(
      slateId,
      existing,
    );
  });

  const eventPlayerBySlatePlayer =
    new Map<string, any>();

  eventPlayers.forEach((row) => {
    eventPlayerBySlatePlayer.set(
      `${Number(row.slate_id)}:${Number(
        row.player_id,
      )}`,
      row,
    );
  });

  const roundById = new Map(
    rounds.map((round) => [
      Number(round.id),
      round,
    ]),
  );

  const eventPlayerById = new Map(
    eventPlayers.map((row) => [
      Number(row.id),
      row,
    ]),
  );

  const latestSeason =
    safeSlates.length > 0
      ? Math.max(
          ...safeSlates.map(
            getSeasonFromSlate,
          ),
        )
      : new Date().getFullYear();

  const allTeamRows = safeResults
    .filter((result) =>
      slateById.has(
        Number(result.slate_id),
      ),
    )
    .map((result) => {
      const slate = slateById.get(
        Number(result.slate_id),
      );

      const config = safeConfigs.find(
        (row) =>
          Number(row.slate_id) ===
          Number(result.slate_id),
      );

      const draftedPlayerIds =
        playerIdsBySlateId.get(
          Number(result.slate_id),
        ) ?? [];

      const draftedGolfers =
        draftedPlayerIds
          .map((playerId) => {
            const player =
              playerById.get(playerId);

            const eventPlayer =
              eventPlayerBySlatePlayer.get(
                `${Number(
                  result.slate_id,
                )}:${playerId}`,
              );

            return {
              playerId,
              playerName:
                player?.display_name ??
                `Golfer ${playerId}`,
              fantasyPoints:
                eventPlayer?.fantasy_score ??
                eventPlayer
                  ?.official_score_to_par ??
                null,
              status:
                eventPlayer?.status ??
                null,
              leaderboardOrder:
                eventPlayer
                  ?.leaderboard_order ??
                null,
            };
          })
          .filter(
            (row) =>
              row.fantasyPoints !== null,
          );

      const topPlayer =
        [...draftedGolfers].sort(
          (a, b) =>
            Number(
              a.fantasyPoints ?? 999,
            ) -
            Number(
              b.fantasyPoints ?? 999,
            ),
        )[0] ?? null;

      return {
        slateId:
          Number(result.slate_id),
        isLocked:
          Boolean(slate?.is_locked),
        slateLabel:
          slate?.display_name?.trim() ||
          formatSlateDateLabel(slate),
        slateStart:
          slate?.start_date ??
          slate?.date ??
          "",
        season:
          getSeasonFromSlate(slate),
        score:
          Number(
            result.fantasy_points ?? 0,
          ),
        finishPosition:
          result.finish_position ??
          null,
        gamesCompleted:
          Number(
            result.games_completed ?? 0,
          ),
        gamesInProgress:
          Number(
            result.games_in_progress ??
              0,
          ),
        gamesRemaining:
          Number(
            result.games_remaining ?? 0,
          ),
        draftPosition:
          config?.draft_order ?? null,
        topPlayer,
      };
    })
    .sort((a, b) =>
      String(b.slateStart).localeCompare(
        String(a.slateStart),
      ),
    );

  const completedRows =
    allTeamRows.filter(
      isCompletedResult,
    );

  const tournamentWins =
    completedRows
      .filter(
        (row) =>
          Number(row.finishPosition) === 1,
      )
      .map((row) => ({
        slateId: row.slateId,
        tournamentName: row.slateLabel,
        season: row.season,
        date: row.slateStart,
        score: row.score,
      }))
      .sort((a, b) =>
        String(b.date).localeCompare(
          String(a.date),
        ),
      );

  const selectedSeason =
    !isAllTime &&
    Number.isFinite(
      Number(seasonParam),
    )
      ? Number(seasonParam)
      : latestSeason;

  const selectedRows = isAllTime
    ? completedRows
    : completedRows.filter(
        (row) =>
          row.season === selectedSeason,
      );

  const seasonSummary =
    summarize(selectedRows);

  const careerSummaryBase =
    summarize(completedRows);

  // Lower is better in Golf.
  const bestSlate =
    [...completedRows].sort(
      (a, b) => a.score - b.score,
    )[0] ?? null;

  const worstSlate =
    [...completedRows].sort(
      (a, b) => b.score - a.score,
    )[0] ?? null;

  const playerDraftCounts =
    new Map<number, number>();

  const playerScores =
    new Map<number, number[]>();

  lineupPlayers.forEach((row) => {
    playerDraftCounts.set(
      row.player_id,
      (playerDraftCounts.get(
        row.player_id,
      ) ?? 0) + 1,
    );

    const lineup = lineupById.get(
      row.lineup_id,
    );

    if (!lineup) return;

    const eventPlayer =
      eventPlayerBySlatePlayer.get(
        `${Number(
          lineup.slate_id,
        )}:${row.player_id}`,
      );

    const score =
      eventPlayer?.fantasy_score ??
      eventPlayer
        ?.official_score_to_par;

    if (score === null || score === undefined) {
      return;
    }

    const existing =
      playerScores.get(
        row.player_id,
      ) ?? [];

    existing.push(Number(score));

    playerScores.set(
      row.player_id,
      existing,
    );
  });

  const favoritePlayerEntry =
    [...playerDraftCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0] ??
    null;

  const bestAvgPlayer =
    [...playerScores.entries()]
      .map(([playerId, scores]) => ({
        playerId,
        avg:
          scores.reduce(
            (sum, value) =>
              sum + value,
            0,
          ) / scores.length,
        count: scores.length,
      }))
      .sort((a, b) => a.avg - b.avg)[0] ??
    null;

  const bestPickEver =
    eventPlayers
      .filter((eventPlayer) => {
        const draftedIds =
          playerIdsBySlateId.get(
            Number(
              eventPlayer.slate_id,
            ),
          ) ?? [];

        return draftedIds.includes(
          Number(
            eventPlayer.player_id,
          ),
        );
      })
      .map((eventPlayer) => {
        const slate = slateById.get(
          Number(
            eventPlayer.slate_id,
          ),
        );

        const player = playerById.get(
          Number(
            eventPlayer.player_id,
          ),
        );

        const score =
          eventPlayer.fantasy_score ??
          eventPlayer
            .official_score_to_par;

        return {
          playerId:
            Number(
              eventPlayer.player_id,
            ),
          playerName:
            player?.display_name ??
            "Unknown Golfer",
          fantasyPoints:
            score === null ||
            score === undefined
              ? null
              : Number(score),
          slateLabel:
            slate?.display_name?.trim() ||
            formatSlateDateLabel(slate),
          finishPosition:
            completedRows.find(
              (row) =>
                Number(row.slateId) ===
                Number(
                  eventPlayer.slate_id,
                ),
            )?.finishPosition ?? null,
        };
      })
      .filter(
        (row) =>
          row.fantasyPoints !== null,
      )
      .sort(
        (a, b) =>
          Number(a.fantasyPoints) -
          Number(b.fantasyPoints),
      )[0] ?? null;

  const seasonStreaks =
    getWinStreaks(selectedRows);

  const careerStreaks =
    getWinStreaks(completedRows);

  let birdies = 0;
  let eagles = 0;
  let albatrosses = 0;
  let holesInOne = 0;
  let pars = 0;
  let bogeys = 0;
  let doubleBogeys = 0;

  holes.forEach((hole) => {
    const round = roundById.get(
      Number(hole.round_id),
    );

    if (!round) return;

    const eventPlayer =
      eventPlayerById.get(
        Number(
          round.event_player_id,
        ),
      );

    if (!eventPlayer) return;

    const draftedIds =
      playerIdsBySlateId.get(
        Number(
          eventPlayer.slate_id,
        ),
      ) ?? [];

    if (
      !draftedIds.includes(
        Number(
          eventPlayer.player_id,
        ),
      )
    ) {
      return;
    }

    const relative = Number(
      hole.relative_to_par ?? 0,
    );

    const strokes = Number(
      hole.strokes ?? 0,
    );

    if (strokes === 1) {
      holesInOne += 1;
    }

    if (relative <= -3) {
      albatrosses += 1;
    } else if (relative === -2) {
      eagles += 1;
    } else if (relative === -1) {
      birdies += 1;
    } else if (relative === 0) {
      pars += 1;
    } else if (relative === 1) {
      bogeys += 1;
    } else if (relative >= 2) {
      doubleBogeys += 1;
    }
  });

  const draftedRounds =
    rounds.filter((round) => {
      const eventPlayer =
        eventPlayerById.get(
          Number(
            round.event_player_id,
          ),
        );

      if (!eventPlayer) return false;

      const draftedIds =
        playerIdsBySlateId.get(
          Number(
            eventPlayer.slate_id,
          ),
        ) ?? [];

      return draftedIds.includes(
        Number(
          eventPlayer.player_id,
        ),
      );
    });

  const completedDraftedRounds =
    draftedRounds.filter(
      (round) =>
        Number(
          round.holes_completed ?? 0,
        ) === 18,
    );

  const roundsUnderPar =
    completedDraftedRounds.filter(
      (round) =>
        Number(
          round.score_to_par ?? 0,
        ) < 0,
    ).length;

  const draftedEventPlayers =
    eventPlayers.filter(
      (eventPlayer) => {
        const draftedIds =
          playerIdsBySlateId.get(
            Number(
              eventPlayer.slate_id,
            ),
          ) ?? [];

        return draftedIds.includes(
          Number(
            eventPlayer.player_id,
          ),
        );
      },
    );

  const settledGolfers =
    draftedEventPlayers.filter(
      (row) =>
        [
          "finished",
          "cut",
          "withdrawn",
          "disqualified",
          "did_not_start",
        ].includes(
          String(
            row.status ?? "",
          ).toLowerCase(),
        ),
    );

  const madeCuts =
    settledGolfers.filter(
      (row) =>
        !isCutStatus(row.status),
    ).length;

  const cutsMadePct =
    settledGolfers.length > 0
      ? round(
          (madeCuts /
            settledGolfers.length) *
            100,
        )
      : null;

  const golfSummary = {
    tournamentsPlayed:
      completedRows.length,
    favoriteGolfer:
      favoritePlayerEntry
        ? {
            playerId:
              favoritePlayerEntry[0],
            playerName:
              playerById.get(
                favoritePlayerEntry[0],
              )?.display_name ??
              "Unknown Golfer",
            count:
              favoritePlayerEntry[1],
          }
        : null,
    bestAverageGolfer:
      bestAvgPlayer
        ? {
            playerId:
              bestAvgPlayer.playerId,
            playerName:
              playerById.get(
                bestAvgPlayer.playerId,
              )?.display_name ??
              "Unknown Golfer",
            avgScore:
              round(
                bestAvgPlayer.avg,
              ),
            count:
              bestAvgPlayer.count,
          }
        : null,
    cutsMade: madeCuts,
    cutOpportunities:
      settledGolfers.length,
    cutsMadePct,
    birdies,
    eagles,
    albatrosses,
    holesInOne,
    pars,
    bogeys,
    doubleBogeys,
    roundsUnderPar,
    completedRounds:
      completedDraftedRounds.length,
  };

  // These keep the shared TrophyCase contract intact.
  // Golf-specific milestones will replace them in the next pass.
  const milestoneThresholds = {
    /*
     * Shared contract names retained for TrophyCase compatibility,
     * but Golf uses under-par team-score milestones.
     */
    score175: -30,
    score200: -45,
    score225: -60,
    score250: -75,
    photoFinishMargin: 1,
    statementWinMargin: 10,
  };

  const golfWinningMargins =
    completedRows
      .filter(
        (row) =>
          Number(row.finishPosition) === 1,
      )
      .map((row) => {
        const runnerUp =
          allGolfResults.find(
            (result) =>
              Number(result.slate_id) ===
                Number(row.slateId) &&
              Number(
                result.finish_position,
              ) === 2,
          );

        if (
          !runnerUp ||
          runnerUp.fantasy_points === null ||
          runnerUp.fantasy_points ===
            undefined
        ) {
          return null;
        }

        /*
         * Golf is lower-is-better:
         *
         * winner -45
         * runner-up -44
         * winning margin = 1
         */
        const margin =
          Number(
            runnerUp.fantasy_points,
          ) -
          Number(row.score);

        return Number.isFinite(margin) &&
          margin >= 0
          ? round(margin)
          : null;
      })
      .filter(
        (
          margin,
        ): margin is number =>
          margin !== null,
      );

  const golfPhotoFinishMargins =
    golfWinningMargins.filter(
      (margin) =>
        margin <=
        milestoneThresholds.photoFinishMargin,
    );

  const milestones = {
    score175:
      completedRows.filter(
        (row) =>
          row.score <=
          milestoneThresholds.score175,
      ).length,
    score200:
      completedRows.filter(
        (row) =>
          row.score <=
          milestoneThresholds.score200,
      ).length,
    score225:
      completedRows.filter(
        (row) =>
          row.score <=
          milestoneThresholds.score225,
      ).length,
    score250:
      completedRows.filter(
        (row) =>
          row.score <=
          milestoneThresholds.score250,
      ).length,
    backToBackWins: 0,
    threePeats: 0,
    longestPodiumStreak: 0,
    photoFinishWins:
      golfPhotoFinishMargins.length,
    statementWins:
      golfWinningMargins.filter(
        (margin) =>
          margin >=
          milestoneThresholds.statementWinMargin,
      ).length,
    closestWinningMargin:
      golfWinningMargins.length > 0
        ? round(
            Math.min(
              ...golfWinningMargins,
            ),
          )
        : null,
    largestWinningMargin:
      golfWinningMargins.length > 0
        ? round(
            Math.max(
              ...golfWinningMargins,
            ),
          )
        : null,
    golfAlbatrosses: albatrosses,
    golfHolesInOne: holesInOne,
  };

  return NextResponse.json({
    success: true,
    sport: "golf",

    scope: {
      groupId:
        scope.groupId,

      leagueId:
        scope.leagueId,
    },

    team: {
      id: safeTeam.id,
      name: safeTeam.name,
      avatarUrl:
        teamUser?.avatar_url ?? null,
    },
    latestSeason,
    selectedSeason:
      isAllTime
        ? "all"
        : selectedSeason,
    seasonSummary: {
      ...seasonSummary,
      currentWinStreak:
        seasonStreaks.current,
      longestWinStreak:
        seasonStreaks.longest,
    },
    careerSummary: {
      ...careerSummaryBase,
      bestScore:
        bestSlate
          ? round(bestSlate.score)
          : null,
      worstScore:
        worstSlate
          ? round(worstSlate.score)
          : null,
      longestWinStreak:
        careerStreaks.longest,
      favoritePlayer:
        golfSummary.favoriteGolfer
          ? {
              playerId:
                golfSummary
                  .favoriteGolfer
                  .playerId,
              playerName:
                golfSummary
                  .favoriteGolfer
                  .playerName,
              count:
                golfSummary
                  .favoriteGolfer
                  .count,
            }
          : null,
      bestAvgPlayer:
        golfSummary.bestAverageGolfer
          ? {
              playerId:
                golfSummary
                  .bestAverageGolfer
                  .playerId,
              playerName:
                golfSummary
                  .bestAverageGolfer
                  .playerName,
              avg:
                golfSummary
                  .bestAverageGolfer
                  .avgScore,
              count:
                golfSummary
                  .bestAverageGolfer
                  .count,
            }
          : null,
      bestPickEver,
      bestSlate,
      worstSlate,
    },
    golfSummary,
    milestones,
    milestoneThresholds,
    leagueAwards:
      leagueAwards ?? [],
    tournamentWins,
    recentSlates:
      selectedRows.slice(0, 8),
  });
}
