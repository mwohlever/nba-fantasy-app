/** Traditional Golf ranking, extracted unchanged from refresh-stats-golf. */
export function calculateGolfTeamResults(
  slateId: number,
  eventPlayerRows: Array<Record<string, any>>,
  competitors: Array<Record<string, any>>,
  lineupsData: Array<Record<string, any>>,
  slateTeamData: Array<Record<string, any>>,
) {
  const eventRowByPlayerId = new Map(
    eventPlayerRows.map((row) => [
      Number(row.player_id),
      row,
    ]),
  );

  const competitorByPlayerId = new Map(competitors.map((row) => [Number(row.playerId), row]));

  const draftOrderByTeamId = new Map(
    (slateTeamData ?? []).map((row) => [
      Number(row.team_id),
      Number(row.draft_order ?? 999),
    ]),
  );

  const teamResultRows = (lineupsData ?? []).map((lineup: any) => {
    const playerIds = (lineup.lineup_players ?? []).map(
      (row: any) => Number(row.player_id),
    );

    const golferRows = playerIds
      .map((playerId: number) => eventRowByPlayerId.get(playerId))
      .filter(Boolean) as typeof eventPlayerRows;

    const fantasyPoints = golferRows.reduce(
      (sum, row) => sum + Number(row.fantasy_score ?? 0),
      0,
    );

    const completedStatuses = new Set([
      "round_complete",
      "finished",
      "cut",
      "withdrawn",
      "disqualified",
    ]);

    const gamesCompleted = golferRows.filter((row) =>
      completedStatuses.has(String(row.status)),
    ).length;

    const gamesInProgress = golferRows.filter(
      (row) => row.status === "active",
    ).length;

    const gamesRemaining = golferRows.filter((row) =>
      ["scheduled", "did_not_start"].includes(String(row.status)),
    ).length;

    const golferCompetitors = playerIds
      .map((playerId: number) =>
        competitorByPlayerId.get(playerId),
      )
      .filter(Boolean);

    const completedIndividualRounds =
      golferCompetitors.flatMap((competitor: any) =>
        (competitor.rounds ?? [])
          .filter(
            (round: any) =>
              Number(round.holesCompleted ?? 0) >= 18 &&
              round.scoreToPar !== null &&
              round.scoreToPar !== undefined,
          )
          .map((round: any) => ({
            roundNumber: Number(round.roundNumber),
            score: Number(round.scoreToPar),
          })),
      );

    const bestIndividualRound =
      completedIndividualRounds.length > 0
        ? Math.min(
            ...completedIndividualRounds.map(
              (round: any) => round.score,
            ),
          )
        : Number.POSITIVE_INFINITY;

    const teamRoundScores: number[] = [];

    for (const roundNumber of [1, 2, 3, 4]) {
      const roundScores = golferCompetitors
        .map((competitor: any) =>
          (competitor.rounds ?? []).find(
            (round: any) =>
              Number(round.roundNumber) === roundNumber &&
              Number(round.holesCompleted ?? 0) >= 18 &&
              round.scoreToPar !== null &&
              round.scoreToPar !== undefined,
          ),
        )
        .filter(Boolean)
        .map((round: any) =>
          Number(round.scoreToPar),
        );

      // A team round counts only after every drafted golfer has
      // completed that round.
      if (
        golferCompetitors.length > 0 &&
        roundScores.length === golferCompetitors.length
      ) {
        teamRoundScores.push(
          roundScores.reduce(
            (sum: number, score: number) =>
              sum + score,
            0,
          ),
        );
      }
    }

    const bestTeamRound =
      teamRoundScores.length > 0
        ? Math.min(...teamRoundScores)
        : Number.POSITIVE_INFINITY;

    const playedHoles =
      golferCompetitors.flatMap((competitor: any) =>
        (competitor.rounds ?? []).flatMap(
          (round: any) => round.holes ?? [],
        ),
      );

    const birdiesOrBetter = playedHoles.filter(
      (hole: any) =>
        hole.relativeToPar !== null &&
        hole.relativeToPar !== undefined &&
        Number(hole.relativeToPar) <= -1,
    ).length;

    const bogeysOrWorse = playedHoles.filter(
      (hole: any) =>
        hole.relativeToPar !== null &&
        hole.relativeToPar !== undefined &&
        Number(hole.relativeToPar) >= 1,
    ).length;

    return {
      slate_id: slateId,
      team_id: Number(lineup.team_id),
      fantasy_points: fantasyPoints,
      finish_position: null as number | null,
      games_completed: gamesCompleted,
      games_in_progress: gamesInProgress,
      games_remaining: gamesRemaining,

      _tiebreak: {
        bestTeamRound,
        bestIndividualRound,
        birdiesOrBetter,
        bogeysOrWorse,
        draftOrder:
          draftOrderByTeamId.get(
            Number(lineup.team_id),
          ) ?? 999,
      },
    };
  });

  const compareGolfTeams = (
    a: (typeof teamResultRows)[number],
    b: (typeof teamResultRows)[number],
  ) => {
    // Lower tournament score wins.
    if (a.fantasy_points !== b.fantasy_points) {
      return a.fantasy_points - b.fantasy_points;
    }

    // 1. Lowest completed team round.
    if (
      a._tiebreak.bestTeamRound !==
      b._tiebreak.bestTeamRound
    ) {
      return (
        a._tiebreak.bestTeamRound -
        b._tiebreak.bestTeamRound
      );
    }

    // 2. Lowest completed individual golfer round.
    if (
      a._tiebreak.bestIndividualRound !==
      b._tiebreak.bestIndividualRound
    ) {
      return (
        a._tiebreak.bestIndividualRound -
        b._tiebreak.bestIndividualRound
      );
    }

    // 3. Most birdies or better.
    if (
      a._tiebreak.birdiesOrBetter !==
      b._tiebreak.birdiesOrBetter
    ) {
      return (
        b._tiebreak.birdiesOrBetter -
        a._tiebreak.birdiesOrBetter
      );
    }

    // 4. Fewest bogeys or worse.
    if (
      a._tiebreak.bogeysOrWorse !==
      b._tiebreak.bogeysOrWorse
    ) {
      return (
        a._tiebreak.bogeysOrWorse -
        b._tiebreak.bogeysOrWorse
      );
    }

    // 5. Earlier draft position guarantees a stable result.
    if (
      a._tiebreak.draftOrder !==
      b._tiebreak.draftOrder
    ) {
      return (
        a._tiebreak.draftOrder -
        b._tiebreak.draftOrder
      );
    }

    return a.team_id - b.team_id;
  };

  const rankedTeamRows =
    [...teamResultRows].sort(compareGolfTeams);

  rankedTeamRows.forEach((row, index) => {
    row.finish_position = index + 1;
  });

  const persistedTeamRows = rankedTeamRows.map(
    ({ _tiebreak, ...row }) => row,
  );

  return persistedTeamRows;
}
